import AppKit
import CarouselEngine
import XCTest
@testable import BulkMaker

final class AppControlTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("AppControl-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDown() { try? FileManager.default.removeItem(at: root) }

    private func command(_ json: String) throws -> AppCommand {
        try JSONDecoder().decode(AppCommand.self, from: Data(json.utf8))
    }

    @MainActor
    func testRequestsAreAcknowledgedOnceAndStaleProjectsCannotBeEdited() throws {
        let server = AppControl(workspace: root)
        var project = UUID()
        var calls = 0
        func poll() throws {
            try server.poll(project: project) { _ in calls += 1; return .init(ok: true, message: "feito") }
        }
        try poll()
        let endpointFile = server.directory.appendingPathComponent("endpoint.json")
        let endpoint = try JSONDecoder().decode(AppControlWire.Endpoint.self, from: Data(contentsOf: endpointFile))
        let request = AppControlWire.Request(endpoint: endpoint, command: try command(##"{"action":"setVariations","count":5}"##))
        let file = server.directory.appendingPathComponent("inbox/\(request.id.uuidString).json")
        try JSONEncoder().encode(request).write(to: file, options: .atomic)
        try poll(); try poll()
        XCTAssertEqual(calls, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        let response = server.directory.appendingPathComponent("replies/\(request.id.uuidString).json")
        XCTAssertTrue(try JSONDecoder().decode(AppControlWire.Reply.self, from: Data(contentsOf: response)).ok)

        project = UUID()
        let stale = AppControlWire.Request(endpoint: endpoint, command: request.command)
        try JSONEncoder().encode(stale).write(to: server.directory.appendingPathComponent("inbox/\(stale.id.uuidString).json"))
        try poll()
        XCTAssertEqual(calls, 1)
        let reply = try JSONDecoder().decode(AppControlWire.Reply.self,
            from: Data(contentsOf: server.directory.appendingPathComponent("replies/\(stale.id.uuidString).json")))
        XCTAssertFalse(reply.ok)
        XCTAssertTrue(reply.message.contains("projeto mudou"))
    }

    @MainActor
    func testExpiredRequestsNeverExecuteAndInvalidPayloadsReturnErrors() throws {
        let server = AppControl(workspace: root)
        let project = UUID()
        var calls = 0
        try server.poll(project: project) { _ in calls += 1; return .init(ok: true, message: "") }
        let endpoint = try JSONDecoder().decode(AppControlWire.Endpoint.self,
            from: Data(contentsOf: server.directory.appendingPathComponent("endpoint.json")))
        let expired = AppControlWire.Request(endpoint: endpoint, command: try command(##"{"action":"status"}"##), lifetime: -1)
        let file = server.directory.appendingPathComponent("inbox/\(expired.id.uuidString).json")
        try JSONEncoder().encode(expired).write(to: file)
        let malformed = server.directory.appendingPathComponent("inbox/\(UUID().uuidString).json")
        try Data("{}".utf8).write(to: malformed)
        try server.poll(project: project) { _ in calls += 1; return .init(ok: true, message: "") }
        XCTAssertEqual(calls, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        let reply = try JSONDecoder().decode(AppControlWire.Reply.self,
            from: Data(contentsOf: server.directory.appendingPathComponent("replies/\(malformed.lastPathComponent)")))
        XCTAssertFalse(reply.ok)
    }

    @MainActor
    func testCanvasEditsPersistAndInvalidIDsDoNotChangeContent() throws {
        _ = try CanvasCommands.perform(try command(##"{"action":"canvasAddText","text":"Ideia inicial","x":10,"y":20}"##), directory: root)
        var items = try JSONDecoder().decode([CanvasItem].self, from: Data(contentsOf: root.appendingPathComponent("board.json")))
        let id = try XCTUnwrap(items.first?.id)
        _ = try CanvasCommands.perform(try command("{\"action\":\"canvasUpdate\",\"ids\":[\"\(id)\"],\"text\":\"Texto que agora é muito maior que o anterior e precisa caber por inteiro\",\"x\":120}"), directory: root)
        items = try JSONDecoder().decode([CanvasItem].self, from: Data(contentsOf: root.appendingPathComponent("board.json")))
        XCTAssertEqual(items.first?.x, 120)
        XCTAssertTrue(items.first?.text?.contains("por inteiro") == true)
        XCTAssertThrowsError(try CanvasCommands.perform(try command("{\"action\":\"canvasRemove\",\"ids\":[\"\(UUID())\"]}"), directory: root))
        XCTAssertEqual(CanvasBoard.savedItems(in: root).map(\.item), items)
        _ = try CanvasCommands.perform(try command("{\"action\":\"canvasRemove\",\"ids\":[\"\(id)\"]}"), directory: root)
        XCTAssertTrue(CanvasBoard.savedItems(in: root).isEmpty)
    }

    @MainActor
    func testNativeTerminalClientWaitsForTheAppAndReportsToolErrors() async throws {
        let server = AppControl(workspace: root)
        let project = UUID()
        try server.poll(project: project) { _ in .init(ok: true, message: "") }
        let renderer = try XCTUnwrap(TerminalHandoff.bundledRenderer)
        let bin = root.appendingPathComponent("bin", isDirectory: true)
        try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
        let tool = bin.appendingPathComponent("carousel-render")
        try FileManager.default.copyItem(at: renderer, to: tool)
        for succeeds in [true, false] {
            let process = Process()
            process.executableURL = tool
            process.arguments = ["--app", #"{"action":"status"}"#]
            let output = Pipe(), errors = Pipe()
            process.standardOutput = output; process.standardError = errors
            try process.run()
            let deadline = Date().addingTimeInterval(5)
            while process.isRunning && Date() < deadline {
                try server.poll(project: project) { _ in .init(ok: succeeds, message: succeeds ? "ação executada" : "ação recusada") }
                try await Task.sleep(for: .milliseconds(20))
            }
            if process.isRunning { process.terminate(); XCTFail("O cliente não recebeu resposta"); return }
            XCTAssertEqual(process.terminationStatus, succeeds ? 0 : 1)
            let pipe = succeeds ? output : errors
            let message = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            XCTAssertTrue(message.contains(succeeds ? "ação executada" : "ação recusada"))
        }
    }

    @MainActor
    func testCanvasCommandsParticipateInUndoAndRedo() throws {
        let board = CanvasBoard(directory: root)
        let view = InfiniteCanvasView(board: board)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 400),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = view
        InfiniteCanvasView.controlView = view
        defer { InfiniteCanvasView.controlView = nil; window.contentView = nil }
        let undo = try XCTUnwrap(view.undoManager)
        undo.beginUndoGrouping()
        _ = try CanvasCommands.perform(try command(##"{"action":"canvasAddText","text":"Pelo chat"}"##), directory: root)
        undo.endUndoGrouping()
        XCTAssertEqual(board.items.count, 1)
        undo.undo()
        XCTAssertTrue(board.items.isEmpty)
        undo.redo()
        XCTAssertEqual(board.items.first?.text, "Pelo chat")
    }

    @MainActor
    func testStylePatchPreservesUnmentionedChoicesAndRejectsInvalidInput() throws {
        let defaults = UserDefaults.standard
        let keys = [DesignPreferences.modeKey, DesignPreferences.textColorKey, DesignPreferences.titleSizeKey]
        let saved = keys.map { defaults.object(forKey: $0) }
        defer { for (key, value) in zip(keys, saved) { defaults.set(value, forKey: key) } }
        defaults.set("custom", forKey: DesignPreferences.modeKey)
        defaults.set("#FFFFFF", forKey: DesignPreferences.textColorKey)
        defaults.set("88", forKey: DesignPreferences.titleSizeKey)
        try AppStyleCommand.apply(command(##"{"action":"setStyle","style":{"color":"#123456"}}"##))
        XCTAssertEqual(DesignPreferences.current.textColor, "#123456")
        XCTAssertEqual(DesignPreferences.current.titleSize, "88")
        XCTAssertThrowsError(try AppStyleCommand.apply(command(##"{"action":"setStyle","style":{"color":"red"}}"##)))
        XCTAssertEqual(DesignPreferences.current.textColor, "#123456")
        try AppStyleCommand.apply(command(##"{"action":"setStyle","mode":"agent"}"##))
        XCTAssertEqual(DesignPreferences.current.slideStyle, SlideStyle())
    }

    func testAMissingCLITellsHowToInstallIt() {
        let message = TerminalSession.startFailure(.claude, code: 127)
        XCTAssertTrue(message.contains("não está instalado"))
        XCTAssertTrue(message.contains("npm install -g @anthropic-ai/claude-code"))
        XCTAssertTrue(TerminalSession.startFailure(.codex, code: 1).contains("@openai/codex"))
    }
}
