import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import XCTest
@testable import BulkMaker

final class BatchOutputValidatorTests: XCTestCase {
    func testOverwriteCheckOnlyFindsFilesInTargetVariationFolders() throws {
        let output = temporaryOutput()
        defer { try? FileManager.default.removeItem(at: output) }
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        try Data("prior batch".utf8).write(to: output.appendingPathComponent("resumo.txt"))
        XCTAssertTrue(try BatchOutputValidator.existingFiles(in: output, variations: 2).isEmpty)

        let target = output.appendingPathComponent("variacao-01")
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        try Data("old caption".utf8).write(to: target.appendingPathComponent("legenda.txt"))
        XCTAssertEqual(try BatchOutputValidator.existingFiles(in: output, variations: 2).count, 1)
    }

    func testAcceptsFreshCompleteVariationsAndRejectsOldFiles() throws {
        let output = temporaryOutput()
        defer { try? FileManager.default.removeItem(at: output) }
        let before = try BatchOutputValidator.capture(in: output, variations: 2)
        for index in 1...2 {
            let folder = output.appendingPathComponent(String(format: "variacao-%02d", index))
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try writePNG(to: folder.appendingPathComponent("slide-01.png"))
            try writePNG(to: folder.appendingPathComponent("slide-02.png"))
        }
        let result = try BatchOutputValidator.validate(in: output, variations: 2, after: before)
        XCTAssertEqual(result, .init(variations: 2, slidesPerVariation: 2))

        let unchanged = try BatchOutputValidator.capture(in: output, variations: 2)
        XCTAssertThrowsError(try BatchOutputValidator.validate(in: output, variations: 2, after: unchanged)) {
            XCTAssertTrue($0.localizedDescription.contains("não foi gerado nesta execução"))
        }
    }

    func testRejectsMissingCorruptAndUnevenSlides() throws {
        let output = temporaryOutput()
        defer { try? FileManager.default.removeItem(at: output) }
        let before = try BatchOutputValidator.capture(in: output, variations: 2)
        let first = output.appendingPathComponent("variacao-01")
        let second = output.appendingPathComponent("variacao-02")
        try FileManager.default.createDirectory(at: first, withIntermediateDirectories: true)
        try writePNG(to: first.appendingPathComponent("slide-01.png"))
        XCTAssertThrowsError(try BatchOutputValidator.validate(in: output, variations: 2, after: before)) {
            XCTAssertTrue($0.localizedDescription.contains("variacao-02"))
        }

        try FileManager.default.createDirectory(at: second, withIntermediateDirectories: true)
        try Data("not an image".utf8).write(to: second.appendingPathComponent("slide-01.png"))
        XCTAssertThrowsError(try BatchOutputValidator.validate(in: output, variations: 2, after: before)) {
            XCTAssertTrue($0.localizedDescription.contains("não é uma imagem válida"))
        }

        try writePNG(to: second.appendingPathComponent("slide-01.png"))
        try writePNG(to: second.appendingPathComponent("slide-02.png"))
        XCTAssertThrowsError(try BatchOutputValidator.validate(in: output, variations: 2, after: before)) {
            XCTAssertTrue($0.localizedDescription.contains("2 slides; eram esperados 1"))
        }
    }

    private func temporaryOutput() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("BulkMakerOutput-\(UUID().uuidString)")
    }

    private func writePNG(to url: URL) throws {
        let context = CGContext(data: nil, width: 2, height: 2, bitsPerComponent: 8, bytesPerRow: 0,
                                space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(red: 0.5, green: 0.2, blue: 0.1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 2, height: 2))
        let image = context.makeImage()!
        let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, image, nil)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
    }
}
