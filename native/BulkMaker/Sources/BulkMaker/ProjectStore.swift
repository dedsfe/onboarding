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
    var canvasDirectory: URL { folder.appendingPathComponent("Canvas", isDirectory: true) }
    var defaultOutput: URL { folder.appendingPathComponent("Saída", isDirectory: true) }
    var file: URL { folder.appendingPathComponent("projeto.json") }
    /// The project's posting calendar, saved here while another project is open.
    var agendaFile: URL { folder.appendingPathComponent("agenda.json") }
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

    nonisolated static let currentKey = "currentProject"
    /// Name and folder of the open project, readable off the main actor (the AI state is written there).
    nonisolated static let summaryKey = "currentProjectSummary"
    nonisolated static let canvasKey = "currentProjectCanvas"

    let root: URL
    private let selectionFile: URL
    /// The live calendar everything reads and writes: always the open project's.
    private var liveAgenda: URL { selectionFile.deletingLastPathComponent().appendingPathComponent("agenda.json") }
    private let legacyCanvas: URL
    private let defaults: UserDefaults
    private(set) var projects: [ProjectFolder] = []
    private(set) var current: ProjectFolder

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
        var found = Self.scan(root)
        if found.isEmpty {
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
        current = found.first { $0.id == saved } ?? found[0]
        remember()
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

    func open(_ target: ProjectFolder) {
        guard target.id != current.id, let fresh = projects.first(where: { $0.id == target.id }) else { return }
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

    func reveal(_ target: ProjectFolder) {
        NSWorkspace.shared.activateFileViewerSelecting([target.folder])
    }

    // MARK: - Disk

    private func replace(_ updated: ProjectFolder) {
        if let index = projects.firstIndex(where: { $0.id == updated.id }) { projects[index] = updated }
    }

    private func remember() {
        defaults.set(current.id.uuidString, forKey: Self.currentKey)
        defaults.set("\(current.name) (`\(current.folder.path)`)", forKey: Self.summaryKey)
        defaults.set(current.canvasDirectory.path, forKey: Self.canvasKey)
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
        let base = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
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

    private static func save(_ project: ProjectFolder) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        try? encoder.encode(project.project).write(to: project.file, options: .atomic)
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
