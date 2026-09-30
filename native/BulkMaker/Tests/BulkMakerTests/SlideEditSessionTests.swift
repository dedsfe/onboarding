import CarouselEngine
import XCTest
@testable import BulkMaker

@MainActor
final class SlideEditSessionTests: XCTestCase {
    private func makePost() throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("editor-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let context = try XCTUnwrap(CGContext(data: nil, width: 108, height: 192, bitsPerComponent: 8, bytesPerRow: 0,
                                              space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.setFillColor(CGColor(gray: 0.3, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 108, height: 192))
        let photo = folder.appendingPathComponent("foto.jpg")
        try SlideRenderer.writeJPEG(try XCTUnwrap(context.makeImage()), to: photo)
        let plan = CarouselPlan(style: SlideStyle(position: .bottom),
                                slides: [SlidePlan(photo: photo.path, text: "primeira frase"),
                                         SlidePlan(photo: photo.path, text: "segunda frase")])
        try JSONEncoder().encode(plan).write(to: folder.appendingPathComponent(".plano.json"))
        return folder
    }

    private func plan(in folder: URL) throws -> CarouselPlan {
        try JSONDecoder().decode(CarouselPlan.self, from: Data(contentsOf: folder.appendingPathComponent(".plano.json")))
    }

    func testEditSavesThePlanAndRedrawsOnlyTheOpenSlide() async throws {
        let folder = try makePost()
        defer { try? FileManager.default.removeItem(at: folder) }
        let session = SlideEditSession(folder: folder)
        session.setText("frase nova", at: 1)
        session.toggleHighlight("nova", at: 1)
        for _ in 0..<100 where session.images[1] == nil { try await Task.sleep(for: .milliseconds(50)) }

        XCTAssertNotNil(session.images[1])
        XCTAssertNil(session.images[0])
        XCTAssertEqual(try plan(in: folder).slides[1].text, "frase nova")
        XCTAssertEqual(try plan(in: folder).slides[1].highlight, ["nova"])
        XCTAssertTrue(FileManager.default.fileExists(atPath: folder.appendingPathComponent("slide-02.jpg").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: folder.appendingPathComponent("slide-01.jpg").path))
    }

    func testPostScopeChangesThePostStyleAndRedrawsEverySlide() async throws {
        let folder = try makePost()
        defer { try? FileManager.default.removeItem(at: folder) }
        let session = SlideEditSession(folder: folder)
        session.scope = .post
        var preferences = session.preferences(for: 0)
        preferences.textColor = "#FFD60A"
        session.setStyle(preferences, for: 0)
        for _ in 0..<200 where session.images.count < 2 { try await Task.sleep(for: .milliseconds(50)) }

        XCTAssertEqual(session.images.count, 2)
        XCTAssertEqual(try plan(in: folder).style, SlideStyle(color: "#FFD60A", position: .bottom))
    }

    func testPicksUpAPlanTheAIRewrote() throws {
        let folder = try makePost()
        defer { try? FileManager.default.removeItem(at: folder) }
        let session = SlideEditSession(folder: folder)
        var changed = try plan(in: folder)
        changed.slides[0].text = "a IA mudou"
        try JSONEncoder().encode(changed).write(to: folder.appendingPathComponent(".plano.json"))
        session.checkExternalChanges()
        XCTAssertEqual(session.slide(0)?.text, "a IA mudou")
        XCTAssertEqual(session.revision, 1)
    }

    func testAnEmptySlideIsNeverSaved() async throws {
        let folder = try makePost()
        defer { try? FileManager.default.removeItem(at: folder) }
        let session = SlideEditSession(folder: folder)
        session.setText("   ", at: 0)
        try await Task.sleep(for: .milliseconds(400))
        XCTAssertEqual(try plan(in: folder).slides[0].text, "primeira frase")
        session.setText("de volta", at: 0)
        for _ in 0..<100 where session.images[0] == nil { try await Task.sleep(for: .milliseconds(50)) }
        XCTAssertEqual(try plan(in: folder).slides[0].text, "de volta")
    }
}
