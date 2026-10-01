import AppKit
import ImageIO

/// A project's canvas as the app keeps it on disk (`board.json` plus `media/`), for tools outside the app:
/// the AI adds the images it generates here and the open canvas shows them a second later.
public enum CanvasFolder {
    /// Same keys as the app's canvas items, so both read and write one `board.json`.
    public struct Entry: Codable, Equatable, Sendable {
        public var id: UUID
        public var file: String
        public var x: Double
        public var y: Double
        public var width: Double
        public var height: Double
    }

    public enum CanvasError: LocalizedError {
        case notAnImage(String)

        public var errorDescription: String? {
            switch self {
            case .notAnImage(let path): return "Não é uma imagem que o canvas abre: \(path)"
            }
        }
    }

    /// Longest side of a new image, in canvas units (same as pasting in the app).
    public static let defaultSide: Double = 480

    /// A separate marker per terminal run: concurrent generators cannot stop each other's indicator.
    /// Markers expire if an interrupted agent never sends its final update.
    private struct Generation: Codable {
        let expires: Date
    }

    public static let generationSessionKey = "BULKMAKER_GENERATION_SESSION"
    public static let generationLifetime: TimeInterval = 20 * 60

    private static func generationFile(in directory: URL, session: UUID) -> URL {
        directory.appendingPathComponent(".generation", isDirectory: true)
            .appendingPathComponent(session.uuidString + ".json")
    }

    public static func beginGeneration(in directory: URL, session: UUID, now: Date = Date()) throws {
        let file = generationFile(in: directory, session: session)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(Generation(expires: now.addingTimeInterval(generationLifetime)))
            .write(to: file, options: .atomic)
    }

    public static func endGeneration(in directory: URL, session: UUID) throws {
        let file = generationFile(in: directory, session: session)
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }

    /// Only sessions still owned by this app count. Closing/restarting a tab or relaunching the app
    /// immediately invalidates its markers, even if the CLI was killed before it could clean up.
    public static func isGenerating(in directory: URL, sessions: Set<UUID>, now: Date = Date()) -> Bool {
        sessions.contains { session in
            guard let data = try? Data(contentsOf: generationFile(in: directory, session: session)),
                  let generation = try? JSONDecoder().decode(Generation.self, from: data) else { return false }
            return generation.expires > now
        }
    }

    public static func entries(in directory: URL) -> [Entry] {
        guard let data = try? Data(contentsOf: directory.appendingPathComponent("board.json")) else { return [] }
        return (try? JSONDecoder().decode([Entry].self, from: data)) ?? []
    }

    public static func mediaURL(of entry: Entry, in directory: URL) -> URL {
        directory.appendingPathComponent("media", isDirectory: true).appendingPathComponent(entry.file)
    }

    /// Copies the files in (original bytes) and lays them in a row to the right of everything already there,
    /// tops aligned, so nothing the user arranged moves. Returns the new entries.
    @discardableResult
    public static func add(_ files: [URL], to directory: URL) throws -> [Entry] {
        let media = directory.appendingPathComponent("media", isDirectory: true)
        try FileManager.default.createDirectory(at: media, withIntermediateDirectories: true)
        var existing = entries(in: directory)
        var added: [Entry] = []
        for file in files {
            guard let size = naturalSize(of: file) else { throw CanvasError.notAnImage(file.path) }
            let ext = file.pathExtension.isEmpty ? "img" : file.pathExtension.lowercased()
            let name = UUID().uuidString + "." + ext
            try FileManager.default.copyItem(at: file, to: media.appendingPathComponent(name))
            let scale = min(defaultSide / max(size.width, size.height), 1)
            added.append(Entry(id: UUID(), file: name, x: 0, y: 0, width: size.width * scale, height: size.height * scale))
        }
        guard !added.isEmpty else { return [] }
        let gap = 24.0
        var x: Double, top: Double
        if let first = existing.first {
            let bounds = existing.dropFirst().reduce(frame(first)) { $0.union(frame($1)) }
            x = bounds.maxX + 80
            top = bounds.minY
        } else {
            x = -(added.map(\.width).reduce(0, +) + gap * Double(added.count - 1)) / 2
            top = -(added.map(\.height).max() ?? 0) / 2
        }
        for index in added.indices {
            added[index].x = x
            added[index].y = top
            x += added[index].width + gap
        }
        existing.append(contentsOf: added)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(existing).write(to: directory.appendingPathComponent("board.json"), options: .atomic)
        return added
    }

    private static func frame(_ entry: Entry) -> CGRect {
        CGRect(x: entry.x, y: entry.y, width: entry.width, height: entry.height)
    }

    /// Points, like the app: pixels at 144 dpi or more count half (Retina screenshots).
    static func naturalSize(of file: URL) -> CGSize? {
        if let source = CGImageSourceCreateWithURL(file as CFURL, nil),
           let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
           let width = properties[kCGImagePropertyPixelWidth] as? Double,
           let height = properties[kCGImagePropertyPixelHeight] as? Double, width > 0, height > 0 {
            let density = (properties[kCGImagePropertyDPIWidth] as? Double ?? 72) >= 144 ? 2.0 : 1.0
            let rotated = (properties[kCGImagePropertyOrientation] as? Int ?? 1) >= 5
            return rotated ? CGSize(width: height / density, height: width / density)
                : CGSize(width: width / density, height: height / density)
        }
        if let image = NSImage(contentsOf: file), image.size.width > 0, image.size.height > 0 { return image.size }
        return nil
    }
}
