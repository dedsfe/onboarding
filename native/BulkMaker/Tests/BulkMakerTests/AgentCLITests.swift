import XCTest
@testable import BulkMaker

final class AgentCLITests: XCTestCase {
    func testInteractiveCLIReceivesTheContextPromptAsOneArgument() {
        let prompt = "Gera usando a pasta d'água"
        XCTAssertTrue(AgentCLI.claude.shellCommand(prompt: prompt).contains("--strict-mcp-config"))
        XCTAssertTrue(AgentCLI.claude.shellCommand(prompt: prompt).contains("'Gera usando a pasta d'\\''água'"))
        XCTAssertFalse(AgentCLI.claude.shellCommand(prompt: prompt).contains("--mcp-config"))
        XCTAssertFalse(AgentCLI.codex.shellCommand(prompt: "Leia o contexto").contains("mcp_servers"))
        XCTAssertTrue(AgentCLI.codex.shellCommand(prompt: "Leia o contexto").hasSuffix("'Leia o contexto'"))
    }
}
