import XCTest
@testable import BulkMaker

final class BatchSelectionBridgeTests: XCTestCase {
    func testCLICanSetPathsAndAppResolvesThem() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("BulkMakerSelection-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let photos = root.appendingPathComponent("fotos", isDirectory: true)
        let desired = root.appendingPathComponent("referencias", isDirectory: true)
        let output = root.appendingPathComponent("saida", isDirectory: true)
        for folder in [photos, desired, output] {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        let csv = root.appendingPathComponent("copys.csv")
        try "titulo\nMeu primeiro carrossel".write(to: csv, atomically: true, encoding: .utf8)

        let selection = BatchSelection(photos: photos, desired: desired, csv: csv, output: output)
        let decoded = try BatchSelectionBridge.decode(BatchSelectionBridge.data(for: selection))
        let resolved = try decoded.resolve()
        XCTAssertEqual(resolved.photos?.directory, photos)
        XCTAssertEqual(resolved.desired, desired)
        XCTAssertEqual(resolved.csv?.rows.first?.first, "Meu primeiro carrossel")
        XCTAssertEqual(resolved.output, output)
    }

    func testInvalidPathDoesNotResolve() throws {
        let selection = BatchSelection(photos: URL(fileURLWithPath: "/pasta/inexistente"),
                                       desired: nil, csv: nil, output: nil)
        XCTAssertThrowsError(try selection.resolve())
    }
}
