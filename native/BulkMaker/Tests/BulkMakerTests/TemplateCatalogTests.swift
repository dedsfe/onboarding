import XCTest
@testable import BulkMaker

final class TemplateCatalogTests: XCTestCase {
    func testBundledTemplatesExposeFieldsAndSlides() throws {
        let templates = try TemplateCatalog.load()
        XCTAssertEqual(templates.count, 6)
        XCTAssertTrue(templates.allSatisfy { $0.slideCount > 0 && !$0.binds.isEmpty })
        let tutorial = try XCTUnwrap(templates.first { $0.id == "tutorial_5steps" })
        let csv = try CSVDocument(text: "titulo,subtitulo\nA,B")
        XCTAssertFalse(tutorial.missingColumns(in: csv).contains("titulo"))
        XCTAssertTrue(tutorial.missingColumns(in: csv).contains("passo_1_titulo"))
        XCTAssertEqual(tutorial.frames.count, tutorial.slideCount)
        let title = try XCTUnwrap(tutorial.frames.first?.children.first { $0.bind == "titulo" })
        XCTAssertEqual(title.resolvedText(values: ["titulo": "Meu carrossel"]), "Meu carrossel")
    }
}
