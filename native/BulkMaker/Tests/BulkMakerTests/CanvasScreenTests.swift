import AppKit
import UniformTypeIdentifiers
import SwiftUI
import XCTest
@testable import BulkMaker

@MainActor
final class CanvasScreenTests: XCTestCase {
    private var directory: URL!
    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("CanvasScreen-\(UUID().uuidString)")
    }
    override func tearDown() async throws { try? FileManager.default.removeItem(at: directory) }

    private func host(_ board: CanvasBoard) -> (NSWindow, InfiniteCanvasView) {
        let view = InfiniteCanvasView(board: board)
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 800, height: 600),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = view
        view.frame = CGRect(x: 0, y: 0, width: 800, height: 600)
        view.layoutSubtreeIfNeeded()
        return (window, view)
    }

    private func addImage(to board: CanvasBoard, frame: CGRect) throws -> CanvasItem {
        let image = NSImage(size: NSSize(width: 100, height: 80), flipped: false) { rect in
            NSColor.systemTeal.setFill(); rect.fill(); return true
        }
        let data = try XCTUnwrap(image.tiffRepresentation)
        let added = try XCTUnwrap(board.add([(data, .tiff)], around: .zero).first)
        board.setFrame(frame, of: added.id)
        board.changed()
        return try XCTUnwrap(board.items.first { $0.id == added.id })
    }

    func testDuplicateKeepsImageAndTextArrangementSizesAndStacking() throws {
        let board = CanvasBoard(directory: directory)
        _ = try addImage(to: board, frame: CGRect(x: -200, y: 50, width: 640, height: 512))
        _ = board.addText("Legenda", at: CGPoint(x: -100, y: 700))
        _ = try addImage(to: board, frame: CGRect(x: 600, y: 150, width: 200, height: 160))
        let originals = board.items
        let (window, view) = host(board)
        defer { window.contentView = nil }
        view.selectAll(nil)
        let undo = try XCTUnwrap(view.undoManager)
        undo.beginUndoGrouping(); view.duplicate(nil); undo.endUndoGrouping()
        let copies = board.items.filter { view.selection.contains($0.id) }
        XCTAssertEqual(copies.count, originals.count)
        for (copy, original) in zip(copies, originals) {
            XCTAssertNotEqual(copy.id, original.id)
            XCTAssertEqual(copy.frame, original.frame.offsetBy(dx: 40, dy: 40), "Duplicar deve preservar a composição")
            XCTAssertEqual(copy.text, original.text)
            XCTAssertEqual(copy.style, original.style)
            if !original.isText && !copy.isText { XCTAssertEqual(try Data(contentsOf: board.url(of: copy)), try Data(contentsOf: board.url(of: original))) }
        }
        undo.undo(); XCTAssertEqual(board.items, originals)
        undo.redo(); XCTAssertEqual(board.items.count, originals.count * 2)
    }

    func testEditingNarrowTextBoxKeepsAllLinesInsideItsHeight() throws {
        let board = CanvasBoard(directory: directory)
        _ = board.addText("Oi", style: TextStyle(size: 20, padding: 10), at: .zero)
        let (window, view) = host(board)
        defer { window.contentView = nil }
        view.selectAll(nil); view.editSelectedText(nil)
        let editor = try XCTUnwrap(view.subviews.compactMap { $0 as? CanvasTextEditor }.first)
        let text = "Texto mais longo para testar todas as linhas sem cortar nenhuma palavra."
        editor.string = text
        editor.cancelOperation(nil)
        let item = try XCTUnwrap(board.items.first)
        XCTAssertEqual(item.text, text)
        let required = CanvasText.measure(text, style: try XCTUnwrap(item.style), maxWidth: item.width)
        XCTAssertGreaterThanOrEqual(item.height, required.height, "A altura precisa caber no tamanho real da caixa")
        XCTAssertEqual(CanvasBoard.savedItems(in: directory).first?.item, item)
    }

    func testLeavingTheCanvasSavesTextStillBeingEdited() throws {
        let board = CanvasBoard(directory: directory)
        _ = board.addText("Antes", at: .zero)
        let (window, view) = host(board)
        view.selectAll(nil); view.editSelectedText(nil)
        let editor = try XCTUnwrap(view.subviews.compactMap { $0 as? CanvasTextEditor }.first)
        editor.string = "Texto digitado antes de mudar de tela"
        window.contentView = NSView() // Same detachment as navigating away from Canvas.
        XCTAssertEqual(CanvasBoard.savedItems(in: directory).first?.item.text, editor.string)
    }

    func testCopyPasteMixedSelectionKeepsTextImagesAndLayout() throws {
        let clipboard = NSPasteboard.general
        let saved = (clipboard.pasteboardItems ?? []).map { item -> NSPasteboardItem in
            let copy = NSPasteboardItem()
            for type in item.types { if let data = item.data(forType: type) { copy.setData(data, forType: type) } }
            return copy
        }
        defer { clipboard.clearContents(); clipboard.writeObjects(saved) }
        let board = CanvasBoard(directory: directory)
        _ = try addImage(to: board, frame: CGRect(x: -200, y: 50, width: 400, height: 320))
        _ = board.addText("  Legenda com espaços  ", style: TextStyle(size: 22, weight: "bold"), at: CGPoint(x: -100, y: 600))
        _ = try addImage(to: board, frame: CGRect(x: 600, y: 150, width: 200, height: 160))
        let originals = board.items
        let (window, view) = host(board)
        defer { window.contentView = nil }
        view.selectAll(nil); view.copy(nil); view.paste(nil)
        let copies = board.items.filter { view.selection.contains($0.id) }
        XCTAssertEqual(copies.count, 3, "Colar uma seleção mista deve manter os textos também")
        XCTAssertEqual(copies.map(\.text), originals.map(\.text))
        XCTAssertEqual(copies.map(\.style), originals.map(\.style))
        if copies.count == originals.count {
            let dx = copies[0].x - originals[0].x, dy = copies[0].y - originals[0].y
            for (copy, original) in zip(copies, originals) {
                XCTAssertEqual(copy.frame, original.frame.offsetBy(dx: dx, dy: dy))
            }
        }
    }

    private func canvas(in view: NSView) -> InfiniteCanvasView? {
        (view as? InfiniteCanvasView) ?? view.subviews.lazy.compactMap { self.canvas(in: $0) }.first
    }

    private func click(_ point: CGPoint, in hosting: NSView, window: NSWindow) throws {
        let local = CGPoint(x: point.x, y: hosting.isFlipped ? point.y : hosting.bounds.height - point.y)
        let location = hosting.convert(local, to: nil)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            let event = try XCTUnwrap(NSEvent.mouseEvent(with: type, location: location, modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0))
            window.sendEvent(event)
        }
    }

    func testSelectedToolbarStaysInsideCanvasWithTerminalOpen() async throws {
        let board = CanvasBoard(directory: directory)
        _ = try addImage(to: board, frame: CGRect(x: 0, y: 0, width: 100, height: 80))
        _ = board.addText("Texto", at: CGPoint(x: 150, y: 0))
        var frames: [String: CGRect] = [:]
        let hosting = NSHostingView(rootView: CanvasPage(terminals: TerminalTabs(), directory: directory, onControlFrame: { frames[$0] = $1 }))
        let window = NSWindow(contentRect: CGRect(x: 120, y: 120, width: 480, height: 690),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "Canvas QA"
        window.contentView = hosting
        defer { window.orderOut(nil); window.contentView = nil }
        _ = NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(250))
        let view = try XCTUnwrap(canvas(in: hosting))
        let imageID = try XCTUnwrap(view.board.items.first(where: { !$0.isText })?.id)
        view.reveal([imageID])
        try await Task.sleep(for: .milliseconds(400))
        let escape = try XCTUnwrap(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0,
            windowNumber: window.windowNumber, context: nil, characters: "", charactersIgnoringModifiers: "", isARepeat: false, keyCode: 53))
        view.keyDown(with: escape)
        try click(CGPoint(x: 240, y: 345), in: hosting, window: window)
        XCTAssertEqual(view.selection, [imageID], "Os controles sobrepostos não podem bloquear os cliques nas imagens")
        view.selectAll(nil)
        try await Task.sleep(for: .milliseconds(450))
        hosting.layoutSubtreeIfNeeded()
        XCTAssertTrue(Set(["import", "blur", "selection", "zoom"]).isSubset(of: Set(frames.keys)))
        let viewport = CGRect(x: 0, y: 0, width: 480, height: 690)
        for (name, frame) in frames {
            XCTAssertTrue(viewport.insetBy(dx: -1, dy: -1).contains(frame), "Controle fora do canvas: \(name), \(frame)")
        }
        // A screenshot of the actual SwiftUI screen, backed only by disposable fixture files.
        if let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) {
            hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
            if let data = bitmap.representation(using: .png, properties: [:]) {
                try data.write(to: URL(fileURLWithPath: "/private/tmp/canvas-screen-audit.png"))
            }
        }

        let zoom = try XCTUnwrap(frames["zoom"])
        let oldScale = view.scale
        try click(CGPoint(x: zoom.maxX - 18, y: zoom.midY), in: hosting, window: window)
        try await Task.sleep(for: .milliseconds(400))
        XCTAssertGreaterThan(view.scale, oldScale, "O botão de zoom deve responder a um clique real")

        let picker = try XCTUnwrap(frames["import"])
        try click(CGPoint(x: picker.midX, y: picker.midY), in: hosting, window: window)
        try await Task.sleep(for: .milliseconds(200))
        let panel = try XCTUnwrap(window.attachedSheet as? NSOpenPanel, "Importar deve abrir o seletor do Mac")
        panel.cancel(nil)
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertNil(window.attachedSheet)
        XCTAssertEqual(view.board.items.count, 2, "Cancelar importação não altera o canvas")

        XCTAssertEqual(view.selection.count, 2, "Cancelar o seletor deve manter a seleção")
        XCTAssertNotNil(frames["Apagar (⌫)"])
        let undo = try XCTUnwrap(view.undoManager)
        undo.beginUndoGrouping()
        // macOS protects destructive first clicks when the unbundled XCTest host is inactive.
        // Exercise the same action here; a bundled-app pointer pass covers the actual trash control.
        view.delete(nil)
        try await Task.sleep(for: .milliseconds(150))
        undo.endUndoGrouping()
        XCTAssertTrue(view.board.items.isEmpty, "Apagar precisa funcionar na barra compacta")
        undo.undo()
        XCTAssertEqual(view.board.items.count, 2)
    }

    func testFailedDuplicationDoesNotLeavePartialItemsOrMedia() throws {
        let board = CanvasBoard(directory: directory)
        _ = try addImage(to: board, frame: CGRect(x: 0, y: 0, width: 100, height: 80))
        let missing = try addImage(to: board, frame: CGRect(x: 200, y: 0, width: 100, height: 80))
        try FileManager.default.removeItem(at: board.url(of: missing))
        let before = board.items
        let files = try FileManager.default.contentsOfDirectory(atPath: board.media.path).sorted()
        XCTAssertThrowsError(try board.duplicateItems(Set(before.map(\.id))))
        XCTAssertEqual(board.items, before)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: board.media.path).sorted(), files)
    }
}
