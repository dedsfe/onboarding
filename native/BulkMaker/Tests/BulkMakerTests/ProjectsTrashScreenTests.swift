import AppKit
import SwiftUI
import XCTest
@testable import BulkMaker

@MainActor
final class ProjectsTrashScreenTests: XCTestCase {
    private var directory: URL!
    private var defaults: UserDefaults!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("ProjectsTrash-\(UUID().uuidString)")
        defaults = UserDefaults(suiteName: "ProjectsTrash-\(UUID().uuidString)")
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: directory) }

    private func click(_ frame: CGRect, in hosting: NSView, window: NSWindow) throws {
        let local = CGPoint(x: frame.midX, y: hosting.isFlipped ? frame.midY : hosting.bounds.height - frame.midY)
        let point = hosting.convert(local, to: nil)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            window.sendEvent(try XCTUnwrap(NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0)))
        }
    }

    private func button(_ title: String, in view: NSView) -> NSButton? {
        if let button = view as? NSButton, button.title == title { return button }
        return view.subviews.lazy.compactMap { self.button(title, in: $0) }.first
    }

    func testTrashControlsRestoreAndRequireConfirmationBeforePermanentDeletion() async throws {
        let store = ProjectStore(root: directory.appendingPathComponent("Projects"),
                                 selectionFile: directory.appendingPathComponent("live/selecao.json"),
                                 legacyCanvas: directory.appendingPathComponent("legacy"), defaults: defaults)
        let restored = store.create(named: "Projeto para restaurar")
        let deleted = store.create(named: "Projeto para excluir")
        try store.moveToTrash(restored)
        try store.moveToTrash(deleted)
        var frames: [String: CGRect] = [:]
        let hosting = NSHostingView(rootView: ProjectsTrashView(store: store, onControlFrame: { frames[$0] = $1 })
            .environment(\.colorScheme, .dark).foregroundStyle(.white).frame(width: 720, height: 690))
        let window = NSWindow(contentRect: CGRect(x: 120, y: 120, width: 720, height: 690),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "Lixeira QA"
        window.contentView = hosting
        defer { window.orderOut(nil); window.contentView = nil }
        _ = NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(300))
        if let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) {
            hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
            try bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: "/private/tmp/projects-trash-qa.png"))
        }

        for frame in frames.values {
            XCTAssertTrue(CGRect(x: 0, y: 0, width: 720, height: 690).contains(frame), "Controle fora da tela: \(frame)")
        }
        try click(try XCTUnwrap(frames["restore-\(restored.id)"]), in: hosting, window: window)
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(store.trashedProjects.count, 1, "Restaurar precisa responder ao clique")
        XCTAssertEqual(store.projects.count, 2)

        try click(try XCTUnwrap(frames["empty"]), in: hosting, window: window)
        try await Task.sleep(for: .milliseconds(250))
        XCTAssertEqual(store.trashedProjects.count, 1, "Pedir exclusão não pode apagar antes de confirmar")
        let sheet = try XCTUnwrap(window.attachedSheet)
        try XCTUnwrap(button("Cancelar", in: try XCTUnwrap(sheet.contentView))).performClick(nil)
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(store.trashedProjects.count, 1)
        XCTAssertNil(window.attachedSheet)

        try click(try XCTUnwrap(frames["delete-\(deleted.id)"]), in: hosting, window: window)
        try await Task.sleep(for: .milliseconds(250))
        let confirmation = try XCTUnwrap(window.attachedSheet)
        // Invoke the native confirmation button; macOS suppresses destructive first clicks in inactive test hosts.
        try XCTUnwrap(button("Excluir definitivamente", in: try XCTUnwrap(confirmation.contentView))).performClick(nil)
        try await Task.sleep(for: .milliseconds(250))
        XCTAssertTrue(store.trashedProjects.isEmpty)
        XCTAssertEqual(store.projects.count, 2)
        let remaining = Set(store.projects.map(\.id))
        XCTAssertEqual(remaining.intersection([restored.id, deleted.id]).count, 1)
    }
}
