import CarouselEngine
import XCTest
@testable import BulkMaker

final class TerminalHandoffTests: XCTestCase {
    func testWorkspaceLivesInApplicationSupport() {
        XCTAssertTrue(TerminalHandoff.projectDirectory.path.hasSuffix("Application Support/The Carousel Maker"))
        XCTAssertEqual(TerminalHandoff.shellQuote("a'b"), "'a'\\''b'")
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

    func testPrepareWritesTheSessionWorkspace() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("BulkMakerHandoff-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try TerminalHandoff.prepare(photos: URL(fileURLWithPath: "/tmp/photos"), desired: nil, csv: nil, output: nil,
                                    workspaceRoot: root)
        let workspace = root.appendingPathComponent(".bulk-maker")
        try Data().write(to: workspace.appendingPathComponent("contexto.md"))
        try TerminalHandoff.prepare(photos: URL(fileURLWithPath: "/tmp/photos"), desired: nil, csv: nil, output: nil,
                                    workspaceRoot: root)
        let selection = try BatchSelectionBridge.decode(Data(contentsOf: workspace.appendingPathComponent("selecao.json")))
        let job = try JSONSerialization.jsonObject(with: Data(contentsOf: workspace.appendingPathComponent("trabalho.json"))) as! [String: Any]
        let state = try String(contentsOf: workspace.appendingPathComponent("estado.md"), encoding: .utf8)
        let session = try String(contentsOf: workspace.appendingPathComponent("sessao.md"), encoding: .utf8)
        let designGuide = try String(contentsOf: workspace.appendingPathComponent("design-kit.md"), encoding: .utf8)
        XCTAssertTrue(state.contains("/tmp/photos"))
        XCTAssertTrue(session.contains(".bulk-maker/bin/carousel-render"))
        XCTAssertTrue(session.contains("É proibido desenhar slides com HTML, Playwright"))
        XCTAssertTrue(session.contains("--lote --estilo .bulk-maker/estilo.json --saida \"<saída>\" --revisao .bulk-maker/revisao"))
        XCTAssertTrue(session.contains("## Economia (obrigatório)"))
        XCTAssertTrue(session.contains("legenda.txt"))
        XCTAssertTrue(session.contains("## Mudar o estilo de um post ou de um slide"))
        XCTAssertTrue(session.contains("Cada projeto tem o próprio calendário"))
        XCTAssertTrue(designGuide.contains("Tipografia e acabamento"))
        XCTAssertTrue(designGuide.contains("carousel-render"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: workspace.appendingPathComponent("biblioteca-fundos").path))
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: workspace.appendingPathComponent("bin/carousel-render").path))
        XCTAssertNoThrow(try JSONDecoder().decode(SlideStyle.self,
                                                  from: Data(contentsOf: workspace.appendingPathComponent("estilo.json"))))
        XCTAssertFalse(FileManager.default.fileExists(atPath: workspace.appendingPathComponent("contexto.md").path))
        XCTAssertEqual(selection.photos, "/tmp/photos")
        XCTAssertEqual(job["photos"] as? String, "/tmp/photos")
        XCTAssertEqual(job["variations"] as? Int, 1)
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
