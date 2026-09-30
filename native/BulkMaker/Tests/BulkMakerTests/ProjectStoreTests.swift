import XCTest
@testable import BulkMaker

@MainActor
final class ProjectStoreTests: XCTestCase {
    private var base: URL!
    private var defaults: UserDefaults!
    private var root: URL { base.appendingPathComponent("Projetos") }
    private var selectionFile: URL { base.appendingPathComponent(".bulk-maker/selecao.json") }
    private var legacyCanvas: URL { base.appendingPathComponent("Canvas") }

    override func setUp() async throws {
        base = FileManager.default.temporaryDirectory.appendingPathComponent("projetos-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: base.appendingPathComponent(".bulk-maker"), withIntermediateDirectories: true)
        defaults = UserDefaults(suiteName: "projetos-\(UUID().uuidString)")
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: base)
    }

    private func makeStore() -> ProjectStore {
        ProjectStore(root: root, selectionFile: selectionFile, legacyCanvas: legacyCanvas, defaults: defaults)
    }

    private func writeSelection(photos: String?, output: String?) throws {
        let selection = BatchSelection(photos: photos.map { URL(fileURLWithPath: $0) }, desired: nil, csv: nil,
                                       output: output.map { URL(fileURLWithPath: $0) })
        try BatchSelectionBridge.data(for: selection).write(to: selectionFile)
    }

    private func readSelection() throws -> BatchSelection {
        try BatchSelectionBridge.decode(Data(contentsOf: selectionFile))
    }

    func testFirstLaunchTurnsWhatTheAppHadIntoTheFirstProject() throws {
        try writeSelection(photos: "/tmp/fotos", output: "/tmp/saida")
        try FileManager.default.createDirectory(at: legacyCanvas, withIntermediateDirectories: true)
        try Data("[]".utf8).write(to: legacyCanvas.appendingPathComponent("board.json"))

        let store = makeStore()
        XCTAssertEqual(store.projects.map(\.name), ["Meu primeiro projeto"])
        XCTAssertEqual(store.current.project.selection?.photos, "/tmp/fotos")
        XCTAssertTrue(FileManager.default.fileExists(atPath: store.current.canvasDirectory.appendingPathComponent("board.json").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacyCanvas.path))
    }

    func testEachProjectKeepsItsOwnInputsWhenSwitching() throws {
        try writeSelection(photos: "/tmp/fotos-a", output: "/tmp/saida-a")
        let store = makeStore()
        let first = store.current

        let second = store.create(named: "Clientes/Loja")
        XCTAssertEqual(store.current.id, second.id)
        XCTAssertEqual(second.folder.lastPathComponent, "Clientes-Loja")
        XCTAssertTrue(FileManager.default.fileExists(atPath: second.defaultOutput.path))
        XCTAssertNil(try readSelection().photos)
        XCTAssertEqual(try readSelection().output, second.defaultOutput.path)

        // The batch screen picks photos for the second project, then the user goes back to the first.
        try writeSelection(photos: "/tmp/fotos-b", output: second.defaultOutput.path)
        store.open(first)
        XCTAssertEqual(try readSelection().photos, "/tmp/fotos-a")
        store.open(second)
        XCTAssertEqual(try readSelection().photos, "/tmp/fotos-b")

        // Reopening the app lands on the last project, with every project listed.
        let reopened = makeStore()
        XCTAssertEqual(reopened.current.id, second.id)
        XCTAssertEqual(reopened.projects.count, 2)
    }

    func testRenameChangesOnlyTheNameAndFoldersNeverCollide() throws {
        let store = makeStore()
        let made = store.create(named: "Oração")
        let twin = store.create(named: "Oração")
        XCTAssertEqual(twin.folder.lastPathComponent, "Oração 2")

        store.rename(made, to: "Oração Diária")
        let renamed = try XCTUnwrap(store.projects.first { $0.id == made.id })
        XCTAssertEqual(renamed.name, "Oração Diária")
        XCTAssertEqual(renamed.folder, made.folder)
        XCTAssertEqual(makeStore().projects.first { $0.id == made.id }?.name, "Oração Diária")
    }

    func testAIStateNamesTheOpenProject() {
        let state = AgentSession.state(photos: nil, desired: nil, csv: nil, output: nil, variations: 1,
                                       design: DesignPreferences(), custom: false, project: "Loja (`/tmp/Loja`)")
        XCTAssertTrue(state.contains("- Projeto: Loja (`/tmp/Loja`)\n- Fotos:"))
    }
}
