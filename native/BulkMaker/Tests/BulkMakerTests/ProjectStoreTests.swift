import CarouselEngine
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

    func testProductContextUpdatesAnOpenSessionAndNeverLeaksAcrossProjects() throws {
        let store = makeStore()
        let workspace = selectionFile.deletingLastPathComponent()
        try AgentSession.install(in: workspace, state: "# Estado\n- Agenda: teste")
        store.setProfile(site: "https://produto.test", about: "Ajuda a criar uma rotina de oração")
        var profile = ProductProfile()
        profile.name = "Oração Diária"
        profile.audience = "Pessoas criando um hábito de oração"
        profile.features = ["Orações guiadas"]
        profile.umbrellaNiche = "oração"
        store.setProductProfile(profile)
        let first = store.current
        let stateFile = workspace.appendingPathComponent("estado.md")
        let state = try String(contentsOf: stateFile, encoding: .utf8)
        XCTAssertTrue(state.contains("Oração Diária"))
        XCTAssertTrue(state.contains("https://produto.test"))
        XCTAssertTrue(state.contains("Ajuda a criar uma rotina de oração"))
        XCTAssertTrue(state.contains("Orações guiadas"))
        XCTAssertTrue(state.contains("Pessoas criando um hábito de oração"))
        XCTAssertEqual(state.components(separatedBy: "<!-- produto-usuario:start -->").count, 2)
        XCTAssertEqual(defaults.string(forKey: ProjectStore.productContextKey), first.project.productContext)

        _ = store.create(named: "Outro produto")
        let other = try String(contentsOf: stateFile, encoding: .utf8)
        XCTAssertFalse(other.contains("Oração Diária"))
        XCTAssertTrue(other.contains("Perfil ainda não informado"))
        XCTAssertNil(defaults.string(forKey: ProjectStore.productContextKey))
        XCTAssertTrue(other.contains("- Canvas do projeto: `\(store.current.canvasDirectory.path)`"))
        XCTAssertFalse(other.contains(first.canvasDirectory.path))
        store.open(first)
        XCTAssertTrue(try String(contentsOf: stateFile, encoding: .utf8).contains("Orações guiadas"))
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

    func testEachProjectHasItsOwnCalendar() throws {
        let live = base.appendingPathComponent(".bulk-maker/agenda.json")
        let rules = PostAgenda.Rules(maxPerDay: 3, times: ["09:00", "12:00", "19:00"])
        let postA = PostAgenda.Post(folder: "/tmp/a/variacao-01", date: "2026-10-01", time: "12:00", caption: "a")
        try PostAgenda(rules: rules, posts: [postA]).save(to: live)
        let store = makeStore()
        let first = store.current

        // A new project starts with an empty calendar and the same posting rules.
        let second = store.create(named: "Loja")
        XCTAssertEqual(try PostAgenda.load(from: live).posts, [])
        XCTAssertEqual(try PostAgenda.load(from: live).rules, rules)

        let postB = PostAgenda.Post(folder: "/tmp/b/variacao-01", date: "2026-10-02", time: "19:00", caption: "b")
        try PostAgenda(rules: rules, posts: [postB]).save(to: live)
        store.open(first)
        XCTAssertEqual(try PostAgenda.load(from: live).posts.map(\.id), [postA.id])
        store.open(second)
        XCTAssertEqual(try PostAgenda.load(from: live).posts.map(\.id), [postB.id])
        XCTAssertEqual(try PostAgenda.load(from: first.agendaFile).posts.map(\.id), [postA.id])
    }

    func testProjectsMoveOutOfICloudDocumentsWithTheirPaths() throws {
        // A project made by the first version, under a Documents-like folder, with its own output and calendar.
        let oldRoot = base.appendingPathComponent("Documents/The Carousel Maker")
        let oldStore = ProjectStore(root: oldRoot, selectionFile: selectionFile, legacyCanvas: legacyCanvas, defaults: defaults)
        let made = oldStore.create(named: "Loja")
        let post = PostAgenda.Post(folder: made.defaultOutput.appendingPathComponent("variacao-01").path,
                                   date: "2026-10-01", time: "12:00", caption: "")
        let live = base.appendingPathComponent(".bulk-maker/agenda.json")
        try PostAgenda(posts: [post]).save(to: live)
        XCTAssertTrue(try String(contentsOf: selectionFile, encoding: .utf8).contains("Documents"))

        let store = ProjectStore(root: root, movingFrom: oldRoot, selectionFile: selectionFile,
                                 legacyCanvas: legacyCanvas, defaults: defaults)
        XCTAssertEqual(Set(store.projects.map(\.name)), ["Meu primeiro projeto", "Loja"])
        XCTAssertFalse(FileManager.default.fileExists(atPath: oldRoot.path))
        let moved = try XCTUnwrap(store.projects.first { $0.name == "Loja" })
        XCTAssertEqual(moved.folder.deletingLastPathComponent().standardizedFileURL, root.standardizedFileURL)
        // /var and /private/var are the same folder on macOS; compare real paths.
        func real(_ path: String?) -> String? { path.map { URL(fileURLWithPath: $0).resolvingSymlinksInPath().path } }
        let output = real(moved.defaultOutput.path)
        XCTAssertEqual(real(moved.project.selection?.output), output)
        XCTAssertEqual(real(try readSelection().output), output)
        XCTAssertEqual(real(try PostAgenda.load(from: live).posts.first?.folder), output.map { $0 + "/variacao-01" })
        XCTAssertEqual(store.current.id, moved.id)
    }
    func testTrashAndRestorePreserveFilesInputsCalendarAndIdentity() throws {
        let store = makeStore()
        let first = store.current
        let project = store.create(named: "Restaurável")
        try FileManager.default.createDirectory(at: project.canvasDirectory, withIntermediateDirectories: true)
        let canvasFile = project.canvasDirectory.appendingPathComponent("board.json")
        let canvas = Data("conteúdo intacto".utf8)
        try canvas.write(to: canvasFile)
        try writeSelection(photos: "/tmp/fotos-para-restaurar", output: project.defaultOutput.path)
        let post = PostAgenda.Post(folder: project.defaultOutput.path, date: "2026-10-01", time: "12:00", caption: "legenda")
        let live = base.appendingPathComponent(".bulk-maker/agenda.json")
        try PostAgenda(posts: [post]).save(to: live)
        try store.moveToTrash(project)
        XCTAssertEqual(store.current.id, first.id)
        XCTAssertFalse(store.projects.contains { $0.id == project.id })
        XCTAssertEqual(store.trashedProjects.map(\.id), [project.id])
        XCTAssertEqual(try Data(contentsOf: canvasFile), canvas)
        XCTAssertEqual(try PostAgenda.load(from: project.agendaFile).posts.map(\.id), [post.id])

        let reopened = makeStore()
        let trashed = try XCTUnwrap(reopened.trashedProjects.first)
        XCTAssertNotNil(trashed.project.trashedAt)
        try reopened.restore(trashed)
        reopened.open(project)
        XCTAssertEqual(reopened.current.id, project.id)
        XCTAssertNil(reopened.current.project.trashedAt)
        XCTAssertEqual(try readSelection().photos, "/tmp/fotos-para-restaurar")
        XCTAssertEqual(try PostAgenda.load(from: live).posts.map(\.id), [post.id])
        XCTAssertEqual(try Data(contentsOf: canvasFile), canvas)
        XCTAssertTrue(makeStore().trashedProjects.isEmpty)
    }

    func testLastProjectCanBeTrashedAndRestoredWithoutCreatingAnotherCard() throws {
        let store = makeStore()
        let last = store.current
        try store.moveToTrash(last)
        XCTAssertTrue(store.projects.isEmpty)
        XCTAssertNotEqual(store.current.id, last.id)
        XCTAssertNil(try readSelection().output)
        let reopened = makeStore()
        XCTAssertTrue(reopened.projects.isEmpty)
        XCTAssertEqual(reopened.trashedProjects.count, 1)
        try reopened.restore(last)
        XCTAssertEqual(reopened.current.id, last.id)
        XCTAssertEqual(reopened.projects.map(\.id), [last.id])
    }

    func testPermanentDeletionRemovesOnlyTrashedProjectAndPreservesExternalFiles() throws {
        let store = makeStore()
        let last = store.current
        let external = base.appendingPathComponent("Fotos externas")
        try FileManager.default.createDirectory(at: external, withIntermediateDirectories: true)
        let file = external.appendingPathComponent("original.png")
        try Data("original".utf8).write(to: file)
        try writeSelection(photos: external.path, output: external.path)
        XCTAssertThrowsError(try store.deletePermanently(last), "Um projeto ativo nunca pode ser excluído diretamente")
        try store.moveToTrash(last)
        try store.deletePermanently(last)
        XCTAssertFalse(FileManager.default.fileExists(atPath: last.folder.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
        XCTAssertTrue(store.trashedProjects.isEmpty)
        XCTAssertTrue(makeStore().projects.isEmpty, "Reabrir não pode recriar um projeto apagado")
        XCTAssertThrowsError(try store.restore(last))
        let new = store.create(named: "Novo depois de apagar todos")
        XCTAssertEqual(store.projects.map(\.id), [new.id])
    }

    func testTrashExpiresAtThirtyDaysAndNotBefore() throws {
        let store = makeStore()
        let project = store.create(named: "Prazo")
        let deletedAt = Date()
        try store.moveToTrash(project, at: deletedAt)
        let deadline = deletedAt.addingTimeInterval(30 * 24 * 60 * 60)
        try store.purgeExpiredTrash(now: deadline.addingTimeInterval(-1))
        XCTAssertEqual(store.trashedProjects.count, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: project.folder.path))
        try store.purgeExpiredTrash(now: deadline)
        XCTAssertTrue(store.trashedProjects.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: project.folder.path))
        XCTAssertEqual(store.projects.count, 1)
    }

    func testReopeningCleansExpiredTrashAndKeepsRecentTrashAndActiveProjects() throws {
        let store = makeStore()
        let active = store.current
        let expired = store.create(named: "Antigo")
        let recent = store.create(named: "Recente")
        try store.moveToTrash(expired, at: Date().addingTimeInterval(-31 * 24 * 60 * 60))
        try store.moveToTrash(recent)
        let reopened = makeStore()
        XCTAssertEqual(reopened.projects.map(\.id), [active.id])
        XCTAssertEqual(reopened.trashedProjects.map(\.id), [recent.id])
        XCTAssertFalse(FileManager.default.fileExists(atPath: expired.folder.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: recent.folder.path))
    }

    func testFailedTrashSaveDoesNotRemoveProjectFromActiveList() throws {
        let store = makeStore()
        let project = store.current
        try FileManager.default.removeItem(at: project.file)
        try FileManager.default.createDirectory(at: project.file, withIntermediateDirectories: false)
        XCTAssertThrowsError(try store.moveToTrash(project))
        XCTAssertEqual(store.projects.map(\.id), [project.id])
        XCTAssertEqual(store.current.id, project.id)
        XCTAssertTrue(store.trashedProjects.isEmpty)
    }

    func testTrashRejectsSymlinksOutsideTheProjectLibrary() throws {
        let original = makeStore().current
        let external = base.appendingPathComponent("Fora da biblioteca")
        try FileManager.default.moveItem(at: original.folder, to: external)
        try FileManager.default.createSymbolicLink(at: original.folder, withDestinationURL: external)
        let store = makeStore()
        XCTAssertThrowsError(try store.moveToTrash(store.current))
        XCTAssertTrue(FileManager.default.fileExists(atPath: external.appendingPathComponent("projeto.json").path))
    }

}
