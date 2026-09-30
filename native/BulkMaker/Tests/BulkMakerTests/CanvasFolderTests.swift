import AppKit
import CarouselEngine
import ImageIO
import UniformTypeIdentifiers
import XCTest
@testable import BulkMaker

@MainActor
final class CanvasFolderTests: XCTestCase {
    private var base: URL!
    private var canvas: URL { base.appendingPathComponent("Canvas") }

    override func setUp() async throws {
        base = FileManager.default.temporaryDirectory.appendingPathComponent("canvas-ia-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: base)
    }

    private func png(_ name: String, width: Int, height: Int) throws -> URL {
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(gray: 0.4, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let url = base.appendingPathComponent(name)
        let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, context.makeImage()!, nil)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return url
    }

    func testAIImagesGoToTheRightOfWhatIsThereAndTheAppReadsThem() throws {
        let first = try CanvasFolder.add([try png("a.png", width: 200, height: 400)], to: canvas)
        XCTAssertEqual(first[0].x, -100, accuracy: 0.01)  // empty board: centered on the origin
        let more = try CanvasFolder.add([try png("b.png", width: 960, height: 540), try png("c.png", width: 100, height: 100)],
                                        to: canvas)
        XCTAssertEqual(more[0].x, 100 + 80, accuracy: 0.01)
        XCTAssertEqual(more[0].y, first[0].y, accuracy: 0.01)
        XCTAssertEqual(more[0].width, 480, accuracy: 0.01)  // longest side fitted like a paste
        XCTAssertEqual(more[1].x, more[0].x + 480 + 24, accuracy: 0.01)

        let board = CanvasBoard(directory: canvas)
        XCTAssertEqual(board.items.map(\.id), (first + more).map(\.id))
        XCTAssertTrue(FileManager.default.fileExists(atPath: board.url(of: board.items[2]).path))
        XCTAssertThrowsError(try CanvasFolder.add([base.appendingPathComponent("x.txt")], to: canvas))
    }

    func testOpenCanvasPicksUpAIImagesAndNeverDropsThem() throws {
        let board = CanvasBoard(directory: canvas)
        let source = NSPasteboard(name: .init("canvas-ia-\(UUID().uuidString)"))
        source.clearContents()
        let item = NSPasteboardItem()
        item.setData(try Data(contentsOf: try png("mine.png", width: 100, height: 100)), forType: .png)
        source.writeObjects([item])
        let mine = board.importImages(from: source, around: .zero)[0]
        let before = board.items

        // The AI adds while the canvas is open; the app sees it on its next check.
        let fromAI = try CanvasFolder.add([try png("ia.png", width: 100, height: 100)], to: canvas)
        XCTAssertEqual(board.reloadIfChangedOnDisk(), fromAI.map(\.id))
        XCTAssertEqual(board.items.count, 2)
        XCTAssertEqual(board.reloadIfChangedOnDisk(), [])

        // Another AI image lands before the app saves an edit of its own: both survive.
        let second = try CanvasFolder.add([try png("ia2.png", width: 100, height: 100)], to: canvas)
        board.setFrame(mine.frame.offsetBy(dx: 10, dy: 0), of: mine.id)
        board.changed()
        XCTAssertEqual(Set(CanvasFolder.entries(in: canvas).map(\.id)), Set([mine.id] + fromAI.map(\.id) + second.map(\.id)))

        // Undoing the user's own step keeps the AI's images.
        board.replaceItems(before)
        XCTAssertEqual(Set(board.items.map(\.id)), Set([mine.id] + fromAI.map(\.id) + second.map(\.id)))
        // Deleting an AI image is the user's call: undo brings it back, redo deletes it again.
        let withAI = board.items
        board.remove([fromAI[0].id])
        let afterDelete = board.items
        board.replaceItems(withAI)
        XCTAssertTrue(board.items.contains { $0.id == fromAI[0].id })
        board.replaceItems(afterDelete)
        XCTAssertFalse(board.items.contains { $0.id == fromAI[0].id })
    }

    func testTheAIKnowsWhereTheCanvasIsAndHowToUseIt() {
        let state = AgentSession.state(photos: nil, desired: nil, csv: nil, output: nil, variations: 1,
                                       design: DesignPreferences(), custom: false, canvas: "/tmp/P/Canvas")
        XCTAssertTrue(state.contains("- Canvas do projeto: `/tmp/P/Canvas`"))
        XCTAssertTrue(AgentSession.instructions.contains("--canvas-add <imagem>... --canvas"))
        XCTAssertTrue(AgentSession.instructions.contains("Toda imagem que você gerar"))
    }
}
