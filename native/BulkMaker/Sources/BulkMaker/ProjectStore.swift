import AppKit
import CarouselEngine
import Foundation
import Observation

/// What a project remembers: its name and the batch inputs it last had.
struct Project: Codable, Equatable {
    var id = UUID()
    var name: String
    var created = Date()
    /// Photos, references, CSV and output, as the batch screen last had them for this project.
    var selection: BatchSelection?
    /// Where photos and references come from when they mix Finder and canvas.
    var photoSources: InputSources?
    var desiredSources: InputSources?
    /// What the project sells, from onboarding: the site and a one-line description.
    var site: String?
    var about: String?
    /// Everything onboarding learned about the product (also written as `perfil-produto.md`).
    var profile: ProductProfile?
    /// Soft deletion keeps every project path stable until restoration or permanent removal.
    var trashedAt: Date?

    /// The onboarding's facts, including the description typed before AI enrichment finishes.
    var productContext: String? {
        guard profile != nil || site != nil || about != nil else { return nil }
        var facts = profile ?? ProductProfile()
        if facts.name.isEmpty { facts.name = name }
        if facts.site.isEmpty { facts.site = site ?? "" }
        if facts.whatItDoes.isEmpty { facts.whatItDoes = about ?? "" }
        return facts.markdown
    }

    func sources(for kind: InputKind) -> InputSources? {
        switch kind {
        case .photos: return photoSources
        case .desired: return desiredSources
        }
    }
}

/// A project on disk: a real folder with `projeto.json`, its own canvas and, by default, its output.
struct ProjectFolder: Identifiable, Equatable {
    let folder: URL
    var project: Project

    var id: UUID { project.id }
    var name: String { project.name }
    var trashExpiresAt: Date? { project.trashedAt?.addingTimeInterval(ProjectStore.trashRetention) }
    var canvasDirectory: URL { folder.appendingPathComponent("Canvas", isDirectory: true) }
    var defaultOutput: URL { folder.appendingPathComponent("Saída", isDirectory: true) }
    var file: URL { folder.appendingPathComponent("projeto.json") }
    /// The project's posting calendar, saved here while another project is open.
    var agendaFile: URL { folder.appendingPathComponent("agenda.json") }
    /// The brand's icon, read from its site in onboarding.
    var iconFile: URL { folder.appendingPathComponent("icone.png") }
    /// Where mixed sources are gathered for the batch (`Entradas/Fotos`, `Entradas/Resultado desejado`).
    func inputsFolder(_ kind: InputKind) -> URL {
        folder.appendingPathComponent("Entradas", isDirectory: true).appendingPathComponent(kind.title, isDirectory: true)
    }
}

/// The user's projects: one folder each under `~/The Carousel Maker`. The batch screen reads its
/// inputs from `.bulk-maker/selecao.json` and the calendar (and the AI) its posts from `.bulk-maker/agenda.json`,
/// so switching projects saves both files into the project being left and puts the next project's in their
/// place; the screen and the calendar pick them up on their next poll.
@MainActor @Observable
final class ProjectStore {
    static let shared = ProjectStore(movingFrom: ProjectStore.documentsRoot)

    nonisolated static let trashRetention: TimeInterval = 30 * 24 * 60 * 60

    nonisolated static let currentKey = "currentProject"
    /// Name and folder of the open project, readable off the main actor (the AI state is written there).
    nonisolated static let summaryKey = "currentProjectSummary"
    nonisolated static let canvasKey = "currentProjectCanvas"
    nonisolated static let productContextKey = "currentProjectProductContext"

    let root: URL
    private let selectionFile: URL
    /// The live calendar everything reads and writes: always the open project's.
    var liveAgenda: URL { selectionFile.deletingLastPathComponent().appendingPathComponent("agenda.json") }
    private let legacyCanvas: URL
    private let defaults: UserDefaults
    private(set) var projects: [ProjectFolder] = []
    private(set) var current: ProjectFolder
    private(set) var trashedProjects: [ProjectFolder] = []
    private(set) var trashCleanupError: String?

