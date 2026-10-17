import AppKit
import SwiftUI
import XCTest
@testable import BulkMaker

@MainActor
final class InputPickerScreenTests: XCTestCase {
    private var root: URL!
    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("InputPickerScreen-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDown() async throws { try? FileManager.default.removeItem(at: root) }

    private func photo(_ name: String, in folder: URL, portrait: Bool = false) throws -> URL {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let size = portrait ? CGSize(width: 180, height: 280) : CGSize(width: 280, height: 180)
        let image = NSImage(size: size, flipped: false) { rect in
            IntroductionAssets.painting.draw(in: rect)
            return true
        }
        let bitmap = NSBitmapImageRep(data: try XCTUnwrap(image.tiffRepresentation))!
        let file = folder.appendingPathComponent(name)
        try XCTUnwrap(bitmap.representation(using: .png, properties: [:])).write(to: file)
        return file
    }

    private func fixture() async throws -> (ProjectStore, InputPickerLibrary) {
        let store = ProjectStore(root: root.appendingPathComponent("Projects"),
            selectionFile: root.appendingPathComponent("live/selecao.json"),
            legacyCanvas: root.appendingPathComponent("legacy"), defaults: UserDefaults(suiteName: UUID().uuidString)!)
        let folder = root.appendingPathComponent("SC")
        for n in 1...10 { _ = try photo(String(format: "Foto %02d.png", n), in: folder, portrait: n.isMultiple(of: 2)) }
        var canvas: [(item: CanvasItem, url: URL)] = []
        for n in 1...4 {
            let file = try photo("canvas-\(n).png", in: root.appendingPathComponent("media"), portrait: true)
            canvas.append((CanvasItem(file: file.lastPathComponent, x: 0, y: 0, width: 100, height: 100), file))
        }
        let text = CanvasItem(file: "", x: 0, y: 0, width: 100, height: 100, text: "Legenda que não é imagem")
        canvas.append((text, root.appendingPathComponent("media")))
        let library = InputPickerLibrary(kind: .photos, sources: InputSources(folders: [folder.path]), canvas: canvas)
        await library.refresh()
        return (store, library)
    }

    private func click(_ rect: CGRect, in hosting: NSView, window: NSWindow) throws {
        let point = hosting.convert(CGPoint(x: rect.midX, y: hosting.isFlipped ? rect.midY : hosting.bounds.height - rect.midY), to: nil)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            window.sendEvent(try XCTUnwrap(NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0)))
        }
        window.contentView?.layoutSubtreeIfNeeded()
    }

    private func capture(_ window: NSWindow, name: String) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        process.arguments = ["-x", "-o", "-l", String(window.windowNumber), "/private/tmp/\(name).png"]
        try process.run(); process.waitUntilExit()
    }

    func testBothGridsSelectWithRealClicksAndApplyOnlyTheChosenPhotos() async throws {
        let (store, library) = try await fixture()
        var frames: [String: CGRect] = [:]
        var output: URL?, closed = 0
        let request = InputPickerCenter.Request(kind: .photos, completion: { output = $0 })
        let hosting = NSHostingView(rootView: ZStack {
            Image(nsImage: IntroductionAssets.painting).resizable().scaledToFill().frame(width: 1000, height: 760).clipped()
            InputSourcePicker(request: request, store: store, library: library,
                onControlFrame: { frames[$0] = $1 }, close: { closed += 1 })
        }.frame(width: 1000, height: 760))
        let window = NSWindow(contentRect: CGRect(x: 40, y: 40, width: 1000, height: 760),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .darkAqua)
        window.title = "Fotos: Mac e canvas"
        window.contentView = hosting
        defer { window.orderOut(nil); window.contentView = nil }
        _ = NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(800))
        let firstMac = try XCTUnwrap(library.macFiles.first)
        let firstCanvas = try XCTUnwrap(library.canvas.first?.item.id)
        let macID = "mac-\(firstMac.path)", canvasID = "canvas-\(firstCanvas)"
        let panel = try XCTUnwrap(frames["panel"])
        for id in [macID, canvasID, "apply", "cancel", "close", "add", "mac-all", "canvas-all"] {
            XCTAssertTrue(panel.contains(try XCTUnwrap(frames[id])), "Controle fora do painel: \(id)")
        }
        XCTAssertEqual(try XCTUnwrap(frames[macID]).minY, try XCTUnwrap(frames[canvasID]).minY, accuracy: 1,
                       "A primeira linha das duas grades precisa alinhar")
        XCTAssertEqual(library.canvas.count, 4)
        try capture(window, name: "input-picker-wide")
        try click(try XCTUnwrap(frames[macID]), in: hosting, window: window)
        XCTAssertEqual(library.total, 9)
        try click(try XCTUnwrap(frames[canvasID]), in: hosting, window: window)
        XCTAssertEqual(library.total, 10)
        try click(try XCTUnwrap(frames["mac-all"]), in: hosting, window: window)
        XCTAssertEqual(library.total, 11)
        try click(try XCTUnwrap(frames["mac-all"]), in: hosting, window: window)
        XCTAssertEqual(library.total, 1)
        try click(try XCTUnwrap(frames["canvas-all"]), in: hosting, window: window)
        XCTAssertEqual(library.total, 4)
        try click(try XCTUnwrap(frames["canvas-all"]), in: hosting, window: window)
        XCTAssertEqual(library.total, 0)
        try click(try XCTUnwrap(frames["apply"]), in: hosting, window: window)
        XCTAssertNil(output, "Não é possível confirmar uma seleção vazia")
        try click(try XCTUnwrap(frames["mac-all"]), in: hosting, window: window)
        try click(try XCTUnwrap(frames[macID]), in: hosting, window: window)
        try click(try XCTUnwrap(frames[canvasID]), in: hosting, window: window)
        XCTAssertEqual(library.total, 10)
        try click(try XCTUnwrap(frames["apply"]), in: hosting, window: window)
        try await Task.sleep(for: .milliseconds(400))
        XCTAssertEqual(closed, 1)
        XCTAssertEqual(try PhotoCatalog(directory: XCTUnwrap(output)).files.count, 10)
        XCTAssertEqual(store.current.project.photoSources?.excludedFiles, [firstMac.standardizedFileURL.path])
        XCTAssertEqual(InputAssembler.files(in: firstMac.deletingLastPathComponent(), kind: .photos).count, 10)
    }

    func testCalendarSelectionReturnsImagesWithoutChangingTheBatch() async throws {
        let (store, library) = try await fixture()
        library.selectMac(false)
        let mac = try XCTUnwrap(library.macFiles.first)
        let canvas = try XCTUnwrap(library.canvas.first)
        library.toggle(mac)
        library.toggleCanvas(canvas.item.id)
        var frames: [String: CGRect] = [:]
        var chosen: [URL] = [], closed = false, assembled = false
        let request = InputPickerCenter.Request(kind: .photos, completion: { _ in assembled = true })
        let host = NSHostingView(rootView: InputSourcePicker(request: request, store: store, library: library,
            onControlFrame: { frames[$0] = $1 }, actionTitle: "Usar no carrossel",
            selectionCompletion: { chosen = $0 }, close: { closed = true }).frame(width: 1000, height: 760))
        let window = NSWindow(contentRect: CGRect(x: 40, y: 40, width: 1000, height: 760),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        defer { window.orderOut(nil); window.contentView = nil }
        window.makeKeyAndOrderFront(nil)
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(400))
        try click(try XCTUnwrap(frames["apply"]), in: host, window: window)
        XCTAssertEqual(chosen, [mac, canvas.url])
        XCTAssertTrue(closed)
        XCTAssertFalse(assembled)
        XCTAssertNil(store.current.project.photoSources)
    }

    func testCompactLayoutFitsAndCancelDoesNotChangeStoredSources() async throws {
        let (store, library) = try await fixture()
        var frames: [String: CGRect] = [:]
        var closed = false, applied = false
        let hosting = NSHostingView(rootView: ZStack {
            Image(nsImage: IntroductionAssets.painting).resizable().scaledToFill().frame(width: 540, height: 700).clipped()
            InputSourcePicker(request: .init(kind: .photos, completion: { _ in applied = true }), store: store, library: library,
                onControlFrame: { frames[$0] = $1 }, close: { closed = true })
        }.frame(width: 540, height: 700))
        let window = NSWindow(contentRect: CGRect(x: 40, y: 40, width: 540, height: 700),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .darkAqua)
        window.contentView = hosting
        defer { window.orderOut(nil); window.contentView = nil }
        window.makeKeyAndOrderFront(nil)
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(700))
        let panel = try XCTUnwrap(frames["panel"])
        for id in ["apply", "cancel", "close", "add", "mac-all"] {
            XCTAssertTrue(panel.contains(try XCTUnwrap(frames[id])), "Controle cortado no painel estreito: \(id)")
        }
        try capture(window, name: "input-picker-compact")
        try click(try XCTUnwrap(frames["cancel"]), in: hosting, window: window)
        XCTAssertTrue(closed)
        XCTAssertFalse(applied)
        XCTAssertNil(store.current.project.photoSources)
    }
}
