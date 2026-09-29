import Foundation
import XCTest
@testable import BulkMaker

final class OutputCatalogTests: XCTestCase {
    func testCountsNestedFilesAndSelectsImagePreviews() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let nested = root.appendingPathComponent("carrossel-1", isDirectory: true)
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        try Data().write(to: nested.appendingPathComponent("slide-1.png"))
        try Data().write(to: nested.appendingPathComponent("slide-2.jpg"))
        try Data().write(to: root.appendingPathComponent("resumo.txt"))
        try Data().write(to: root.appendingPathComponent(".DS_Store"))

        let catalog = try OutputCatalog(directory: root)
        XCTAssertEqual(catalog.fileCount, 3)
        XCTAssertEqual(catalog.imageCount, 2)
        XCTAssertEqual(catalog.previewImages.map(\.lastPathComponent), ["slide-1.png", "slide-2.jpg"])
    }
}