    /// In the home folder, not Documents: Documents syncs with iCloud, and "Optimize Mac Storage" takes files
    /// off the Mac when the disk fills up, exactly when a batch needs its photos, canvas and slides.
    nonisolated static var defaultRoot: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("The Carousel Maker", isDirectory: true)
    }

    /// Where the first version kept projects; the shared store moves them out once.
    nonisolated static var documentsRoot: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("The Carousel Maker", isDirectory: true)
    }

    nonisolated static var currentSummary: String? { UserDefaults.standard.string(forKey: summaryKey) }
    nonisolated static var currentCanvas: String? { UserDefaults.standard.string(forKey: canvasKey) }
    nonisolated static var currentProductContext: String? { UserDefaults.standard.string(forKey: productContextKey) }

    /// `oldRoot`: a folder of projects to move here first (only the shared store passes it, so tests never
    /// touch the user's real projects).
    init(root: URL = ProjectStore.defaultRoot, movingFrom oldRoot: URL? = nil,
         selectionFile: URL = BatchSelectionBridge.fileURL,
         legacyCanvas: URL = CanvasBoard.defaultDirectory, defaults: UserDefaults = .standard) {
        self.root = root
        self.selectionFile = selectionFile
        self.legacyCanvas = legacyCanvas
        self.defaults = defaults
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        if let oldRoot {
            let live = selectionFile.deletingLastPathComponent().appendingPathComponent("agenda.json")
            Self.moveProjects(from: oldRoot, to: root, alsoRewriting: [selectionFile, live])
        }
        let libraryMarker = root.appendingPathComponent(".library-initialized")
        let all = Self.scan(root)
        trashedProjects = all.filter { $0.project.trashedAt != nil }
        var found = all.filter { $0.project.trashedAt == nil }
        if all.isEmpty && !FileManager.default.fileExists(atPath: libraryMarker.path) {
            // First launch with projects: what the app had becomes the first one, canvas included.
            let first = Self.makeProject(named: "Meu primeiro projeto", in: root,
                                         selection: Self.readSelection(selectionFile))
            if FileManager.default.fileExists(atPath: legacyCanvas.path),
               !FileManager.default.fileExists(atPath: first.canvasDirectory.path) {
                try? FileManager.default.moveItem(at: legacyCanvas, to: first.canvasDirectory)
            }
            found = [first]
        }
        projects = found
        let saved = defaults.string(forKey: Self.currentKey).flatMap(UUID.init(uuidString:))
        current = found.first { $0.id == saved } ?? found.first ?? Self.emptyWorkspace(in: root)
        try? Data().write(to: libraryMarker, options: .atomic)
        remember()
        maintainTrash()
    }

    // MARK: - Actions

    /// A new project with its own folder and an output folder inside it, opened right away.
    @discardableResult
    func create(named rawName: String) -> ProjectFolder {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Projeto sem nome" : rawName
        var made = Self.makeProject(named: name, in: root, selection: nil)
        try? FileManager.default.createDirectory(at: made.defaultOutput, withIntermediateDirectories: true)
        made.project.selection = BatchSelection(photos: nil, desired: nil, csv: nil, output: made.defaultOutput)
        Self.save(made)
        projects.append(made)
        open(made)
        return made
    }

    /// Save the product before activating the workspace, so the AI never sees a blank new project.
    @discardableResult
    func createProduct(_ profile: ProductProfile) throws -> ProjectFolder {
        let made = Self.makeProject(named: profile.name, in: root, selection: nil)
        var ready = made
        ready.project.profile = profile
        ready.project.site = profile.site
        ready.project.about = profile.whatItDoes
        ready.project.selection = BatchSelection(photos: nil, desired: nil, csv: nil, output: ready.defaultOutput)
        do {
            try FileManager.default.createDirectory(at: ready.defaultOutput, withIntermediateDirectories: true)
            try Self.persist(ready)
            try profile.markdown.write(to: ready.folder.appendingPathComponent("perfil-produto.md"), atomically: true, encoding: .utf8)
        } catch {
            try? FileManager.default.removeItem(at: made.folder)
            throw error
        }
        projects.append(ready)
        open(ready)
        return ready
    }

    /// Editing a card must not change the selected project or another project's AI context.
    func updateProduct(_ profile: ProductProfile, in target: ProjectFolder) throws {
        guard var updated = projects.first(where: { $0.id == target.id }) else { throw TrashError.notFound }
        updated.project.name = profile.name
        updated.project.site = profile.site
        updated.project.about = profile.whatItDoes
        updated.project.profile = profile
        try Self.persist(updated)
        try profile.markdown.write(to: updated.folder.appendingPathComponent("perfil-produto.md"), atomically: true, encoding: .utf8)
        replace(updated)
        if current.id == updated.id { current = updated; remember() }
    }

    func open(_ target: ProjectFolder) {
        guard target.id != current.id, let fresh = projects.first(where: { $0.id == target.id }) else { return }
        activate(fresh)
    }

    private func activate(_ fresh: ProjectFolder) {
        // Keep what the batch screen had for the project being left.
        var leaving = current
        leaving.project.selection = Self.readSelection(selectionFile) ?? leaving.project.selection
        Self.save(leaving)
        replace(leaving)
        let leavingAgenda = try? PostAgenda.load(from: liveAgenda)
        if let data = try? Data(contentsOf: liveAgenda) { try? data.write(to: leaving.agendaFile, options: .atomic) }

        let selection = fresh.project.selection ?? BatchSelection(photos: nil, desired: nil, csv: nil, output: nil)
        if let data = try? BatchSelectionBridge.data(for: selection) {
            try? FileManager.default.createDirectory(at: selectionFile.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: selectionFile, options: .atomic)
        }
        // Written, not copied: a fresh modification date is how the calendar notices the swap.
        if let data = try? Data(contentsOf: fresh.agendaFile) {
            try? data.write(to: liveAgenda, options: .atomic)
        } else {
            // A project without a calendar yet starts empty, with the posting rules of the one being left.
            try? PostAgenda(rules: leavingAgenda?.rules ?? .init()).save(to: liveAgenda)
        }
        current = fresh
        remember()
    }

    /// Only the name shown in the app: the folder keeps its path, so scheduled posts and outputs never move.
    func rename(_ target: ProjectFolder, to rawName: String) {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, var renamed = projects.first(where: { $0.id == target.id }) else { return }
        renamed.project.name = name
        Self.save(renamed)
        replace(renamed)
        if renamed.id == current.id { current = renamed; remember() }
    }

    func setSources(_ sources: InputSources, for kind: InputKind) {
        var updated = current
        switch kind {
        case .photos: updated.project.photoSources = sources
        case .desired: updated.project.desiredSources = sources
        }
        Self.save(updated)
        replace(updated)
        current = updated
    }

    /// The open project's site and description, as typed in onboarding; blanks are dropped.
    func setProfile(site: String, about: String) {
        var updated = current
        let site = site.trimmingCharacters(in: .whitespacesAndNewlines)
        let about = about.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.project.site = site.isEmpty ? nil : site
        updated.project.about = about.isEmpty ? nil : about
        Self.save(updated)
        replace(updated)
        current = updated
        remember()
    }

    func setProductProfile(_ profile: ProductProfile) {
        var updated = current
        updated.project.profile = profile
        updated.project.site = profile.site.isEmpty ? updated.project.site : profile.site
        updated.project.about = profile.whatItDoes.isEmpty ? updated.project.about : profile.whatItDoes
        Self.save(updated)
        replace(updated)
        current = updated
        try? profile.markdown.write(to: updated.folder.appendingPathComponent("perfil-produto.md"), atomically: true, encoding: .utf8)
        remember()
    }

    /// Stored as PNG whatever the site served (ico, png, jpg), so the home can show it.
    func saveIcon(_ data: Data?) {
        guard let data, let image = NSImage(data: data), let tiff = image.tiffRepresentation,
              let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return }
        try? png.write(to: current.iconFile, options: .atomic)
    }

    /// The carousel chosen in onboarding becomes the open project's "desired result"; the batch screen
    /// picks the change up on its next poll.
    func setReference(_ folder: URL) {
        let previous = Self.readSelection(selectionFile)
        let output = previous?.output.map { URL(fileURLWithPath: $0) } ?? current.defaultOutput
        let photos = previous?.photos.map { URL(fileURLWithPath: $0) }
        let selection = BatchSelection(photos: photos, desired: folder, csv: nil, output: output)
        guard let data = try? BatchSelectionBridge.data(for: selection) else { return }
        try? FileManager.default.createDirectory(at: selectionFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: selectionFile, options: .atomic)
        var updated = current
        updated.project.selection = selection
        Self.save(updated)
        replace(updated)
        current = updated
    }

    func reveal(_ target: ProjectFolder) {
        NSWorkspace.shared.activateFileViewerSelecting([target.folder])
    }

    // MARK: - Trash

    /// Keeps the project folder in place so references and imported media survive a restore.
    func moveToTrash(_ target: ProjectFolder, at date: Date = Date()) throws {
        guard var removed = projects.first(where: { $0.id == target.id }) else { throw TrashError.notFound }
        try validateManagedFolder(removed.folder)
        if removed.id == current.id {
            removed.project.selection = Self.readSelection(selectionFile) ?? removed.project.selection
            if let data = try? Data(contentsOf: liveAgenda) { try data.write(to: removed.agendaFile, options: .atomic) }
        }
        removed.project.trashedAt = date
        try Self.persist(removed)
        projects.removeAll { $0.id == removed.id }
        trashedProjects.append(removed)
        if removed.id == current.id {
            // activate saves the old workspace too, so give it the deletion marker first.
            current = removed
            activate(projects.first ?? Self.emptyWorkspace(in: root))
        }
    }

    func restore(_ target: ProjectFolder) throws {
        guard var restored = trashedProjects.first(where: { $0.id == target.id }) else { throw TrashError.notFound }
        try validateManagedFolder(restored.folder)
        restored.project.trashedAt = nil
        try Self.persist(restored)
        trashedProjects.removeAll { $0.id == restored.id }
        projects.append(restored)
        if !projects.contains(where: { $0.id == current.id }) { activate(restored) }
    }

    /// Only the project's own folder is removed. External input/output folders are never followed.
    func deletePermanently(_ target: ProjectFolder) throws {
        guard let removed = trashedProjects.first(where: { $0.id == target.id }) else { throw TrashError.notFound }
        try validateManagedFolder(removed.folder)
        try FileManager.default.removeItem(at: removed.folder)
        trashedProjects.removeAll { $0.id == removed.id }
    }

    func purgeExpiredTrash(now: Date = Date()) throws {
        var firstError: Error?
        for project in trashedProjects where (project.trashExpiresAt ?? .distantFuture) <= now {
            do { try deletePermanently(project) } catch { if firstError == nil { firstError = error } }
        }
        if let firstError { throw firstError }
    }

    /// On launch and periodically while running; failed removals remain visible and can be retried.
    func maintainTrash() {
        do { try purgeExpiredTrash(); trashCleanupError = nil }
        catch { trashCleanupError = "Não foi possível limpar alguns projetos: \(error.localizedDescription)" }
    }

    private func validateManagedFolder(_ folder: URL) throws {
        guard folder.standardizedFileURL.deletingLastPathComponent() == root.standardizedFileURL,
              folder.resolvingSymlinksInPath().deletingLastPathComponent() == root.resolvingSymlinksInPath() else {
            throw TrashError.outsideLibrary
        }
    }

    private enum TrashError: LocalizedError {
        case notFound, outsideLibrary
        var errorDescription: String? {
            switch self {
            case .notFound: return "Este projeto não está mais nesta lista."
            case .outsideLibrary: return "A pasta do projeto está fora da biblioteca do app."
            }
        }
    }

    /// A hidden, empty workspace lets the user trash the last project without creating a new card.
    private static func emptyWorkspace(in root: URL) -> ProjectFolder {
        let folder = root.appendingPathComponent(".empty-workspace", isDirectory: true)
        if let data = try? Data(contentsOf: folder.appendingPathComponent("projeto.json")),
           let project = try? decoder.decode(Project.self, from: data) {
            return ProjectFolder(folder: folder, project: project)
        }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let empty = ProjectFolder(folder: folder, project: Project(name: "Nenhum projeto"))
        save(empty)
        return empty
    }

    // MARK: - Disk

    private func replace(_ updated: ProjectFolder) {
        if let index = projects.firstIndex(where: { $0.id == updated.id }) { projects[index] = updated }
    }

    private func remember() {
        defaults.set(current.id.uuidString, forKey: Self.currentKey)
        defaults.set("\(current.name) (`\(current.folder.path)`)", forKey: Self.summaryKey)
        defaults.set(current.canvasDirectory.path, forKey: Self.canvasKey)
        defaults.set(current.project.productContext, forKey: Self.productContextKey)
        AgentSession.updateProductContext(current.project.productContext,
                                          project: "\(current.name) (`\(current.folder.path)`)",
                                          canvas: current.canvasDirectory.path,
                                          workspace: selectionFile.deletingLastPathComponent())
    }

    /// Moves every project folder from `oldRoot` into `root` (only when `root` has none yet) and points every
    /// saved path at the new place: the projects' own files plus the live selection and calendar.
    static func moveProjects(from oldRoot: URL, to root: URL, alsoRewriting extra: [URL]) {
        let fileManager = FileManager.default
        let old = scan(oldRoot)
        guard !old.isEmpty, scan(root).isEmpty, oldRoot.standardizedFileURL != root.standardizedFileURL else { return }
        var moved: [URL] = []
        for project in old {
            let destination = root.appendingPathComponent(project.folder.lastPathComponent, isDirectory: true)
            guard !fileManager.fileExists(atPath: destination.path),
                  (try? fileManager.moveItem(at: project.folder, to: destination)) != nil else { continue }
            moved.append(destination)
        }
        let from = oldRoot.standardizedFileURL.path, to = root.standardizedFileURL.path
        let files = moved.flatMap { [$0.appendingPathComponent("projeto.json"), $0.appendingPathComponent("agenda.json")] } + extra
        for file in files {
            guard var text = try? String(contentsOf: file, encoding: .utf8) else { continue }
            // JSON written by some encoders escapes slashes; rewrite both spellings.
            let rewritten = text.replacingOccurrences(of: from + "/", with: to + "/")
                .replacingOccurrences(of: from.replacingOccurrences(of: "/", with: "\\/") + "\\/",
                                      with: to.replacingOccurrences(of: "/", with: "\\/") + "\\/")
            guard rewritten != text else { continue }
            text = rewritten
            try? text.write(to: file, atomically: true, encoding: .utf8)
        }
        // The old folder is left only if something could not move.
        if ((try? fileManager.contentsOfDirectory(atPath: oldRoot.path)) ?? []).allSatisfy({ $0.hasPrefix(".") }) {
            try? fileManager.removeItem(at: oldRoot)
        }
    }

    private static func scan(_ root: URL) -> [ProjectFolder] {
        let folders = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey],
                                                                    options: [.skipsHiddenFiles])) ?? []
        return folders.compactMap { folder -> ProjectFolder? in
            guard let data = try? Data(contentsOf: folder.appendingPathComponent("projeto.json")),
                  let project = try? decoder.decode(Project.self, from: data) else { return nil }
            return ProjectFolder(folder: folder, project: project)
        }
        .sorted { $0.project.created < $1.project.created }
    }

    private static func makeProject(named name: String, in root: URL, selection: BatchSelection?) -> ProjectFolder {
        // Folder names stay readable in Finder and never collide: "Nome", "Nome 2", "Nome 3"…
        let cleaned = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        let base = [".", "..", ""].contains(cleaned) ? "Projeto" : cleaned
        var folder = root.appendingPathComponent(base, isDirectory: true)
        var suffix = 2
        while FileManager.default.fileExists(atPath: folder.path) {
            folder = root.appendingPathComponent("\(base) \(suffix)", isDirectory: true)
            suffix += 1
        }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let made = ProjectFolder(folder: folder, project: Project(name: name, selection: selection))
        save(made)
        return made
    }

    private static func save(_ project: ProjectFolder) { try? persist(project) }

    private static func persist(_ project: ProjectFolder) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(project.project).write(to: project.file, options: .atomic)
    }

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    private static func readSelection(_ file: URL) -> BatchSelection? {
        (try? Data(contentsOf: file)).flatMap { try? BatchSelectionBridge.decode($0) }
    }
}
