import AppKit
import Foundation

/// Keeps the AI workspace (`.bulk-maker`) in sync with what the user picks in the app.
enum TerminalHandoff {
    /// Where the app keeps its batch workspace (`.bulk-maker`) and runs the AI sessions. It lives in
    /// Application Support, so the app works on any Mac without its source code next to it.
    static let projectDirectory: URL = {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("The Carousel Maker", isDirectory: true)
        let workspace = root.appendingPathComponent(".bulk-maker", isDirectory: true)
        try? FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        // Dev builds used to keep the workspace in the repo; carry the last folder selection over once.
        var legacy = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { legacy.deleteLastPathComponent() }
        let oldSelection = legacy.appendingPathComponent(".bulk-maker/selecao.json")
        let newSelection = workspace.appendingPathComponent("selecao.json")
        if !FileManager.default.fileExists(atPath: newSelection.path),
           FileManager.default.fileExists(atPath: oldSelection.path) {
            try? FileManager.default.copyItem(at: oldSelection, to: newSelection)
        }
        return root
    }()

    static func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    static func updateContext(photos: URL?, desired: URL?, csv: URL?, output: URL?, variations: Int = 1) throws {
        let workspace = projectDirectory.appendingPathComponent(".bulk-maker", isDirectory: true)
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        try prepareDesignAssets(in: workspace)
        try writeJob(photos: photos, desired: desired, csv: csv, output: output,
                     variations: variations, to: workspace)
    }

    /// Rewrites everything an AI session reads (instructions, live state, style, renderer) plus the
    /// selection bridge. Runs on every change in the app.
    @discardableResult
    static func prepare(photos: URL?, desired: URL?, csv: URL?, output: URL?, variations: Int = 1,
                        workspaceRoot: URL? = nil) throws -> URL {
        let root = workspaceRoot ?? projectDirectory
        let workspace = root.appendingPathComponent(".bulk-maker", isDirectory: true)
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        try prepareDesignAssets(in: workspace)
        try writeJob(photos: photos, desired: desired, csv: csv, output: output,
                     variations: variations, to: workspace)
        let selection = BatchSelection(photos: photos, desired: desired, csv: csv, output: output)
        try BatchSelectionBridge.data(for: selection)
            .write(to: workspace.appendingPathComponent("selecao.json"), options: .atomic)
        // Files from the old handoff flow, replaced by sessao.md and the embedded terminal.
        for legacy in ["contexto.md", "abrir-terminal.command"] {
            try? FileManager.default.removeItem(at: workspace.appendingPathComponent(legacy))
        }
        return workspace
    }

    private static func writeJob(photos: URL?, desired: URL?, csv: URL?, output: URL?,
                                 variations: Int, to workspace: URL) throws {
        let design = DesignPreferences.current
        let fields: [String: Any] = [
            "version": 1,
            "photos": photos?.path as Any? ?? NSNull(),
            "desired": desired?.path as Any? ?? NSNull(),
            "csv": csv?.path as Any? ?? NSNull(),
            "output": output?.path as Any? ?? NSNull(),
            "variations": variations,
            "design": [
                "mode": UserDefaults.standard.string(forKey: DesignPreferences.modeKey) ?? "agent",
                "titleFont": design.titleFont,
                "titleWeight": design.titleWeight,
                "titleSize": design.titleSize,
                "textColor": design.textColor,
                "align": design.align,
                "strokeWidth": design.strokeWidth,
                "strokeColor": design.strokeColor,
                "position": design.position,
                "textCase": design.textCase,
                "highlight": design.highlight
            ]
        ]
        let data = try JSONSerialization.data(withJSONObject: fields, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: workspace.appendingPathComponent("trabalho.json"), options: .atomic)
        try AgentSession.install(in: workspace, state: AgentSession.state(
            photos: photos, desired: desired, csv: csv, output: output, variations: variations, design: design,
            custom: UserDefaults.standard.string(forKey: DesignPreferences.modeKey) == "custom"))
    }

    /// The native renderer ships next to the app binary (run-mac.sh); under `swift test` it sits
    /// beside the .xctest bundle in the build products folder.
    static var bundledRenderer: URL? {
        let folders = [Bundle.main.executableURL?.deletingLastPathComponent()]
            + Bundle.allBundles.map { $0.bundleURL.deletingLastPathComponent() }
        let candidates = folders.compactMap { $0?.appendingPathComponent("carousel-render") }
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    static func prepareDesignAssets(in workspace: URL, design: DesignPreferences = .current,
                                    renderer: URL? = bundledRenderer) throws {
        guard let renderer else {
            throw NSError(domain: "TerminalHandoff", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Não achei o renderizador carousel-render ao lado do app. Rode o run-mac.sh de novo."
            ])
        }
        let bin = workspace.appendingPathComponent("bin", isDirectory: true)
        try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
        let installed = bin.appendingPathComponent("carousel-render")
        let binary = try Data(contentsOf: renderer)
        if (try? Data(contentsOf: installed)) != binary { try binary.write(to: installed, options: .atomic) }
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: installed.path)

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(design.slideStyle).write(to: workspace.appendingPathComponent("estilo.json"), options: .atomic)

        guard let bundledGuide = Bundle.module.url(forResource: "design-kit", withExtension: "md") else {
            throw CocoaError(.fileNoSuchFile)
        }
        let guide = workspace.appendingPathComponent("design-kit.md")
        try Data(contentsOf: bundledGuide).write(to: guide, options: .atomic)
        try FileManager.default.createDirectory(
            at: workspace.appendingPathComponent("biblioteca-fundos", isDirectory: true),
            withIntermediateDirectories: true
        )
    }
}
