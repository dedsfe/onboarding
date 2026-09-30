import CarouselEngine
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
        XCTAssertTrue(text.contains(".bulk-maker/bin/carousel-render"))
        XCTAssertTrue(text.contains("--estilo .bulk-maker/estilo.json"))
        XCTAssertTrue(text.contains("É proibido desenhar slides com HTML, Playwright"))
        XCTAssertTrue(text.contains("legenda.txt"))
        XCTAssertFalse(text.contains("renderizador invisível"))
        XCTAssertEqual(TerminalHandoff.shellQuote("a'b"), "'a'\\''b'")
        XCTAssertTrue(TerminalHandoff.projectDirectory.path.hasSuffix("Application Support/The Carousel Maker"))
        XCTAssertTrue(FileManager.default.fileExists(
            atPath: TerminalHandoff.projectDirectory.appendingPathComponent(".bulk-maker").path))
    }

    func testDesignChoicesReachTheAgentContext() {
        let design = DesignPreferences(titleFont: "Avenir Next", bodyFont: "Georgia",
                                       titleWeight: "800", titleSize: "96", textColor: "#FFFFFF",
                                       borders: "2", backgrounds: "library")
        let context = TerminalHandoff.context(photos: nil, desired: nil, csv: nil, output: nil,
                                              design: design)
        XCTAssertTrue(context.contains("Fonte dos títulos: Avenir Next"))
        XCTAssertTrue(context.contains("Fonte do corpo: Georgia"))
        XCTAssertTrue(context.contains("títulos com peso 800"))
        XCTAssertTrue(context.contains("cerca de 96px"))
        XCTAssertTrue(context.contains("texto na cor #FFFFFF"))
        XCTAssertTrue(context.contains("bordas de 2px"))
        XCTAssertTrue(context.contains("biblioteca local"))
    }

    func testTextEditorChoicesReachTheAgentContext() {
        let design = DesignPreferences(align: "leading", strokeWidth: "6", strokeColor: "#000000",
                                       position: "bottom", textCase: "upper", highlight: "#FFD60A")
        let context = TerminalHandoff.context(photos: nil, desired: nil, csv: nil, output: nil,
                                              design: design)
        XCTAssertTrue(context.contains("contorno de 6px na cor #000000"))
        XCTAssertTrue(context.contains("embaixo, acima da legenda do TikTok"))
        XCTAssertTrue(context.contains("CAIXA ALTA"))
        XCTAssertTrue(context.contains("palavras-chave por slide na cor #FFD60A"))
        XCTAssertTrue(context.contains("à esquerda"))
    }

    func testHiddenLegacyChoicesStayOnAuto() {
        let defaults = UserDefaults.standard
        let keys = [DesignPreferences.modeKey, DesignPreferences.bodyFontKey,
                    DesignPreferences.borderKey, DesignPreferences.backgroundKey]
        let saved = keys.map { defaults.object(forKey: $0) }
        defer { for (key, value) in zip(keys, saved) { defaults.set(value, forKey: key) } }
        defaults.set("custom", forKey: DesignPreferences.modeKey)
        defaults.set("Georgia", forKey: DesignPreferences.bodyFontKey)
        defaults.set("2", forKey: DesignPreferences.borderKey)
        defaults.set("library", forKey: DesignPreferences.backgroundKey)
        let current = DesignPreferences.current
        XCTAssertEqual(current.bodyFont, "")
        XCTAssertEqual(current.borders, "auto")
        XCTAssertEqual(current.backgrounds, "auto")
    }

    func testOverwriteApprovalIsExplicitInAgentContext() {
        let unapproved = TerminalHandoff.context(photos: nil, desired: nil, csv: nil, output: nil)
        let approved = TerminalHandoff.context(photos: nil, desired: nil, csv: nil, output: nil,
                                               overwriteApproved: true)
        XCTAssertTrue(unapproved.contains("Antes de sobrescrever arquivos existentes, peça confirmação"))
        XCTAssertTrue(approved.contains("O usuário confirmou no app a substituição"))
        XCTAssertFalse(approved.contains("Antes de sobrescrever arquivos existentes, peça confirmação"))
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
        let job = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent(".bulk-maker/trabalho.json"))) as! [String: Any]
        let command = try String(contentsOf: script, encoding: .utf8)
        XCTAssertTrue(context.contains("/tmp/photos"))
        XCTAssertTrue(context.contains("- Saída:"))
        XCTAssertTrue(context.contains("--lote --estilo .bulk-maker/estilo.json --saida \"<saída>\" --revisao .bulk-maker/revisao"))
        XCTAssertTrue(context.contains("## Economia (obrigatório)"))
        XCTAssertTrue(context.contains(".bulk-maker/selecao.json"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(".bulk-maker/biblioteca-fundos").path))
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: root.appendingPathComponent(".bulk-maker/bin/carousel-render").path))
        XCTAssertNoThrow(try JSONDecoder().decode(SlideStyle.self,
                                                  from: Data(contentsOf: root.appendingPathComponent(".bulk-maker/estilo.json"))))
        let designGuide = try String(contentsOf: root.appendingPathComponent(".bulk-maker/design-kit.md"), encoding: .utf8)
        XCTAssertTrue(designGuide.contains("Tipografia e acabamento"))
        XCTAssertTrue(designGuide.contains("carousel-render"))
        XCTAssertEqual(selection.photos, "/tmp/photos")
        XCTAssertEqual(job["photos"] as? String, "/tmp/photos")
        XCTAssertEqual(job["variations"] as? Int, 1)
        XCTAssertTrue(command.contains("cd \(TerminalHandoff.shellQuote(root.path))"))
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: script.path))
    }

    func testDesignChoicesBecomeRendererStyle() throws {
        let custom = DesignPreferences(titleFont: "Futura", titleWeight: "800", titleSize: "88",
                                       textColor: "#FFFFFF", align: "center", strokeWidth: "6",
                                       strokeColor: "#000000", position: "bottom", textCase: "upper",
                                       highlight: "#FFD60A")
        XCTAssertEqual(custom.slideStyle, SlideStyle(font: "Futura", weight: 800, size: 88, color: "#FFFFFF",
                                                     strokeWidth: 6, strokeColor: "#000000",
                                                     highlightColor: "#FFD60A", position: .bottom,
                                                     align: .center, textCase: .upper))
        // "Com a IA" is all auto: the renderer gets an empty style and decides everything.
        let agent = try JSONEncoder().encode(DesignPreferences().slideStyle)
        XCTAssertEqual(String(decoding: agent, as: UTF8.self), "{}")
    }

    func testDesignAssetsFailClearlyWithoutRenderer() {
        let workspace = FileManager.default.temporaryDirectory.appendingPathComponent("BulkMakerNoRenderer-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: workspace) }
        XCTAssertThrowsError(try TerminalHandoff.prepareDesignAssets(in: workspace, renderer: nil))
    }
}
