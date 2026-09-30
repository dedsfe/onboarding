import AppKit
import ImageIO
import UniformTypeIdentifiers
import XCTest
@testable import BulkMaker

@MainActor
final class InputSourcesTests: XCTestCase {
    private var base: URL!

    override func setUp() async throws {
        base = FileManager.default.temporaryDirectory.appendingPathComponent("entradas-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: base)
    }

    private func image(_ name: String, in folder: URL, type: UTType = .png) throws -> URL {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let context = CGContext(data: nil, width: 20, height: 30, bitsPerComponent: 8, bytesPerRow: 0,
                                space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(gray: 0.5, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 20, height: 30))
        let url = folder.appendingPathComponent(name)
        let destination = CGImageDestinationCreateWithURL(url as CFURL, type.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, context.makeImage()!, nil)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return url
    }

    func testOneFinderFolderIsUsedInPlace() throws {
        let folder = base.appendingPathComponent("Fotos do Mac")
        _ = try image("a.png", in: folder)
        let target = base.appendingPathComponent("Projeto/Entradas/Fotos")
        let result = try InputAssembler.assemble(InputSources(folders: [folder.path]), kind: .photos,
                                                 into: target, canvasMedia: [:])
        XCTAssertEqual(result.standardizedFileURL.path, folder.standardizedFileURL.path)
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
    }

    func testMixedSourcesBecomeOneFolderTheBatchReads() throws {
        let finder = base.appendingPathComponent("Mac")
        _ = try image("01.png", in: finder)
        _ = try image("02.jpg", in: finder, type: .jpeg)
        try Data("nota".utf8).write(to: finder.appendingPathComponent("notas.txt"))
        let loose = try image("01.png", in: base.appendingPathComponent("Outra"))  // same name as one in the folder
        let screenshot = try image("print.tiff", in: base.appendingPathComponent("canvas-media"), type: .tiff)
        let canvasID = UUID()

        let target = base.appendingPathComponent("Projeto/Entradas/Fotos")
        let sources = InputSources(folders: [finder.path], files: [loose.path], canvasItems: [canvasID])
        let result = try InputAssembler.assemble(sources, kind: .photos, into: target, canvasMedia: [canvasID: screenshot])
        XCTAssertEqual(result, target)
        let names = try FileManager.default.contentsOfDirectory(atPath: target.path).sorted()
        XCTAssertEqual(names, ["01 2.png", "01.png", "02.jpg", "canvas-01.png"])
        // The batch's own reader sees every file, the TIFF included (as PNG).
        XCTAssertEqual(try PhotoCatalog(directory: target).files.count, 4)

        // Rebuilding drops what is no longer chosen.
        _ = try InputAssembler.assemble(InputSources(files: [loose.path], canvasItems: [canvasID]), kind: .photos,
                                        into: target, canvasMedia: [canvasID: screenshot])
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: target.path).sorted(), ["01.png", "canvas-01.png"])
    }

    func testReferencesKeepCaptionsAndNotes() throws {
        let finder = base.appendingPathComponent("Refs")
        _ = try image("r1.png", in: finder)
        try Data("legenda".utf8).write(to: finder.appendingPathComponent("legenda.txt"))
        let canvasID = UUID()
        let media = try image("x.png", in: base.appendingPathComponent("media"))
        let target = base.appendingPathComponent("Projeto/Entradas/Resultado desejado")
        _ = try InputAssembler.assemble(InputSources(folders: [finder.path], canvasItems: [canvasID]), kind: .desired,
                                        into: target, canvasMedia: [canvasID: media])
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: target.path).sorted(),
                       ["canvas-01.png", "legenda.txt", "r1.png"])
    }

    func testProjectRemembersItsSources() throws {
        let defaults = UserDefaults(suiteName: "entradas-\(UUID().uuidString)")!
        try FileManager.default.createDirectory(at: base.appendingPathComponent(".bulk-maker"), withIntermediateDirectories: true)
        func store() -> ProjectStore {
            ProjectStore(root: base.appendingPathComponent("Projetos"),
                         selectionFile: base.appendingPathComponent(".bulk-maker/selecao.json"),
                         legacyCanvas: base.appendingPathComponent("Canvas"), defaults: defaults)
        }
        let sources = InputSources(folders: ["/tmp/a"], canvasItems: [UUID()])
        store().setSources(sources, for: .photos)
        let reopened = store()
        XCTAssertEqual(reopened.current.project.photoSources, sources)
        XCTAssertNil(reopened.current.project.desiredSources)
        XCTAssertEqual(reopened.current.inputsFolder(.desired).lastPathComponent, "Resultado desejado")
    }
}
