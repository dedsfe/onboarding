import AppKit
import ImageIO
import UniformTypeIdentifiers

/// One image on the infinite canvas. The file keeps the exact bytes that came in (GIF, WebP, HEIC, PDF, SVG…);
/// the frame is in canvas units, top-left origin.
struct CanvasItem: Codable, Identifiable, Equatable {
    var id = UUID()
    /// File name inside the board's media folder.
    var file: String
    var x: Double
    var y: Double
    var width: Double
    var height: Double

    var frame: CGRect {
        get { CGRect(x: x, y: y, width: width, height: height) }
        set { x = newValue.minX; y = newValue.minY; width = newValue.width; height = newValue.height }
    }
}

/// The canvas's content on disk: `board.json` plus a `media` folder. Images come in and go out through the
/// pasteboard (copy/paste and drag and drop) with their original format, plus PNG for apps that only take bitmaps.
@MainActor
final class CanvasBoard {
    nonisolated static var defaultDirectory: URL {
        TerminalHandoff.projectDirectory.appendingPathComponent("Canvas", isDirectory: true)
    }

    /// Longest side of a new item, in canvas units.
    static let defaultSide: Double = 480
    /// Most faithful first: animation and wide formats before the flat bitmaps apps add as fallbacks.
    static let preferredTypes: [UTType] = [.gif, .webP, .heic, .heif, .png, .jpeg, .svg, .rawImage, .bmp, .ico, .tiff, .pdf]

    let directory: URL
    private(set) var items: [CanvasItem] = []
    var onChange: (() -> Void)?

    var media: URL { directory.appendingPathComponent("media", isDirectory: true) }
    private var boardFile: URL { directory.appendingPathComponent("board.json") }

