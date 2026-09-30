import AppKit
import ImageIO
import UniformTypeIdentifiers
import XCTest
@testable import BulkMaker

@MainActor
final class CanvasBoardTests: XCTestCase {
    private var directory: URL!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("canvas-\(UUID().uuidString)")
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private func imageData(_ type: UTType, width: Int = 200, height: Int = 100) throws -> Data {
        let context = try XCTUnwrap(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                              space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.setFillColor(CGColor(srgbRed: 1, green: 0.8, blue: 0, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let data = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(destination, try XCTUnwrap(context.makeImage()), nil)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return data as Data
    }

    private func pdfData() -> Data {
        let data = NSMutableData()
        var box = CGRect(x: 0, y: 0, width: 300, height: 150)
        let context = CGContext(consumer: CGDataConsumer(data: data)!, mediaBox: &box, nil)!
        context.beginPDFPage(nil)
        context.setFillColor(CGColor(gray: 0.5, alpha: 1))
        context.fill(box)
        context.endPDFPage()
        context.closePDF()
        return data as Data
    }

    private func pasteboard() -> NSPasteboard {
        let board = NSPasteboard(name: .init("canvas-test-\(UUID().uuidString)"))
        board.clearContents()
        return board
    }

    func testPastesTheRichestImageTypeAndKeepsItsBytes() throws {
        let gif = try imageData(.gif), png = try imageData(.png)
        let source = pasteboard()
        let item = NSPasteboardItem()
        item.setData(png, forType: .png)
        item.setData(gif, forType: .init(UTType.gif.identifier))
        source.writeObjects([item])

        let board = CanvasBoard(directory: directory)
        let added = board.importImages(from: source, around: CGPoint(x: 100, y: 100))
        XCTAssertEqual(added.count, 1)
        XCTAssertEqual(board.url(of: added[0]).pathExtension, "gif")
        XCTAssertEqual(try Data(contentsOf: board.url(of: added[0])), gif)
        XCTAssertEqual(added[0].width / added[0].height, 2, accuracy: 0.01)
        XCTAssertEqual(added[0].frame.midX, 100, accuracy: 0.01)
    }

    func testPastesFilesOfEveryFormatFromFinder() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let svg = Data("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"120\" height=\"60\"><rect width=\"120\" height=\"60\" fill=\"red\"/></svg>".utf8)
        let files: [(String, Data)] = [("a.png", try imageData(.png)), ("b.jpg", try imageData(.jpeg)),
                                       ("c.heic", try imageData(.heic)), ("d.tiff", try imageData(.tiff)),
                                       ("e.pdf", pdfData()), ("f.svg", svg), ("g.txt", Data("oi".utf8))]
        let urls = try files.map { name, data -> URL in
            let url = directory.appendingPathComponent(name)
            try data.write(to: url)
            return url
        }
        let source = pasteboard()
        source.writeObjects(urls as [NSURL])

        let board = CanvasBoard(directory: directory.appendingPathComponent("board"))
        let added = board.importImages(from: source, around: .zero)
        XCTAssertEqual(added.map { board.url(of: $0).pathExtension }, ["png", "jpeg", "heic", "tiff", "pdf", "svg"])
        for item in added {
            XCTAssertNotNil(CanvasBoard.displayImage(of: board.url(of: item), maxPixel: 256), item.file)
        }
    }

    func testCopyOutCarriesFileOriginalAndPNGAndPastesBackIn() throws {
        let source = pasteboard()
        let item = NSPasteboardItem()
        item.setData(try imageData(.heic), forType: .init(UTType.heic.identifier))
        source.writeObjects([item])
        let board = CanvasBoard(directory: directory)
        let added = board.importImages(from: source, around: .zero)

        let out = pasteboard()
        board.copy(added, to: out)
        let types = try XCTUnwrap(out.pasteboardItems?.first?.types)
        XCTAssertTrue(types.contains(.fileURL))
        XCTAssertTrue(types.contains(.init(UTType.heic.identifier)))
        XCTAssertTrue(types.contains(.png))

        XCTAssertEqual(board.importImages(from: out, around: .zero).count, 1)
        XCTAssertEqual(board.items.count, 2)
    }

    func testBoardSurvivesRelaunchAndDropsUnusedFiles() throws {
        let source = pasteboard()
        let item = NSPasteboardItem()
        item.setData(try imageData(.png), forType: .png)
        source.writeObjects([item])
        let board = CanvasBoard(directory: directory)
        let first = board.importImages(from: source, around: .zero)[0]
        let second = board.importImages(from: source, around: .zero)[0]
        board.remove([second.id])

        let reopened = CanvasBoard(directory: directory)
        XCTAssertEqual(reopened.items, [first])
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: reopened.media.path), [first.file])
    }

    func testIgnoresPasteboardsWithoutImages() {
        let source = pasteboard()
        source.setString("só texto", forType: .string)
        let board = CanvasBoard(directory: directory)
        XCTAssertTrue(board.importImages(from: source, around: .zero).isEmpty)
    }

