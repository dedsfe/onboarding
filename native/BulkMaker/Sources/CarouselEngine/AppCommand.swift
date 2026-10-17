import Foundation

/// The terminal sends typed requests to the running app, never simulated clicks or arbitrary Swift.
public struct AppCommand: Codable {
    public enum Action: String, Codable, CaseIterable {
        case status, navigate, terminal, setVariations, selectInputs, setStyle
        case createProject, openProject, renameProject
        case canvasList, canvasAddText, canvasUpdate, canvasRemove, canvasArrange
    }
    public let action: Action
    public var page: String?
    public var visible: Bool?
    public var count: Int?
    public var name: String?
    public var target: UUID?
    public var inputs: [String: String?]?
    public var mode: String?
    public var style: SlideStyle?
    public var text: String?
    public var ids: [UUID]?
    public var x: Double?
    public var y: Double?
    public var width: Double?
    public var height: Double?
}

public enum AppControlWire {
    public struct Endpoint: Codable {
        public let instance: UUID
        public let project: UUID
        public init(instance: UUID, project: UUID) { self.instance = instance; self.project = project }
    }
    public struct Request: Codable {
        public let id: UUID
        public let endpoint: Endpoint
        public let expires: Date
        public let command: AppCommand
        public init(endpoint: Endpoint, command: AppCommand, lifetime: TimeInterval = 10) {
            id = UUID(); self.endpoint = endpoint; self.command = command
            expires = Date().addingTimeInterval(lifetime)
        }
    }
    public struct Reply: Codable {
        public let ok: Bool
        public let message: String
        /// Optional JSON data, encoded separately to preserve the native model's types.
        public let result: String?
        public init(ok: Bool, message: String, result: String? = nil) {
            self.ok = ok; self.message = message; self.result = result
        }
    }

    /// A synchronous shell tool may wait; the app's main thread never does.
    public static func send(_ command: AppCommand, workspace: URL) throws -> Reply {
        let directory = workspace.appendingPathComponent("control", isDirectory: true)
        let endpoint = try JSONDecoder().decode(Endpoint.self, from: Data(contentsOf: directory.appendingPathComponent("endpoint.json")))
        let request = Request(endpoint: endpoint, command: command)
        let inbox = directory.appendingPathComponent("inbox", isDirectory: true)
        let responses = directory.appendingPathComponent("replies", isDirectory: true)
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
        let file = inbox.appendingPathComponent(request.id.uuidString + ".json")
        let reply = responses.appendingPathComponent(request.id.uuidString + ".json")
        defer {
            try? FileManager.default.removeItem(at: file)
            try? FileManager.default.removeItem(at: reply)
        }
        try JSONEncoder().encode(request).write(to: file, options: .atomic)
        while Date() < request.expires {
            if let data = try? Data(contentsOf: reply) { return try JSONDecoder().decode(Reply.self, from: data) }
            Thread.sleep(forTimeInterval: 0.05)
        }
        throw NSError(domain: "AppControl", code: 1, userInfo: [NSLocalizedDescriptionKey:
            "O app não respondeu. Confira se está aberto. Consulte status antes de repetir uma ação: ela pode já ter terminado."])
    }
}
