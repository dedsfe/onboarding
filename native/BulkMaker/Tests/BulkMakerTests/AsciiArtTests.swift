import ImageIO
import UniformTypeIdentifiers
import XCTest
@testable import BulkMaker

final class AsciiArtTests: XCTestCase {
    func testRendersWallpaperAsAsciiQuickly() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "fundo-canvas", withExtension: "jpg"))
        let source = try XCTUnwrap(CGImageSourceCreateWithURL(url as CFURL, nil).flatMap { CGImageSourceCreateImageAtIndex($0, 0, nil) })
        let start = Date()
        let art = try XCTUnwrap(AsciiArt.render(source))
        let elapsed = Date().timeIntervalSince(start)
        XCTAssertLessThan(abs(art.width - source.width), 20)
        XCTAssertLessThan(abs(art.height - source.height), 40)
        XCTAssertLessThan(elapsed, 1.5)
        if let path = ProcessInfo.processInfo.environment["ASCII_PREVIEW"],
           let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil) {
            CGImageDestinationAddImage(destination, art, nil)
            CGImageDestinationFinalize(destination)
            print("ascii render \(art.width)x\(art.height) in \(elapsed)s")
        }
    }
}
