import XCTest
@testable import BulkMaker

final class AgentCLITests: XCTestCase {
    func testInteractiveCLIReceivesTheContextPromptAsOneArgument() {
        let prompt = "Leia .bulk-maker/contexto.md e use a pasta d'água"
        XCTAssertTrue(AgentCLI.claude.shellCommand(prompt: prompt).contains("--strict-mcp-config"))
        XCTAssertTrue(AgentCLI.claude.shellCommand(prompt: prompt).contains("'Leia .bulk-maker/contexto.md e use a pasta d'\\''água'"))
        XCTAssertFalse(AgentCLI.claude.shellCommand(prompt: prompt).contains("--mcp-config"))
        XCTAssertFalse(AgentCLI.codex.shellCommand(prompt: "Leia o contexto").contains("mcp_servers"))
        XCTAssertTrue(AgentCLI.codex.shellCommand(prompt: "Leia o contexto").hasSuffix("'Leia o contexto'"))
    }

    func testBackgroundCommandsKeepPromptAndDirectoriesAsSeparateArguments() {
        let photos = URL(fileURLWithPath: "/tmp/fotos da cliente")
        let desired = URL(fileURLWithPath: "/tmp/referências")
        let output = URL(fileURLWithPath: "/tmp/saída")
        let prompt = "Crie 3 variações"
        let claude = AgentCLI.claude.backgroundArguments(prompt: prompt, photos: photos,
                                                          desired: desired, output: output)
        XCTAssertEqual(claude.first, "-p")
        XCTAssertEqual(claude[1], prompt)
        XCTAssertTrue(claude.contains(output.path))
        XCTAssertTrue(claude.contains("acceptEdits"))
        XCTAssertTrue(claude.contains("--strict-mcp-config"))
        XCTAssertFalse(claude.contains("--mcp-config"))
        XCTAssertTrue(claude.contains("Bash(.bulk-maker/bin/carousel-render:*)"))

        let codex = AgentCLI.codex.backgroundArguments(prompt: prompt, photos: photos,
                                                        desired: desired, output: output)
        XCTAssertEqual(Array(codex.prefix(2)), ["--ask-for-approval", "never"])
        XCTAssertFalse(codex.contains { $0.contains("mcp_servers") })
        XCTAssertEqual(codex.last, prompt)
        XCTAssertTrue(codex.contains(output.path))
    }
}