    func testViewDrawsImagesWhereTheBoardSaysAndZoomsAroundThePointer() async throws {
        let source = pasteboard()
        let item = NSPasteboardItem()
        item.setData(try imageData(.png, width: 400, height: 200), forType: .png)
        source.writeObjects([item])
        let board = CanvasBoard(directory: directory)
        _ = board.importImages(from: source, around: .zero)  // 400×200 centered on the origin

        let view = InfiniteCanvasView(board: board)
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 800, height: 600), styleMask: [.borderless],
                              backing: .buffered, defer: false)
        window.contentView = view
        view.frame = CGRect(x: 0, y: 0, width: 800, height: 600)
        view.layoutSubtreeIfNeeded()
        view.actualSize()
        for _ in 0..<40 { try await Task.sleep(for: .milliseconds(50)) }

        func color(at point: CGPoint) throws -> (r: UInt8, g: UInt8, b: UInt8) {
            var pixel = [UInt8](repeating: 0, count: 4)
            let context = try XCTUnwrap(CGContext(data: &pixel, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            // Top-left view point → the one pixel of the context.
            context.translateBy(x: -point.x, y: point.y + 1 - 600)
            context.translateBy(x: 0, y: 600)
            context.scaleBy(x: 1, y: -1)
            view.layer?.render(in: context)
            return (pixel[0], pixel[1], pixel[2])
        }
        // At 100% the image covers x 200…600, y 200…400 of the 800×600 view.
        XCTAssertGreaterThan(try color(at: CGPoint(x: 400, y: 300)).r, 200)
        XCTAssertGreaterThan(try color(at: CGPoint(x: 590, y: 390)).g, 150)
        XCTAssertLessThan(try color(at: CGPoint(x: 400, y: 450)).r, 50)
        XCTAssertLessThan(try color(at: CGPoint(x: 150, y: 300)).r, 50)

        // Zoomed out, a relayout (the selection toolbar appearing, a window resize) must keep the images
        // where the handles are; setting the world layer's frame once slid them to the corner.
        view.zoomOut()
        for _ in 0..<12 { try await Task.sleep(for: .milliseconds(50)) }
        XCTAssertEqual(view.scale, 1 / 1.4, accuracy: 0.001)
        view.needsLayout = true
        view.layoutSubtreeIfNeeded()
        XCTAssertGreaterThan(try color(at: CGPoint(x: 400, y: 300)).r, 200)
        XCTAssertGreaterThan(try color(at: CGPoint(x: 400 + 190 / 1.4, y: 300 + 90 / 1.4)).r, 200)
        XCTAssertLessThan(try color(at: CGPoint(x: 400 + 215 / 1.4, y: 300)).r, 50)
        view.actualSize()
        for _ in 0..<12 { try await Task.sleep(for: .milliseconds(50)) }

        // Selecting must not paint over the image (it once filled the selection with white).
        view.selectAll(nil)
        let selected = try color(at: CGPoint(x: 400, y: 300))
        XCTAssertGreaterThan(selected.r, 200)
        XCTAssertLessThan(selected.b, 100)
    }

    func testClickSelectsDragMovesAndTheWindowNeverTakesTheClick() async throws {
        let source = pasteboard()
        let item = NSPasteboardItem()
        item.setData(try imageData(.png, width: 400, height: 200), forType: .png)
        source.writeObjects([item])
        let board = CanvasBoard(directory: directory)
        let added = board.importImages(from: source, around: .zero)[0]

        let view = InfiniteCanvasView(board: board)
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 800, height: 600), styleMask: [.titled],
                              backing: .buffered, defer: false)
        window.isMovableByWindowBackground = true
        window.contentView = view
        view.frame = CGRect(x: 0, y: 0, width: 800, height: 600)
        view.layoutSubtreeIfNeeded()
        view.actualSize()
        XCTAssertFalse(view.mouseDownCanMoveWindow)

        // Window coordinates are bottom-left; view (400, 300) is the image's middle.
        func event(_ type: NSEvent.EventType, x: CGFloat, y: CGFloat) -> NSEvent {
            NSEvent.mouseEvent(with: type, location: CGPoint(x: x, y: 600 - y), modifierFlags: [], timestamp: 0,
                               windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
        }
        view.mouseDown(with: event(.leftMouseDown, x: 400, y: 300))
        XCTAssertEqual(view.selection, [added.id])
        view.mouseDragged(with: event(.leftMouseDragged, x: 450, y: 320))
        view.mouseUp(with: event(.leftMouseUp, x: 450, y: 320))
        XCTAssertEqual(board.items[0].x, added.x + 50, accuracy: 0.01)
        XCTAssertEqual(board.items[0].y, added.y + 20, accuracy: 0.01)

        // Click on empty space clears; the bottom-right handle resizes keeping proportions.
        view.mouseDown(with: event(.leftMouseDown, x: 60, y: 60))
        view.mouseUp(with: event(.leftMouseUp, x: 60, y: 60))
        XCTAssertTrue(view.selection.isEmpty)
        view.mouseDown(with: event(.leftMouseDown, x: 450, y: 320))
        view.mouseUp(with: event(.leftMouseUp, x: 450, y: 320))
        view.mouseDown(with: event(.leftMouseDown, x: 650, y: 420))  // image now ends at (650, 420)
        view.mouseDragged(with: event(.leftMouseDragged, x: 750, y: 420))
        view.mouseUp(with: event(.leftMouseUp, x: 750, y: 420))
        XCTAssertEqual(board.items[0].width, 500, accuracy: 0.01)
        XCTAssertEqual(board.items[0].height, 250, accuracy: 0.01)
    }
}