    init(directory: URL = CanvasBoard.defaultDirectory) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: media, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: boardFile), let saved = try? JSONDecoder().decode([CanvasItem].self, from: data) {
            items = saved
        }
        removeOrphanFiles()
    }

    func url(of item: CanvasItem) -> URL { media.appendingPathComponent(item.file) }

    /// Another board's images, read only: no orphan cleanup, so an open canvas's undo never loses a file.
    nonisolated static func savedItems(in directory: URL) -> [(item: CanvasItem, url: URL)] {
        guard let data = try? Data(contentsOf: directory.appendingPathComponent("board.json")),
              let items = try? JSONDecoder().decode([CanvasItem].self, from: data) else { return [] }
        let media = directory.appendingPathComponent("media", isDirectory: true)
        return items.map { ($0, media.appendingPathComponent($0.file)) }
    }

    // MARK: - Editing

    func setFrame(_ frame: CGRect, of id: UUID) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        items[index].frame = frame
    }

    func remove(_ ids: Set<UUID>) {
        items.removeAll { ids.contains($0.id) }
        changed()
    }

    /// Later in the list draws on top.
    func bringToFront(_ ids: Set<UUID>) {
        items = items.filter { !ids.contains($0.id) } + items.filter { ids.contains($0.id) }
        changed()
    }

    func sendToBack(_ ids: Set<UUID>) {
        items = items.filter { ids.contains($0.id) } + items.filter { !ids.contains($0.id) }
        changed()
    }

    /// Image files picked in an open panel, laid out like a paste.
    func importFiles(_ urls: [URL], around center: CGPoint) -> [CanvasItem] {
        let sources = urls.filter(Self.isImportable).compactMap { url -> (data: Data, type: UTType)? in
            guard let data = try? Data(contentsOf: url), let type = UTType(filenameExtension: url.pathExtension) else { return nil }
            return (data, type)
        }
        return add(sources, around: center)
    }

    /// Undo and redo put a whole earlier list back; deleted files stay on disk until the next launch.
    func replaceItems(_ snapshot: [CanvasItem]) {
        items = snapshot
        changed()
    }

    /// Call after a gesture ends; moves and resizes save once, not on every mouse event.
    func changed() {
        save()
        onChange?()
    }

    // MARK: - Coming in

    /// File URLs are image files (any format ImageIO or AppKit reads, PDF and SVG included).
    static func isImportable(_ url: URL) -> Bool {
        guard let type = UTType(filenameExtension: url.pathExtension) else { return false }
        return type.conforms(to: .image) || type.conforms(to: .pdf)
    }

    /// Everything image-like on the pasteboard: files first (Finder, drags), else the richest image data of
    /// each item (browsers, screenshots, Preview). Returns the new items, laid out in a row around `center`.
    func importImages(from pasteboard: NSPasteboard, around center: CGPoint) -> [CanvasItem] {
        var sources: [(data: Data, type: UTType)] = []
        let urls = (pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
        for url in urls where Self.isImportable(url) {
            if let data = try? Data(contentsOf: url), let type = UTType(filenameExtension: url.pathExtension) {
                sources.append((data, type))
            }
        }
        if sources.isEmpty {
            for item in pasteboard.pasteboardItems ?? [] {
                let types = item.types.compactMap { UTType($0.rawValue) }
                let best = Self.preferredTypes.first { preferred in types.contains { $0 == preferred } }
                    ?? types.first { $0.conforms(to: .image) }
                if let best, let data = item.data(forType: NSPasteboard.PasteboardType(best.identifier)) {
                    sources.append((data, best))
                }
            }
        }
        return add(sources, around: center)
    }

    func add(_ sources: [(data: Data, type: UTType)], around center: CGPoint) -> [CanvasItem] {
        var added: [CanvasItem] = []
        for source in sources {
            let name = UUID().uuidString + "." + (source.type.preferredFilenameExtension ?? "img")
            let file = media.appendingPathComponent(name)
            guard (try? source.data.write(to: file, options: .atomic)) != nil else { continue }
            guard let size = Self.naturalSize(of: file) else {
                try? FileManager.default.removeItem(at: file)
                continue
            }
            let fit = Self.defaultSide / max(size.width, size.height)
            let scale = min(fit, 1)
            added.append(CanvasItem(file: name, x: 0, y: 0, width: size.width * scale, height: size.height * scale))
        }
        guard !added.isEmpty else { return [] }
        // One row, centered on the point, with a gap between images.
        let gap = 24.0
        var x = center.x - (added.map(\.width).reduce(0, +) + gap * Double(added.count - 1)) / 2
        for index in added.indices {
            added[index].x = x
            added[index].y = center.y - added[index].height / 2
            x += added[index].width + gap
        }
        items.append(contentsOf: added)
        changed()
        return added
    }

    /// Size in points: pixels at 144 dpi count half, like screenshots on a Retina screen.
    static func naturalSize(of file: URL) -> CGSize? {
        if let source = CGImageSourceCreateWithURL(file as CFURL, nil),
           let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
           let width = properties[kCGImagePropertyPixelWidth] as? Double,
           let height = properties[kCGImagePropertyPixelHeight] as? Double, width > 0, height > 0 {
            let dpi = properties[kCGImagePropertyDPIWidth] as? Double ?? 72
            let density = dpi >= 144 ? 2.0 : 1.0
            let oriented = (properties[kCGImagePropertyOrientation] as? Int ?? 1) >= 5
            return oriented ? CGSize(width: height / density, height: width / density)
                : CGSize(width: width / density, height: height / density)
        }
        // PDF, SVG and anything else only AppKit reads.
        if let image = NSImage(contentsOf: file), image.size.width > 0, image.size.height > 0 { return image.size }
        return nil
    }

    // MARK: - Going out

    /// One pasteboard item per image: the file (Finder, Slack, uploads), its original bytes and a PNG.
    func pasteboardItems(for items: [CanvasItem]) -> [NSPasteboardItem] {
        items.map { item in
            let url = url(of: item)
            let entry = NSPasteboardItem()
            entry.setString(url.absoluteString, forType: .fileURL)
            let type = UTType(filenameExtension: url.pathExtension)
            if let type, let data = try? Data(contentsOf: url) {
                entry.setData(data, forType: NSPasteboard.PasteboardType(type.identifier))
            }
            if type != .png, let png = Self.pngData(of: url) {
                entry.setData(png, forType: .png)
            }
            return entry
        }
    }

    func copy(_ items: [CanvasItem], to pasteboard: NSPasteboard = .general) {
        pasteboard.clearContents()
        pasteboard.writeObjects(pasteboardItems(for: items))
    }

    nonisolated static func pngData(of url: URL) -> Data? {
        guard let image = displayImage(of: url, maxPixel: 4096) else { return nil }
        return NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    }

    /// Decoded for the screen: downsampled by ImageIO, or drawn by AppKit for PDF and SVG.
    nonisolated static func displayImage(of url: URL, maxPixel: Int) -> CGImage? {
        if let source = CGImageSourceCreateWithURL(url as CFURL, nil), CGImageSourceGetCount(source) > 0,
           let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
               kCGImageSourceCreateThumbnailFromImageAlways: true,
               kCGImageSourceCreateThumbnailWithTransform: true,
               kCGImageSourceShouldCacheImmediately: true,
               kCGImageSourceThumbnailMaxPixelSize: maxPixel
           ] as CFDictionary) {
            return image
        }
        guard let image = NSImage(contentsOf: url), image.size.width > 0 else { return nil }
        let scale = CGFloat(maxPixel) / max(image.size.width, image.size.height)
        var rect = CGRect(origin: .zero, size: CGSize(width: image.size.width * scale, height: image.size.height * scale))
        return image.cgImage(forProposedRect: &rect, context: nil, hints: nil)
    }

    // MARK: - Disk

    private func save() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try? encoder.encode(items).write(to: boardFile, options: .atomic)
    }

    /// Files no item uses anymore (deleted before the app closed, when undo is gone).
    private func removeOrphanFiles() {
        let used = Set(items.map(\.file))
        for name in (try? FileManager.default.contentsOfDirectory(atPath: media.path)) ?? [] where !used.contains(name) {
            try? FileManager.default.removeItem(at: media.appendingPathComponent(name))
        }
    }
}
