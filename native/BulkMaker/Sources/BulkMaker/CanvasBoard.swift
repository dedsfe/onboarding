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
    /// A text box instead of an image (`file` stays empty): the string stays real text, editable and copyable.
    var text: String?
    var style: TextStyle?

    var isText: Bool { text != nil }

    var frame: CGRect {
        get { CGRect(x: x, y: y, width: width, height: height) }
        set { x = newValue.minX; y = newValue.minY; width = newValue.width; height = newValue.height }
    }
}

/// How a text box draws. Sizes are canvas units; colors are `#RRGGBB` or `#RRGGBBAA`.
struct TextStyle: Codable, Equatable {
    var size: Double = 32
    /// `regular`, `medium`, `semibold`, `bold` or `heavy`.
    var weight: String? = "medium"
    var color: String? = "#FFFFFF"
    var background: String? = "#141418E6"
    var padding: Double? = 18
    var radius: Double? = 18
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
    /// Every item this board has seen (loaded, added or deleted here). Anything on disk outside this set was
    /// put there by someone else (the AI's `carousel-render --canvas-add`) and must survive our next save.
    private var knownIDs = Set<UUID>()
    /// Images that came from outside and the user has not deleted here: undo never takes them away.
    private var externalIDs = Set<UUID>()
    private var diskStamp: Date?

    var media: URL { directory.appendingPathComponent("media", isDirectory: true) }
    private var boardFile: URL { directory.appendingPathComponent("board.json") }

