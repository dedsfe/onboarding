import AppKit
import SwiftUI
import XCTest
@testable import BulkMaker

@MainActor
final class ProjectProductSetupTests: XCTestCase {
    private var directory: URL!
    private var defaults: UserDefaults!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("ProductSetup-\(UUID().uuidString)")
        defaults = UserDefaults(suiteName: "ProductSetup-\(UUID().uuidString)")
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: directory) }

    private func store() -> ProjectStore {
        ProjectStore(root: directory.appendingPathComponent("Projects"),
                     selectionFile: directory.appendingPathComponent("live/selecao.json"),
                     legacyCanvas: directory.appendingPathComponent("legacy"), defaults: defaults)
    }

    private func profile(_ name: String = "Meu produto") -> ProductProfile {
        var profile = ProductProfile()
        profile.name = name
        profile.site = "https://produto.test/app"
        profile.whatItDoes = "Ajuda pessoas a manter uma rotina de oração."
        profile.audience = "Pessoas que querem orar todos os dias"
        return profile
    }

    func testNewProductIsPersistedAndSwitchesTheLiveAIContext() throws {
        let store = store()
        let workspace = directory.appendingPathComponent("live")
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        try AgentSession.install(in: workspace, state: "# Estado\n- Agenda: teste")
        let first = try store.createProduct(profile("Oração"))
        let second = try store.createProduct(profile("Outro produto"))
        XCTAssertEqual(store.current.project.profile, profile("Outro produto"))
        XCTAssertEqual(try String(contentsOf: second.folder.appendingPathComponent("perfil-produto.md"), encoding: .utf8), profile("Outro produto").markdown)
        var state = try String(contentsOf: workspace.appendingPathComponent("estado.md"), encoding: .utf8)
        XCTAssertTrue(state.contains("Outro produto"))
        XCTAssertFalse(state.contains("# Oração\n"))
        store.open(first)
        state = try String(contentsOf: workspace.appendingPathComponent("estado.md"), encoding: .utf8)
        XCTAssertTrue(state.contains("# Oração\n"))
        XCTAssertFalse(state.contains("# Outro produto\n"))
        XCTAssertEqual(self.store().current.project.profile, profile("Oração"))
    }

    func testEditingAnotherProductKeepsSelectionAndAIContext() throws {
        let store = store()
        let first = try store.createProduct(profile("Primeiro"))
        let second = try store.createProduct(profile("Segundo"))
        try store.updateProduct(profile("Primeiro revisado"), in: first)
        XCTAssertEqual(store.current.id, second.id)
        XCTAssertEqual(defaults.string(forKey: ProjectStore.productContextKey), profile("Segundo").markdown)
        store.open(first)
        XCTAssertEqual(store.current.project.profile, profile("Primeiro revisado"))
        XCTAssertEqual(store.current.folder, first.folder)
    }

    func testDraftRequiresLinkNameAndDescriptionAndNormalizesLink() {
        let draft = ProjectProductDraft()
        XCTAssertNil(draft.confirmedProfile)
        draft.profile = profile()
        draft.profile.site = " produto.test/app "
        draft.profile.name = " Meu produto \n"
        XCTAssertEqual(draft.confirmedProfile?.site, "https://produto.test/app")
        XCTAssertEqual(draft.confirmedProfile?.name, "Meu produto")
        draft.profile.whatItDoes = " \n"
        XCTAssertNil(draft.confirmedProfile)
        XCTAssertNil(ProjectProductDraft.productURL("ftp://produto.test"))
        XCTAssertNil(ProjectProductDraft.productURL("https://user:secret@produto.test"))
    }

    func testFailedSiteStillAllowsManualCreationAndCancelledReadCannotReplaceDraft() async throws {
        let draft = ProjectProductDraft()
        draft.profile = profile()
        draft.readSite(read: { _ in throw URLError(.cannotConnectToHost) }, understand: { _ in XCTFail("Should not call AI"); return ProductProfile() })
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertFalse(draft.reading)
        XCTAssertNotNil(draft.confirmedProfile)
        XCTAssertTrue(draft.status?.contains("preencher") == true)

        let snapshot = SiteSnapshot(url: URL(string: "https://outro.test")!, name: "Resposta antiga", text: "")
        draft.readSite(read: { _ in
            // Simulate a loader that does not honor cancellation.
            await withCheckedContinuation { continuation in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { continuation.resume(returning: ()) }
            }
            return snapshot
        }, understand: { _ in self.profile("Resposta antiga") })
        draft.cancelReading()
        draft.profile.name = "Nome manual"
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(draft.profile.name, "Nome manual")
        XCTAssertFalse(draft.reading)
    }

    func testSiteReadKeepsExactProductPathWhenPageRedirects() async throws {
        let draft = ProjectProductDraft()
        draft.profile.site = "https://apps.test/br/app/meu-app/id123"
        let snapshot = SiteSnapshot(url: URL(string: "https://apps.test/")!, name: "Meu App", text: "")
        draft.readSite(read: { _ in snapshot }, understand: { _ in self.profile("Meu App") })
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(draft.confirmedProfile?.site, "https://apps.test/br/app/meu-app/id123")
    }

    private func click(_ frame: CGRect, in hosting: NSView, window: NSWindow) throws {
        let local = CGPoint(x: frame.midX, y: hosting.isFlipped ? frame.midY : hosting.bounds.height - frame.midY)
        let point = hosting.convert(local, to: nil)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            window.sendEvent(try XCTUnwrap(NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0)))
        }
    }

    func testRealClicksCreateProductAndCancelLeavesNoProject() async throws {
        let store = store()
        let count = store.projects.count
        let original = store.current.id
        let draft = ProjectProductDraft(readPage: { url in
            try await Task.sleep(for: .seconds(2))
            return SiteSnapshot(url: url, name: "Produto lido", text: "")
        }, understandPage: { _ in self.profile() })
        draft.profile = profile("Oração Diária")
        var frames: [String: CGRect] = [:]
        var saved = false, cancelled = false
        let hosting = NSHostingView(rootView: ZStack {
            Image(nsImage: IntroductionAssets.painting).resizable().scaledToFill()
                .frame(width: 560, height: 568).clipped()
            ProjectProductSetup(store: store, draft: draft,
                cancel: { cancelled = true }, saved: { saved = true }, onControlFrame: { frames[$0] = $1 })
        })
        let window = NSWindow(contentRect: CGRect(x: 120, y: 120, width: 560, height: 568),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "Novo produto QA"
        window.contentView = hosting
        defer { window.orderOut(nil); window.contentView = nil }
        _ = NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(350))
        // Native glass is composed by WindowServer and is absent from cacheDisplay bitmaps.
        let capture = Process()
        capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        capture.arguments = ["-x", "-o", "-l", String(window.windowNumber), "/private/tmp/project-product-glass-qa.png"]
        try capture.run()
        capture.waitUntilExit()
        XCTAssertEqual(Set(frames.keys), ["save", "cancel", "read", "close"])
        for frame in frames.values { XCTAssertTrue(hosting.bounds.contains(frame), "Controle fora da tela: \(frame)") }
        try click(try XCTUnwrap(frames["cancel"]), in: hosting, window: window)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertTrue(cancelled)
        XCTAssertEqual(store.projects.count, count)
        XCTAssertEqual(store.current.id, original)
        try click(try XCTUnwrap(frames["save"]), in: hosting, window: window)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertTrue(saved)
        XCTAssertEqual(store.projects.count, count + 1)
        XCTAssertEqual(store.current.project.profile, profile("Oração Diária"))
        try click(try XCTUnwrap(frames["read"]), in: hosting, window: window)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertTrue(draft.reading)
        try click(try XCTUnwrap(frames["read"]), in: hosting, window: window)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertFalse(draft.reading, "Parar leitura precisa responder ao clique")
        cancelled = false
        try click(try XCTUnwrap(frames["close"]), in: hosting, window: window)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertTrue(cancelled, "Fechar precisa responder ao clique")
    }
}
