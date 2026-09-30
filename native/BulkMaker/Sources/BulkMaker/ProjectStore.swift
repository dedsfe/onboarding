import AppKit
import Foundation
import Observation

/// What a project remembers: its name and the batch inputs it last had.
struct Project: Codable, Equatable {
    var id = UUID()
    var name: String
    var created = Date()
    /// Photos, references, CSV and output, as the batch screen last had them for this project.
    var selection: BatchSelection?
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
}

/// The user's projects: one folder each under `~/Documents/The Carousel Maker`. The batch screen reads its
/// inputs from `.bulk-maker/selecao.json`, so switching projects saves that file into the project being left
/// and writes the next project's selection in its place; the screen picks it up on its next poll.
@MainActor @Observable
final class ProjectStore {
    static let shared = ProjectStore()

    nonisolated static let currentKey = "currentProject"
    /// Name and folder of the open project, readable off the main actor (the AI state is written there).
    nonisolated static let summaryKey = "currentProjectSummary"

    let root: URL
    private let selectionFile: URL
    private let legacyCanvas: URL
    private let defaults: UserDefaults
    private(set) var projects: [ProjectFolder] = []
    private(set) var current: ProjectFolder

    nonisolated static var defaultRoot: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("The Carousel Maker", isDirectory: true)
    }

    nonisolated static var currentSummary: String? { UserDefaults.standard.string(forKey: summaryKey) }

    init(root: URL = ProjectStore.defaultRoot, selectionFile: URL = BatchSelectionBridge.fileURL,
         legacyCanvas: URL = CanvasBoard.defaultDirectory, defaults: UserDefaults = .standard) {
        self.root = root
        self.selectionFile = selectionFile
        self.legacyCanvas = legacyCanvas
        self.defaults = defaults
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
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

        let selection = fresh.project.selection ?? BatchSelection(photos: nil, desired: nil, csv: nil, output: nil)
        if let data = try? BatchSelectionBridge.data(for: selection) {
            try? FileManager.default.createDirectory(at: selectionFile.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: selectionFile, options: .atomic)
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
