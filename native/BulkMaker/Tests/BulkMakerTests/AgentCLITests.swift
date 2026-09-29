import XCTest
@testable import BulkMaker

final class AgentCLITests: XCTestCase {
    func testInteractiveCLIReceivesTheContextPromptAsOneArgument() {
        let prompt = "Leia .bulk-maker/contexto.md e use a pasta d'água"
        XCTAssertEqual(AgentCLI.claude.shellCommand(prompt: prompt),
                       "exec claude 'Leia .bulk-maker/contexto.md e use a pasta d'\\''água'")
        XCTAssertEqual(AgentCLI.codex.shellCommand(prompt: "Leia o contexto"),
                       "exec codex 'Leia o contexto'")
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

        let codex = AgentCLI.codex.backgroundArguments(prompt: prompt, photos: photos,
                                                        desired: desired, output: output)
        XCTAssertEqual(Array(codex.prefix(3)), ["--ask-for-approval", "never", "exec"])
        XCTAssertEqual(codex.last, prompt)
        XCTAssertTrue(codex.contains(output.path))
    }
}
