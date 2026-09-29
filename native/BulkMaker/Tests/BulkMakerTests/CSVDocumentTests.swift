import XCTest
@testable import BulkMaker

final class CSVDocumentTests: XCTestCase {
    func testQuotedCommaAndMultiline() throws {
        let csv = "\u{FEFF}titulo,foto\r\n\"Olá, mundo\nnovo\",foto1.jpg\r\n"
        let document = try CSVDocument(text: csv)
        XCTAssertEqual(document.headers, ["titulo", "foto"])
        XCTAssertEqual(document.rows, [["Olá, mundo\nnovo", "foto1.jpg"]])
    }

    func testSemicolonAndEscapedQuotes() throws {
        let document = try CSVDocument(text: "titulo;foto\n\"Ela disse \"\"oi\"\"\";foto.jpg")
        XCTAssertEqual(document.rows, [["Ela disse \"oi\"", "foto.jpg"]])
    }

    func testRejectsDuplicateHeaders() {
        XCTAssertThrowsError(try CSVDocument(text: "titulo,Titulo\na,b"))
    }
}