    init(directory: URL = CanvasBoard.defaultDirectory) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: media, withIntermediateDirectories: true)
        items = readDisk() ?? []
        knownIDs = Set(items.map(\.id))
        diskStamp = stamp()
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

    func setText(_ text: String, of id: UUID) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        items[index].text = text
    }

    /// Scaling a text box scales its letters with it, so it keeps looking the same, only bigger.
    func scaleText(of id: UUID, by factor: Double) {
        guard let index = items.firstIndex(where: { $0.id == id }), items[index].isText, factor != 1 else { return }
        var style = items[index].style ?? TextStyle()
        style.size *= factor
        style.padding = style.padding.map { $0 * factor }
        style.radius = style.radius.map { $0 * factor }
        items[index].style = style
    }

    /// A new text box with its top-left corner at `origin`, sized to its text.
    func addText(_ text: String, style: TextStyle = TextStyle(), at origin: CGPoint) -> CanvasItem {
        let size = CanvasText.measure(text, style: style, maxWidth: 900)
        let item = CanvasItem(file: "", x: origin.x, y: origin.y, width: size.width, height: size.height, text: text, style: style)
        items.append(item)
        knownIDs.insert(item.id)
        changed()
        return item
    }

    /// Copies of text boxes (no file to copy), offset so they do not cover the originals.
    func duplicateTexts(_ source: [CanvasItem], offset: CGFloat) -> [CanvasItem] {
        let copies = source.filter(\.isText).map { item -> CanvasItem in
            var copy = item
            copy.id = UUID()
            copy.x += offset
            copy.y += offset
            return copy
        }
        guard !copies.isEmpty else { return [] }
        items.append(contentsOf: copies)
        knownIDs.formUnion(copies.map(\.id))
        changed()
        return copies
    }

    /// Duplicate the composition, including resized images, text styles and stacking order.
    /// Stage all media first: a missing/unreadable file must not leave half a selection duplicated.
    func duplicateItems(_ ids: Set<UUID>, offset: Double = 40) throws -> [CanvasItem] {
        var copies: [CanvasItem] = []
        var staged: [URL] = []
        do {
            for original in items where ids.contains(original.id) {
                var copy = original
                copy.id = UUID()
                copy.x += offset; copy.y += offset
                if !original.isText {
                    let ext = URL(fileURLWithPath: original.file).pathExtension
                    copy.file = UUID().uuidString + (ext.isEmpty ? "" : "." + ext)
                    let destination = url(of: copy)
                    try FileManager.default.copyItem(at: url(of: original), to: destination)
                    staged.append(destination)
                }
                copies.append(copy)
            }
        } catch {
            for file in staged { try? FileManager.default.removeItem(at: file) }
            throw error
        }
        guard !copies.isEmpty else { return [] }
        items.append(contentsOf: copies)
        knownIDs.formUnion(copies.map(\.id))
        changed()
        return copies
    }

    func remove(_ ids: Set<UUID>) {
        items.removeAll { ids.contains($0.id) }
        externalIDs.subtract(ids)
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

    /// Picks up images added from outside the app. Returns the ids that are new to this board.
    @discardableResult
    func reloadIfChangedOnDisk() -> [UUID] {
        let current = stamp()
        guard current != diskStamp, let disk = readDisk() else { return [] }
        diskStamp = current
        let fresh = disk.map(\.id).filter { !knownIDs.contains($0) }
        guard disk != items else { return fresh }
        items = disk
        knownIDs.formUnion(fresh)
        externalIDs.formUnion(fresh)
        onChange?()
        return fresh
    }

    /// Undo and redo put a whole earlier list back; deleted files stay on disk until the next launch.
    func replaceItems(_ snapshot: [CanvasItem]) {
        let inSnapshot = Set(snapshot.map(\.id))
        items = snapshot + items.filter { externalIDs.contains($0.id) && !inSnapshot.contains($0.id) }
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
        knownIDs.formUnion(added.map(\.id))
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

    private static let canvasItemType = NSPasteboard.PasteboardType("com.andrefelipe.carouselmaker.canvas-item")

    /// Each clipboard entry can be an image or text. The private metadata keeps the composition when
    /// copying within the app; ordinary Finder/browser/text clipboard formats still work without it.
    func importItems(from pasteboard: NSPasteboard, around center: CGPoint) -> [CanvasItem] {
        let temporary = NSPasteboard(name: .init("canvas-paste-\(UUID().uuidString)"))
        defer { temporary.releaseGlobally() }
        var ids: [UUID] = []
        var keepsLayout = true
        for source in pasteboard.pasteboardItems ?? [] {
            let metadata = source.data(forType: Self.canvasItemType)
                .flatMap { try? JSONDecoder().decode(CanvasItem.self, from: $0) }
                .flatMap { item -> CanvasItem? in
                    let values = [item.x, item.y, item.width, item.height]
                    guard values.allSatisfy({ $0.isFinite && abs($0) < 1_000_000 }), item.width > 0, item.height > 0 else { return nil }
                    if let style = item.style {
                        guard style.size.isFinite, (1...1000).contains(style.size),
                              [style.padding, style.radius].compactMap({ $0 }).allSatisfy({ $0.isFinite && (0...10_000).contains($0) }) else { return nil }
                    }
                    return item
                }
            // NSPasteboardItem instances cannot be owned by two pasteboards. Copy their representations.
            let entry = NSPasteboardItem()
            for type in source.types { if let data = source.data(forType: type) { entry.setData(data, forType: type) } }
            temporary.clearContents(); temporary.writeObjects([entry])
            var added = importImages(from: temporary, around: .zero)
            if added.isEmpty, let text = source.string(forType: .string),
               !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                added = [addText(text, style: metadata?.style ?? TextStyle(), at: .zero)]
            }
            guard let item = added.first else { continue }
            ids.append(item.id)
            if let metadata, metadata.isText == item.isText, metadata.text == item.text {
                setFrame(metadata.frame, of: item.id)
            } else { keepsLayout = false }
        }
        guard !ids.isEmpty else { return [] }
        let selected = items.filter { ids.contains($0.id) }
        if keepsLayout, let first = selected.first {
            let bounds = selected.dropFirst().reduce(first.frame) { $0.union($1.frame) }
            for item in selected { setFrame(item.frame.offsetBy(dx: center.x - bounds.midX, dy: center.y - bounds.midY), of: item.id) }
        } else {
            var x = center.x - (selected.map(\.width).reduce(0, +) + Double(selected.count - 1) * 24) / 2
            for item in selected {
                setFrame(CGRect(x: x, y: center.y - item.height / 2, width: item.width, height: item.height), of: item.id)
                x += item.width + 24
            }
        }
        changed()
        return items.filter { ids.contains($0.id) }
    }

    /// One pasteboard item per image: the file (Finder, Slack, uploads), its original bytes and a PNG.
    /// A text box goes out as plain text.
    func pasteboardItems(for items: [CanvasItem]) -> [NSPasteboardItem] {
        items.map { item in
            let entry = NSPasteboardItem()
            if let text = item.text {
                entry.setString(text, forType: .string)
            } else {
                let url = url(of: item)
                entry.setString(url.absoluteString, forType: .fileURL)
                let type = UTType(filenameExtension: url.pathExtension)
                if let type, let data = try? Data(contentsOf: url) {
                    entry.setData(data, forType: NSPasteboard.PasteboardType(type.identifier))
                }
                if type != .png, let png = Self.pngData(of: url) { entry.setData(png, forType: .png) }
            }
            if let metadata = try? JSONEncoder().encode(item) { entry.setData(metadata, forType: Self.canvasItemType) }
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
        // Images the AI added since our last read go on top instead of being overwritten.
        if let disk = readDisk() {
            let incoming = disk.filter { !knownIDs.contains($0.id) }
            items.append(contentsOf: incoming)
            knownIDs.formUnion(incoming.map(\.id))
            externalIDs.formUnion(incoming.map(\.id))
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try? encoder.encode(items).write(to: boardFile, options: .atomic)
        diskStamp = stamp()
    }

    private func readDisk() -> [CanvasItem]? {
        (try? Data(contentsOf: boardFile)).flatMap { try? JSONDecoder().decode([CanvasItem].self, from: $0) }
    }

    private func stamp() -> Date? {
        (try? URL(fileURLWithPath: boardFile.path).resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
    }

    /// Files no item uses anymore (deleted before the app closed, when undo is gone). Only old ones: a file
    /// that just arrived may be the AI's `--canvas-add` between copying the image and saving the list.
    private func removeOrphanFiles() {
        let used = Set(items.map(\.file))
        let cutoff = Date().addingTimeInterval(-600)
        for name in (try? FileManager.default.contentsOfDirectory(atPath: media.path)) ?? [] where !used.contains(name) {
            let file = media.appendingPathComponent(name)
            let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            if let modified, modified > cutoff { continue }
            try? FileManager.default.removeItem(at: file)
        }
    }
}
