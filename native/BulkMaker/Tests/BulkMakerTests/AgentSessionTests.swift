import XCTest
@testable import BulkMaker

final class AgentSessionTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("AgentSession-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDown() { try? FileManager.default.removeItem(at: root) }

    private func folder(_ name: String, files: [String]) throws -> URL {
        let url = root.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        for file in files { try Data().write(to: url.appendingPathComponent(file)) }
        return url
    }

    func testStateSummarizesWhatTheAppSees() throws {
        let photos = try folder("fotos", files: ["a.jpg", "b.PNG", "notas.txt"])
        try FileManager.default.createDirectory(at: photos.appendingPathComponent("_descartadas"), withIntermediateDirectories: true)
        let desired = try folder("refs", files: ["r1.png"])
        let output = try folder("saida", files: [])
        try FileManager.default.createDirectory(at: output.appendingPathComponent("variacao-01"), withIntermediateDirectories: true)
        let state = AgentSession.state(photos: photos, desired: desired, csv: nil, output: output, variations: 3,
                                       design: DesignPreferences(titleFont: "Futura", highlight: "#FFD60A"), custom: true)
        XCTAssertTrue(state.contains("2 imagens"))
        XCTAssertTrue(state.contains("1 arquivo"))
        XCTAssertTrue(state.contains("já tem variacao-01 de rodadas anteriores"))
        XCTAssertTrue(state.contains("a próxima livre é variacao-02"))
        try FileManager.default.createDirectory(at: output.appendingPathComponent("variacao-07"), withIntermediateDirectories: true)
        XCTAssertEqual(BatchOutputValidator.nextFreeIndex(in: output), 8)
        XCTAssertEqual(BatchOutputValidator.nextFreeIndex(in: root.appendingPathComponent("nao-existe")), 1)
        XCTAssertTrue(state.contains("Variações pedidas: 3"))
        XCTAssertTrue(state.contains("fonte Futura, destaque #FFD60A"))
        XCTAssertTrue(state.contains("Falta escolher: nada"))

        let empty = AgentSession.state(photos: nil, desired: nil, csv: nil, output: nil, variations: 1,
                                       design: DesignPreferences(), custom: false)
        XCTAssertTrue(empty.contains("Falta escolher: pasta de fotos, resultados desejados, pasta de saída"))
        XCTAssertTrue(empty.contains("com a IA"))
    }

    private func runHook(_ workspace: URL, _ mode: String) throws -> String {
        let process = Process()
        process.executableURL = workspace.appendingPathComponent("bin/estado-hook")
        process.arguments = [mode]
        let pipe = Pipe()
        process.standardOutput = pipe
        try process.run()
        process.waitUntilExit()
        return String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    }

    func testHookTellsTheAIOnlyWhatChanged() throws {
        let workspace = root.appendingPathComponent(".bulk-maker", isDirectory: true)
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        try AgentSession.install(in: workspace, state: "# Estado\n- Variações pedidas: 3")
        XCTAssertTrue(FileManager.default.fileExists(atPath: workspace.appendingPathComponent("sessao.md").path))

        XCTAssertTrue(try runHook(workspace, "prompt").contains("Variações pedidas: 3"))
        XCTAssertTrue(try runHook(workspace, "prompt").contains("sem mudanças"))
        XCTAssertEqual(try runHook(workspace, "tool"), "")

        try AgentSession.install(in: workspace, state: "# Estado\n- Variações pedidas: 5")
        let notice = try JSONSerialization.jsonObject(with: Data(try runHook(workspace, "tool").utf8)) as? [String: Any]
        let output = notice?["hookSpecificOutput"] as? [String: String]
        XCTAssertEqual(output?["hookEventName"], "PostToolUse")
        XCTAssertTrue(output?["additionalContext"]?.contains("Variações pedidas: 5") == true)
        XCTAssertEqual(try runHook(workspace, "tool"), "")
    }

    func testSessionsOpenAlreadyKnowingTheBatch() {
        let claude = AgentCLI.claude.shellCommand(prompt: AgentSession.openingPrompt)
        XCTAssertTrue(claude.contains("--append-system-prompt-file"))
        XCTAssertTrue(claude.contains("UserPromptSubmit"))
        XCTAssertTrue(claude.contains("PostToolUse"))
        XCTAssertTrue(claude.hasPrefix("rm -f "))
        XCTAssertTrue(claude.contains("'--model' 'sonnet'"))
        XCTAssertTrue(claude.contains("'--tools' 'Bash,Read,Write,Edit'"))
        let codex = AgentCLI.codex.shellCommand(prompt: AgentSession.openingPrompt)
        XCTAssertTrue(codex.contains("developer_instructions=\"Esta sessão foi aberta pelo app"))
        XCTAssertTrue(AgentSession.instructions.contains("UMA linha de situação"))
        XCTAssertTrue(AgentSession.instructions.contains(".bulk-maker/bin/carousel-render"))
    }

    func testGenerateButtonPromptAndModelChoice() {
        XCTAssertEqual(AgentSession.generatePrompt(variations: 3, firstIndex: 2), "Gera as 3 variações agora, de variacao-02 a variacao-04.")
        XCTAssertEqual(AgentSession.generatePrompt(variations: 1), "Gera a variação agora, em variacao-01.")
        let defaults = UserDefaults.standard
        let saved = defaults.object(forKey: ClaudeModel.storageKey)
        defer { defaults.set(saved, forKey: ClaudeModel.storageKey) }
        defaults.set("opus", forKey: ClaudeModel.storageKey)
        XCTAssertEqual(Array(AgentSession.claudeCostFlags.prefix(2)), ["--model", "opus"])
        defaults.set("lixo", forKey: ClaudeModel.storageKey)
        XCTAssertEqual(ClaudeModel.current, .sonnet)
    }
}
