import AppKit
import CarouselEngine
import XCTest
@testable import BulkMaker

@MainActor
final class CalendarPostImportTests: XCTestCase {
    private var root: URL!
    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("CalendarImport-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDown() async throws { try? FileManager.default.removeItem(at: root) }

    private func image(_ name: String) throws -> URL {
        let file = root.appendingPathComponent(name)
        let image = NSImage(size: CGSize(width: 30, height: 40), flipped: false) { rect in
            NSColor.systemGreen.setFill(); rect.fill(); return true
        }
        let bitmap = NSBitmapImageRep(data: try XCTUnwrap(image.tiffRepresentation))!
        let data = name.hasSuffix("tiff") ? image.tiffRepresentation : bitmap.representation(using: .png, properties: [:])
        try XCTUnwrap(data).write(to: file)
        return file
    }

    private func date(_ text: String) -> Date {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.date(from: text)!
    }

    func testImportedSlidesKeepTheirOrderCaptionAndOwnFilesAfterOriginalsAreDeleted() throws {
        let first = try image("Foto 2.png"), second = try image("Foto 10.tiff")
        let png = try Data(contentsOf: first)
        let folder = try CalendarPostImport.prepare([second, first], caption: " Minha legenda\n#produto ", in: root)
        let slides = CalendarPreview.slides(in: folder)
        XCTAssertEqual(slides.map(\.lastPathComponent), ["slide-001.png", "slide-002.png"])
        XCTAssertEqual(try Data(contentsOf: slides[1]), png)
        try FileManager.default.removeItem(at: first)
        try FileManager.default.removeItem(at: second)
        XCTAssertNotNil(NSImage(contentsOf: slides[0]))
        XCTAssertNotNil(NSImage(contentsOf: slides[1]))
        XCTAssertEqual(try String(contentsOf: folder.appendingPathComponent("legenda.txt"), encoding: .utf8), "Minha legenda\n#produto")
    }

    func testBrokenImageRollsBackTheWholePostAndFolderSelectionIsNaturallySorted() throws {
        _ = try image("Foto 10.png"); _ = try image("Foto 2.png")
        let broken = root.appendingPathComponent("quebrada.png")
        try Data("não é imagem".utf8).write(to: broken)
        XCTAssertThrowsError(try CalendarPostImport.prepare([root.appendingPathComponent("Foto 2.png"), broken], caption: "", in: root))
        let parent = root.appendingPathComponent("Calendário")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: parent.path), [])
        try FileManager.default.removeItem(at: broken)
        XCTAssertEqual(CalendarPostImport.images(in: [root, root.appendingPathComponent("Foto 2.png")]).map(\.lastPathComponent),
                       ["Foto 2.png", "Foto 10.png"])
    }

    func testCommitUsesExactDateRejectsOccupiedOrPastSlotsAndPreservesOtherPosts() throws {
        let file = root.appendingPathComponent("agenda.json"), now = date("2026-10-17 10:00")
        let rules = PostAgenda.Rules(maxPerDay: 1, times: ["19:00"])
        var original = PostAgenda(rules: rules)
        try original.schedule(folder: root.appendingPathComponent("outro"), now: now)
        try original.save(to: file)
        let imported = root.appendingPathComponent("importado")
        let post = try CalendarPostImport.commit(folder: imported, date: date("2026-10-18 15:30"), caption: "Legenda", to: file, now: now)
        XCTAssertEqual(post.date, "2026-10-18"); XCTAssertEqual(post.time, "15:30")
        let saved = try PostAgenda.load(from: file)
        XCTAssertEqual(saved.rules, rules)
        XCTAssertEqual(saved.posts.count, 2)
        XCTAssertEqual(saved.posts.first?.folder, original.posts.first?.folder)
        XCTAssertThrowsError(try CalendarPostImport.commit(folder: root.appendingPathComponent("conflito"),
            date: date("2026-10-18 15:30"), caption: "", to: file, now: now))
        XCTAssertThrowsError(try CalendarPostImport.commit(folder: root.appendingPathComponent("passado"),
            date: date("2026-10-16 15:30"), caption: "", to: file, now: now))
        XCTAssertEqual(try PostAgenda.load(from: file), saved)
    }

    func testAdditionalSelectionPreservesReviewedOrderAndRequestCapturesOnlyItsProject() throws {
        let a = try image("a.png"), b = try image("b.png"), c = try image("c.png")
        XCTAssertEqual(CalendarPostImport.updating([b, a], with: [a, b, c]), [b, a, c])
        XCTAssertEqual(CalendarPostImport.updating([b, a], with: [a, c]), [a, c])
        let store = ProjectStore(root: root.appendingPathComponent("Projects"), selectionFile: root.appendingPathComponent("live/selecao.json"),
                                 legacyCanvas: root.appendingPathComponent("legacy"), defaults: UserDefaults(suiteName: UUID().uuidString)!)
        let center = CalendarPostCenter(store: store)
        center.present(.selection, files: [b, a, b])
        XCTAssertEqual(center.request?.project.id, store.current.id)
        XCTAssertEqual(center.request?.files, [b, a])
        XCTAssertEqual(center.request?.agendaFile, store.liveAgenda)
        XCTAssertEqual(try PostAgenda.load(from: store.liveAgenda).posts.count, 0)
    }
}
