import AppKit
import CarouselEngine
import SwiftUI
import XCTest
@testable import BulkMaker

@MainActor
final class CalendarPostScreenTests: XCTestCase {
    private var root: URL!
    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("CalendarPostScreen-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDown() async throws { try? FileManager.default.removeItem(at: root) }

    private func fixture() throws -> (CalendarPostCenter, [URL]) {
        let store = ProjectStore(root: root.appendingPathComponent("Projects"), selectionFile: root.appendingPathComponent("live/selecao.json"),
                                 legacyCanvas: root.appendingPathComponent("legacy"), defaults: UserDefaults(suiteName: UUID().uuidString)!)
        var files: [URL] = []
        for n in 1...4 {
            let image = NSImage(size: CGSize(width: n.isMultiple(of: 2) ? 100 : 180, height: 180), flipped: false) { rect in
                IntroductionAssets.painting.draw(in: rect); return true
            }
            let data = NSBitmapImageRep(data: try XCTUnwrap(image.tiffRepresentation))!.representation(using: .png, properties: [:])!
            let file = root.appendingPathComponent("Foto \(n).png")
            try data.write(to: file); files.append(file)
        }
        let center = CalendarPostCenter(store: store)
        center.present(.selection, files: files)
        return (center, files)
    }

    private func click(_ rect: CGRect, host: NSView, window: NSWindow) throws {
        let location = host.convert(CGPoint(x: rect.midX, y: host.isFlipped ? rect.midY : host.bounds.height - rect.midY), to: nil)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            window.sendEvent(try XCTUnwrap(NSEvent.mouseEvent(with: type, location: location, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0)))
        }
        window.contentView?.layoutSubtreeIfNeeded()
    }

    private func capture(_ window: NSWindow, name: String) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        process.arguments = ["-x", "-o", "-l", String(window.windowNumber), "/private/tmp/\(name).png"]
        try process.run(); process.waitUntilExit()
    }

    func testReorderRemoveAndSaveCreateOnlyOnePostWithTheReviewedSlides() async throws {
        let (center, files) = try fixture()
        var frames: [String: CGRect] = [:]
        let request = try XCTUnwrap(center.request)
        let host = NSHostingView(rootView: ZStack {
            Image(nsImage: IntroductionAssets.painting).resizable().scaledToFill().frame(width: 960, height: 760).clipped()
            CalendarPostComposer(request: request, center: center, onControlFrame: { frames[$0] = $1 })
        }.frame(width: 960, height: 760))
        let window = NSWindow(contentRect: CGRect(x: 30, y: 30, width: 960, height: 760), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .darkAqua)
        window.contentView = host
        defer { window.orderOut(nil); window.contentView = nil }
        window.makeKeyAndOrderFront(nil)
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(600))
        let panel = try XCTUnwrap(frames["panel"])
        for id in ["save", "cancel", "close", "add-images", "date", "next-0", "remove-3"] {
            XCTAssertTrue(panel.contains(try XCTUnwrap(frames[id])), "Controle cortado: \(id)")
        }
        try capture(window, name: "calendar-post-wide")
        try click(try XCTUnwrap(frames["next-0"]), host: host, window: window)
        try await Task.sleep(for: .milliseconds(80))
        try click(try XCTUnwrap(frames["remove-3"]), host: host, window: window)
        try await Task.sleep(for: .milliseconds(80))
        try click(try XCTUnwrap(frames["save"]), host: host, window: window)
        for _ in 0..<40 {
            if center.request == nil { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertNil(center.request)
        let posts = try PostAgenda.load(from: center.store.liveAgenda).posts
        XCTAssertEqual(posts.count, 1)
        let post = try XCTUnwrap(posts.first)
        let slides = CalendarPreview.slides(in: URL(fileURLWithPath: post.folder))
        XCTAssertEqual(slides.count, 3)
        for (slide, original) in zip(slides, [files[1], files[0], files[2]]) {
            XCTAssertEqual(try Data(contentsOf: slide), try Data(contentsOf: original))
        }
        XCTAssertNil(center.store.current.project.photoSources, "Adicionar à agenda não altera as entradas do lote")
        XCTAssertNotNil(center.lastScheduledDate)
    }

    func testCompactComposerFitsAndCancelWritesNothing() async throws {
        let (center, _) = try fixture()
        var frames: [String: CGRect] = [:]
        let request = try XCTUnwrap(center.request)
        let host = NSHostingView(rootView: ZStack {
            Image(nsImage: IntroductionAssets.painting).resizable().scaledToFill().frame(width: 540, height: 700).clipped()
            CalendarPostComposer(request: request, center: center, onControlFrame: { frames[$0] = $1 })
        }.frame(width: 540, height: 700))
        let window = NSWindow(contentRect: CGRect(x: 30, y: 30, width: 540, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .darkAqua)
        window.contentView = host
        defer { window.orderOut(nil); window.contentView = nil }
        window.makeKeyAndOrderFront(nil)
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(600))
        let panel = try XCTUnwrap(frames["panel"])
        for id in ["save", "cancel", "close", "add-images", "date"] { XCTAssertTrue(panel.contains(try XCTUnwrap(frames[id])), id) }
        try capture(window, name: "calendar-post-compact")
        try click(try XCTUnwrap(frames["cancel"]), host: host, window: window)
        XCTAssertNil(center.request)
        XCTAssertTrue(try PostAgenda.load(from: center.store.liveAgenda).posts.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: center.store.current.folder.appendingPathComponent("Calendário").path))
    }

    func testOpenedPostHasWorkingBackAndCloseControlsEvenWithoutAnEditingPlan() async throws {
        let (_, files) = try fixture()
        var frames: [String: CGRect] = [:]
        var closed = 0
        let host = NSHostingView(rootView: CalendarCarouselViewer(slides: files, close: { closed += 1 },
            onControlFrame: { frames[$0] = $1 }).frame(width: 960, height: 760))
        let window = NSWindow(contentRect: CGRect(x: 30, y: 30, width: 960, height: 760), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        defer { window.orderOut(nil); window.contentView = nil }
        window.makeKeyAndOrderFront(nil)
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(600))
        try click(CGRect(x: 306, y: 380, width: 4, height: 4), host: host, window: window)
        XCTAssertEqual(closed, 0, "Clicar no post não deve fechar a prévia")
        for id in ["back", "close"] {
            let rect = try XCTUnwrap(frames[id])
            XCTAssertTrue(CGRect(x: 0, y: 64, width: 960, height: 696).contains(rect), "O controle precisa ficar visível abaixo da navegação")
            try click(rect, host: host, window: window)
        }
        XCTAssertEqual(closed, 2)
        try click(CGRect(x: 18, y: 380, width: 4, height: 4), host: host, window: window)
        XCTAssertEqual(closed, 3, "Clicar fora do conteúdo deve voltar ao calendário")
        try capture(window, name: "calendar-post-back")
    }
}
