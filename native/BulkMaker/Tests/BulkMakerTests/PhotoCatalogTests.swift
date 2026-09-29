import XCTest
@testable import BulkMaker

final class PhotoCatalogTests: XCTestCase {
    func testExplicitFilenameAndOneBasedIndex() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try Data().write(to: directory.appendingPathComponent("foto1.jpg"))
        try Data().write(to: directory.appendingPathComponent("foto2.png"))

        let catalog = try PhotoCatalog(directory: directory)
        XCTAssertEqual(catalog.assignment(headers: ["foto"], row: ["foto2.png"], index: 0).file?.lastPathComponent, "foto2.png")
        XCTAssertEqual(catalog.assignment(headers: ["_foto"], row: ["1"], index: 1).file?.lastPathComponent, "foto1.jpg")
        XCTAssertEqual(catalog.assignment(headers: ["titulo"], row: ["A"], index: 1).file?.lastPathComponent, "foto2.png")
        XCTAssertNil(catalog.assignment(headers: ["foto"], row: ["ausente.jpg"], index: 0).file)
    }
}
