import AppKit
import XCTest
@testable import BulkMaker

@MainActor
final class ResearchCanvasTests: XCTestCase {
    private var root: URL!

    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("research-canvas-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: root) }

    private func image(_ text: String, name: String) throws -> URL {
        let image = NSImage(size: CGSize(width: 540, height: 960), flipped: false) { rect in
            NSColor.white.setFill(); rect.fill()
            (text as NSString).draw(in: CGRect(x: 60, y: 400, width: 420, height: 360),
                                   withAttributes: [.font: NSFont.systemFont(ofSize: 34), .foregroundColor: NSColor.black])
            return true
        }
        let data = try XCTUnwrap(image.tiffRepresentation)
        let file = root.appendingPathComponent(name + ".tiff")
        try data.write(to: file)
        return file
    }

    func testEverySlideAndCompleteCaptionAreEditableAlignedAndPersisted() async throws {
        let canvas = root.appendingPathComponent("Canvas")
        let board = CanvasBoard(directory: canvas)
        let original = board.addText("Referência já organizada", at: CGPoint(x: 70, y: -150))
        let texts = ["Como fazer um propósito com Deus?", "Ore e leia salmos 121", String(repeating: "Texto longo que precisa ficar inteiro e legível. ", count: 14)]
        let slides = try texts.enumerated().map { index, text in
            ResearchCanvas.Slide(number: index + 1, file: try image(text, name: "slide-\(index)"), text: text)
        }
        let details = "702 mil curtidas · 119 mil salvos · 12 mil comentários · 8 mil compartilhamentos\n2025-08-02\nhttps://www.tiktok.com/@conta/photo/123\n" + String(repeating: "Legenda completa sem truncamento. ", count: 25)
        let added = try ResearchCanvas.add(title: "@conta · 7.800.000 visualizações", details: details, slides: slides, to: canvas)
        XCTAssertEqual(added.count, 8)
        XCTAssertEqual(added[1].text, details)
        let images = added.filter { !$0.isText }
        let transcripts = added.filter { $0.text?.hasPrefix("Slide ") == true }
        XCTAssertEqual(images.count, 3)
        XCTAssertEqual(transcripts.count, 3)
        XCTAssertEqual(Set(images.map(\.y)).count, 1)
        XCTAssertEqual(Set(transcripts.map(\.y)).count, 1)
        for (index, transcript) in transcripts.enumerated() {
            XCTAssertEqual(transcript.text, "Slide \(index + 1)\n\(texts[index])")
            XCTAssertEqual(transcript.x, images[index].x)
            let size = CanvasText.measure(try XCTUnwrap(transcript.text), style: try XCTUnwrap(transcript.style), maxWidth: transcript.width)
            XCTAssertGreaterThanOrEqual(transcript.height, size.height)
        }
        XCTAssertGreaterThan(added[0].y, original.frame.maxY)
        XCTAssertEqual(board.reloadIfChangedOnDisk().count, added.count)
        XCTAssertEqual(board.items.first, original)
        board.setText("Transcrição revisada pelo usuário", of: transcripts[0].id)
        board.changed()
        let saved = CanvasBoard.savedItems(in: canvas).map(\.item)
        XCTAssertTrue(saved.contains { $0.text == "Transcrição revisada pelo usuário" })
        XCTAssertEqual(saved.filter { !$0.isText }.count, 3)

        // Actual canvas rendering, with its real pan/zoom and text layers.
        let view = InfiniteCanvasView(board: board)
        let window = NSWindow(contentRect: CGRect(x: 100, y: 100, width: 1440, height: 1080),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = view
        window.makeKeyAndOrderFront(nil)
        defer { window.orderOut(nil); window.contentView = nil }
        view.frame = CGRect(x: 0, y: 0, width: 1440, height: 1080)
        view.layoutSubtreeIfNeeded()
        view.reveal(added.map(\.id))
        try await Task.sleep(for: .milliseconds(800))
        let bitmap = try XCTUnwrap(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: bitmap)
        try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
            .write(to: URL(fileURLWithPath: "/private/tmp/research-canvas-audit.png"))
    }

    func testMissingSlideKeepsItsPositionAndDoesNotClaimTextWasRead() throws {
        let first = try image("Slide 1", name: "primeiro")
        let last = try image("Slide 3", name: "ultimo")
        let slides = [ResearchCanvas.Slide(number: 1, file: first, text: "Primeiro"),
                      .init(number: 2, file: nil, text: "Slide não baixado; texto indisponível."),
                      .init(number: 3, file: last, text: "")]
        let added = try ResearchCanvas.add(title: "@conta", details: "Dados indisponíveis", slides: slides,
                                           to: root.appendingPathComponent("Canvas"))
        XCTAssertEqual(added.filter { !$0.isText }.count, 2)
        XCTAssertTrue(added.contains { $0.text == "Slide 2\nImagem não baixada" })
        XCTAssertTrue(added.contains { $0.text?.contains("Texto não reconhecido automaticamente") == true })
        XCTAssertEqual(added.filter { $0.text?.hasPrefix("Slide ") == true }.map(\.x), [0, 294, 294, 588])
    }

    func testOCRReadsTheActualImage() throws {
        let file = try image("Ore e leia salmos 121", name: "ocr")
        let image = try XCTUnwrap(CanvasBoard.displayImage(of: file, maxPixel: 960))
        let text = TikTokResearcher.recognizedText(in: image).lowercased()
        XCTAssertTrue(text.contains("salmos 121"), text)
    }

    func testResearchUsesTheProductAndDistinguishesUnknownCountsFromZero() throws {
        var profile = ProductProfile()
        profile.umbrellaNiche = "oração"
        profile.keywords = ["salmo 91"]
        profile.sellerSearches = ["aplicativo de oração"]
        let queries = TikTokResearcher.researchQueries("rotina", profile: profile)
        XCTAssertEqual(queries.first, "aplicativo de oração")
        XCTAssertTrue(queries.contains("app salmo 91"))
        XCTAssertTrue(queries.contains("aplicativo de oração"))
        let post = try XCTUnwrap(TikTokResearcher.post(from: [
            "id": "123", "author": ["uniqueId": "conta"], "desc": "Legenda real", "stats": ["diggCount": 0],
            "statsV2": ["playCount": "7800000"],
            "imagePost": ["images": [["imageURL": ["urlList": ["https://example.test/slide.jpg"]]], ["imageURL": ["urlList": ["https://example.test/slide2.jpg"]]]]]
        ]))
        XCTAssertTrue(post.unavailableMetrics.contains("collectCount"))
        XCTAssertFalse(post.unavailableMetrics.contains("diggCount"))
        XCTAssertTrue(TikTokResearcher.referenceTitle(post).contains("@conta"))
        let details = TikTokResearcher.referenceDetails(post, downloaded: 0, failed: [1])
        XCTAssertTrue(details.contains("0 curtidas"))
        XCTAssertTrue(details.contains("não informado salvos"))
        XCTAssertTrue(details.contains("Data: não informada"))
        XCTAssertTrue(details.contains("Slides não baixados: 1"))
        XCTAssertTrue(details.hasSuffix("Legenda real"))
        let record = TikTokResearcher.referenceRecord(post, folder: root, slides: [.init(number: 1, file: nil, text: "Indisponível")], canvas: root)
        let decoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONSerialization.data(withJSONObject: record)) as? [String: Any])
        XCTAssertTrue(decoded["salvos"] is NSNull)
        XCTAssertTrue(decoded["data"] is NSNull)
        XCTAssertEqual(decoded["curtidas"] as? Int, 0)
        XCTAssertEqual(decoded["views"] as? Int, 7_800_000)
    }
}
