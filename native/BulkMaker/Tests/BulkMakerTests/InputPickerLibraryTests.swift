import AppKit
import XCTest
@testable import BulkMaker

@MainActor
final class InputPickerLibraryTests: XCTestCase {
    private var root: URL!
    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("InputPicker-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDown() async throws { try? FileManager.default.removeItem(at: root) }

    private func photo(_ name: String, in directory: URL) throws -> URL {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let image = NSImage(size: CGSize(width: 160, height: 100), flipped: false) { rect in
            NSColor.systemGreen.setFill(); rect.fill(); return true
        }
        let bitmap = NSBitmapImageRep(data: try XCTUnwrap(image.tiffRepresentation))!
        let file = directory.appendingPathComponent(name)
        try XCTUnwrap(bitmap.representation(using: .png, properties: [:])).write(to: file)
        return file
    }

    func testFolderExposesEveryPhotoAndDeselectingOneChangesTheActualBatch() async throws {
        let folder = root.appendingPathComponent("SC")
        for number in 1...10 { _ = try photo("foto-\(number).png", in: folder) }
        try Data("Não é uma foto".utf8).write(to: folder.appendingPathComponent("notas.txt"))
        let library = InputPickerLibrary(kind: .photos, sources: InputSources(folders: [folder.path]))
        await library.refresh()
        XCTAssertEqual(library.macFiles.count, 10)
        XCTAssertEqual(library.macFiles.map(\.lastPathComponent), (1...10).map { "foto-\($0).png" })
        XCTAssertEqual(library.total, 10)
        let excluded = try XCTUnwrap(library.macFiles.first)
        library.toggle(excluded)
        XCTAssertEqual(library.macFiles.count, 10, "Desmarcar não pode esconder a miniatura")
        XCTAssertEqual(library.total, 9)
        XCTAssertNil(library.sources.singleFolder, "Seleção parcial precisa montar um lote filtrado")
        let output = root.appendingPathComponent("Projeto/Entradas/Fotos")
        _ = try InputAssembler.assemble(library.sources, kind: .photos, into: output, canvasMedia: [:])
        XCTAssertEqual(try PhotoCatalog(directory: output).files.count, 9)
        XCTAssertFalse(FileManager.default.fileExists(atPath: output.appendingPathComponent(excluded.lastPathComponent).path))
        XCTAssertEqual(InputAssembler.files(in: folder, kind: .photos).count, 10, "Os originais devem continuar intactos")
        let saved = try JSONDecoder().decode(InputSources.self, from: JSONEncoder().encode(library.sources))
        let reopened = InputPickerLibrary(kind: .photos, sources: saved)
        await reopened.refresh()
        XCTAssertEqual(reopened.total, 9)
        XCTAssertFalse(reopened.isSelected(excluded))
        reopened.selectMac(false)
        XCTAssertEqual(reopened.total, 0)
        reopened.selectMac(true)
        XCTAssertEqual(reopened.total, 10)
    }

    func testLegacySourcesDecodeWithoutAnExclusionList() throws {
        let sources = try JSONDecoder().decode(InputSources.self, from: Data(#"{"folders":["/tmp/SC"],"files":[],"canvasItems":[]}"#.utf8))
        XCTAssertEqual(sources.folders, ["/tmp/SC"])
        XCTAssertTrue(sources.excludedFiles.isEmpty)
        XCTAssertNotNil(sources.singleFolder)
    }

    func testCanvasTextMissingFilesAndDirectoriesNeverBecomeEmptyPhotoTiles() throws {
        let file = try photo("foto.png", in: root.appendingPathComponent("media"))
        let valid = CanvasItem(file: "foto.png", x: 0, y: 0, width: 100, height: 100)
        let text = CanvasItem(file: "", x: 0, y: 0, width: 100, height: 100, text: "Legenda")
        let missing = CanvasItem(file: "sumiu.png", x: 0, y: 0, width: 100, height: 100)
        let library = InputPickerLibrary(kind: .photos,
            sources: InputSources(canvasItems: [valid.id, text.id, missing.id]),
            canvas: [(valid, file), (text, file.deletingLastPathComponent()), (missing, root.appendingPathComponent("sumiu.png"))])
        XCTAssertEqual(library.canvas.map(\.item.id), [valid.id])
        XCTAssertEqual(library.sources.canvasItems, [valid.id])
        XCTAssertEqual(library.total, 1)
    }

    func testSameFileIsNotCountedOrAssembledTwiceAndCanvasCanSelectAMacOptOut() async throws {
        let folder = root.appendingPathComponent("Fotos")
        let file = try photo("foto.png", in: folder)
        let item = CanvasItem(file: "foto.png", x: 0, y: 0, width: 100, height: 100)
        let library = InputPickerLibrary(kind: .photos,
            sources: InputSources(folders: [folder.path], files: [file.path], canvasItems: [item.id]), canvas: [(item, file)])
        await library.refresh()
        XCTAssertEqual(library.macFiles.count, 1)
        XCTAssertEqual(library.total, 1)
        library.toggle(file)
        XCTAssertEqual(library.total, 1, "A seleção do canvas é independente do Mac")
        let output = root.appendingPathComponent("Projeto/Entradas/Fotos")
        _ = try InputAssembler.assemble(library.sources, kind: .photos, into: output, canvasMedia: [item.id: file])
        XCTAssertEqual(try PhotoCatalog(directory: output).files.count, 1)
        library.removeFolder(folder.path)
        XCTAssertTrue(library.sources.folders.isEmpty)
    }
}
