import Foundation

/// Small exchange file that a CLI can edit to send folder choices back to the app.
struct BatchSelection: Codable, Equatable {
    var version = 1
    var photos: String?
    var desired: String?
    var csv: String?
    var output: String?

    init(photos: URL?, desired: URL?, csv: URL?, output: URL?) {
        self.photos = photos?.path
        self.desired = desired?.path
        self.csv = csv?.path
        self.output = output?.path
    }

    func resolve() throws -> ResolvedBatchSelection {
        guard version == 1 else { throw BridgeError.unsupportedVersion }
        let photosURL = try directory(photos, label: "fotos")
        let desiredURL = try directory(desired, label: "resultados desejados")
        let outputURL = try directory(output, label: "saída")
        let catalog = try photosURL.map { try PhotoCatalog(directory: $0) }
        let csvURL = try file(csv, label: "CSV")
        var document: CSVDocument?
        if let csvURL {
            let data = try Data(contentsOf: csvURL)
            guard let text = String(data: data, encoding: .utf8) ??
                    String(data: data, encoding: .windowsCP1252) else {
                throw CocoaError(.fileReadInapplicableStringEncoding)
            }
            document = try CSVDocument(text: text)
        }
        return ResolvedBatchSelection(photos: catalog, desired: desiredURL,
                                      csvURL: csvURL, csv: document, output: outputURL)
    }

    private func directory(_ path: String?, label: String) throws -> URL? {
        guard let path, !path.isEmpty else { return nil }
        let url = URL(fileURLWithPath: path)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
              isDirectory.boolValue else { throw BridgeError.invalidPath(label, path) }
        return url
    }

    private func file(_ path: String?, label: String) throws -> URL? {
        guard let path, !path.isEmpty else { return nil }
        let url = URL(fileURLWithPath: path)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
              !isDirectory.boolValue else { throw BridgeError.invalidPath(label, path) }
        return url
    }

    enum BridgeError: LocalizedError {
        case unsupportedVersion
        case invalidPath(String, String)

        var errorDescription: String? {
            switch self {
            case .unsupportedVersion: return "A versão do arquivo de seleção não é compatível."
            case .invalidPath(let label, let path): return "Caminho de \(label) inválido: \(path)"
            }
        }
    }
}

struct ResolvedBatchSelection {
    let photos: PhotoCatalog?
    let desired: URL?
    let csvURL: URL?
    let csv: CSVDocument?
    let output: URL?
}

enum BatchSelectionBridge {
    static var fileURL: URL {
        TerminalHandoff.projectDirectory.appendingPathComponent(".bulk-maker/selecao.json")
    }

    static func data(for selection: BatchSelection) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(selection)
    }

    static func decode(_ data: Data) throws -> BatchSelection {
        try JSONDecoder().decode(BatchSelection.self, from: data)
    }
}
