import AppKit
import UniformTypeIdentifiers

/// The batch inputs that can mix Finder and canvas.
enum InputKind: String, Codable, CaseIterable {
    case photos, desired

    var title: String {
        switch self {
        case .photos: return "Fotos"
        case .desired: return "Resultado desejado"
        }
    }

    /// Photos must be images; references also keep captions and notes (`legenda.txt`).
    var acceptsAnyFile: Bool { self == .desired }
}

/// Where one input comes from: any mix of Finder folders, Finder files and canvas images.
struct InputSources: Codable, Equatable {
    var folders: [String] = []
    var files: [String] = []
    var canvasItems: [UUID] = []

    var isEmpty: Bool { folders.isEmpty && files.isEmpty && canvasItems.isEmpty }

    /// One Finder folder and nothing else is used in place, exactly like before sources could mix.
    var singleFolder: URL? {
        folders.count == 1 && files.isEmpty && canvasItems.isEmpty ? URL(fileURLWithPath: folders[0], isDirectory: true) : nil
    }
}

/// Turns mixed sources into the one folder the batch, the renderer and the AI read.
enum InputAssembler {
    /// Formats the batch reads as they are; anything else (HEIC, TIFF, PDF, SVG…) comes in as PNG.
    static let batchImageTypes: Set<String> = ["jpg", "jpeg", "png", "webp", "gif"]

    static func isImage(_ url: URL) -> Bool {
        UTType(filenameExtension: url.pathExtension).map { $0.conforms(to: .image) || $0.conforms(to: .pdf) } ?? false
    }

    /// Visible files of a Finder folder that this input takes, in Finder order.
    static func files(in folder: URL, kind: InputKind) -> [URL] {
        ((try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.isRegularFileKey],
                                                       options: [.skipsHiddenFiles])) ?? [])
            .filter { (try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true }
            .filter { kind.acceptsAnyFile || isImage($0) }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
    }

    /// The folder to hand the batch: the single Finder folder itself, or `target` rebuilt with every chosen
    /// file. Files are hard-linked (no extra disk space) and copied only across disks. The new folder is built
    /// beside the old one and swapped in at the end, so the batch never sees it half made (and a source that is
    /// the old folder itself can still be read).
    static func assemble(_ sources: InputSources, kind: InputKind, into target: URL,
                         canvasMedia: [UUID: URL]) throws -> URL {
        if let single = sources.singleFolder { return single }
        let fileManager = FileManager.default
        let building = target.deletingLastPathComponent().appendingPathComponent(".\(target.lastPathComponent)-montando",
                                                                               isDirectory: true)
        try? fileManager.removeItem(at: building)
        try fileManager.createDirectory(at: building, withIntermediateDirectories: true)

        var used = Set<String>()
        func add(_ source: URL, name preferred: String) throws {
            let ext = source.pathExtension.lowercased()
            let convert = !batchImageTypes.contains(ext) && isImage(source)
            let base = (preferred as NSString).deletingPathExtension
            let finalExt = convert ? "png" : ext
            var name = finalExt.isEmpty ? base : "\(base).\(finalExt)"
            var suffix = 2
            while used.contains(name.lowercased()) {
                name = finalExt.isEmpty ? "\(base) \(suffix)" : "\(base) \(suffix).\(finalExt)"
                suffix += 1
            }
            used.insert(name.lowercased())
            let destination = building.appendingPathComponent(name)
            if convert {
                guard let png = CanvasBoard.pngData(of: source) else { return }
                try png.write(to: destination, options: .atomic)
            } else if (try? fileManager.linkItem(at: source, to: destination)) == nil {
                try fileManager.copyItem(at: source, to: destination)
            }
        }

        for folder in sources.folders {
            for file in files(in: URL(fileURLWithPath: folder), kind: kind) { try add(file, name: file.lastPathComponent) }
        }
        for path in sources.files {
            let url = URL(fileURLWithPath: path)
            guard fileManager.fileExists(atPath: path), kind.acceptsAnyFile || isImage(url) else { continue }
            try add(url, name: url.lastPathComponent)
        }
        for (index, id) in sources.canvasItems.enumerated() {
            guard let media = canvasMedia[id], fileManager.fileExists(atPath: media.path) else { continue }
            try add(media, name: String(format: "canvas-%02d.%@", index + 1, media.pathExtension))
        }
        if fileManager.fileExists(atPath: target.path) {
            _ = try fileManager.replaceItemAt(target, withItemAt: building)
        } else {
            try fileManager.moveItem(at: building, to: target)
        }
        return target
    }
}
