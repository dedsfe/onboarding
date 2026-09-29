import XCTest
@testable import BulkMaker

final class TerminalHandoffTests: XCTestCase {
    func testHandoffContextAndShellQuoting() {
        let photos = URL(fileURLWithPath: "/tmp/fotos da cliente")
        let text = TerminalHandoff.context(photos: photos, desired: nil, csv: nil, output: nil,
                                           variations: 3)
        XCTAssertTrue(text.contains("/tmp/fotos da cliente"))
        XCTAssertTrue(text.contains("um SaaS para criar carrosséis em lote"))
        XCTAssertTrue(text.contains("CSV de copy (opcional): não escolhido"))
        XCTAssertTrue(text.contains("Se ele informar caminhos na conversa, use esses caminhos"))
        XCTAssertTrue(text.contains("Antes de sobrescrever arquivos existentes, peça confirmação"))
        XCTAssertTrue(text.contains("exatamente 3 variações completas"))
        XCTAssertTrue(text.contains("variacao-01"))
        XCTAssertTrue(text.contains(".bulk-maker/design-kit.md"))
        XCTAssertEqual(TerminalHandoff.shellQuote("a'b"), "'a'\\''b'")
        XCTAssertTrue(FileManager.default.fileExists(
            atPath: TerminalHandoff.projectDirectory.appendingPathComponent("native/BulkMaker/Package.swift").path))
    }

    func testDesignChoicesReachTheAgentContext() {
        let design = DesignPreferences(titleFont: "Avenir Next", bodyFont: "Georgia",
                                       titleWeight: "strong", borders: "subtle", backgrounds: "library")
        let context = TerminalHandoff.context(photos: nil, desired: nil, csv: nil, output: nil,
                                              design: design)
        XCTAssertTrue(context.contains("Fonte dos títulos: Avenir Next"))
        XCTAssertTrue(context.contains("Fonte do corpo: Georgia"))
        XCTAssertTrue(context.contains("títulos fortes (700–800)"))
        XCTAssertTrue(context.contains("bordas discretas"))
        XCTAssertTrue(context.contains("biblioteca local"))
    }

    func testPreparesContextAndExecutableTerminalScript() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("BulkMakerHandoff-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let script = try TerminalHandoff.prepare(photos: URL(fileURLWithPath: "/tmp/photos"),
                                                  desired: nil, csv: nil, output: nil,
                                                  workspaceRoot: root)
        let context = try String(contentsOf: root.appendingPathComponent(".bulk-maker/contexto.md"), encoding: .utf8)
        let selectionData = try Data(contentsOf: root.appendingPathComponent(".bulk-maker/selecao.json"))
        let selection = try BatchSelectionBridge.decode(selectionData)
        let command = try String(contentsOf: script, encoding: .utf8)
        XCTAssertTrue(context.contains("/tmp/photos"))
        XCTAssertTrue(context.contains("- Saída:"))
        XCTAssertTrue(context.contains(".bulk-maker/selecao.json"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(".bulk-maker/biblioteca-fundos").path))
        let designGuide = try String(contentsOf: root.appendingPathComponent(".bulk-maker/design-kit.md"), encoding: .utf8)
        XCTAssertTrue(designGuide.contains("Tipografia e acabamento"))
        XCTAssertTrue(designGuide.contains("previsualizar_lote"))
        XCTAssertEqual(selection.photos, "/tmp/photos")
        XCTAssertTrue(command.contains("cd \(TerminalHandoff.shellQuote(root.path))"))
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: script.path))
    }
}
