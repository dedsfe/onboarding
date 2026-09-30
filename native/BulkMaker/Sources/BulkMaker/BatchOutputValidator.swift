import Foundation
import ImageIO

/// Checks the files produced by this run, rather than trusting the CLI exit code.
enum BatchOutputValidator {
    struct Fingerprint: Equatable {
        let bytes: Int64
        let modified: Date?
    }

    struct Snapshot {
        let files: [String: Fingerprint]
    }

    struct Summary: Equatable {
        let variations: Int
        let slidesPerVariation: Int
    }

    enum ValidationError: LocalizedError {
        case missingVariation(Int)
        case emptyVariation(Int)
        case staleFile(String)
        case invalidImage(String)
        case inconsistentSlides(Int, Int, Int)

        var errorDescription: String? {
            switch self {
            case .missingVariation(let index): return "Faltou a pasta variacao-\(number(index))."
            case .emptyVariation(let index): return "A variacao-\(number(index)) não tem slides."
            case .staleFile(let name): return "O slide \(name) não foi gerado nesta execução."
            case .invalidImage(let name): return "O slide \(name) não é uma imagem válida."
            case .inconsistentSlides(let index, let expected, let actual):
                return "A variacao-\(number(index)) tem \(actual) slides; eram esperados \(expected)."
            }
        }
    }

    private static let imageExtensions = Set(["png", "jpg", "jpeg", "webp", "heic", "tif", "tiff"])

    /// Only files inside the variation folders this run may write are conflicts.
    static func existingFiles(in output: URL, variations: Int) throws -> [URL] {
        guard variations > 0 else { return [] }
        var files: [URL] = []
        for index in 1...variations {
            let directory = folder(in: output, index: index)
            guard FileManager.default.fileExists(atPath: directory.path) else { continue }
            var enumerationError: Error?
            guard let enumerator = FileManager.default.enumerator(
                at: directory,
                includingPropertiesForKeys: [.isRegularFileKey],
                options: [.skipsHiddenFiles, .skipsPackageDescendants],
                errorHandler: { _, error in enumerationError = error; return false }
            ) else { throw CocoaError(.fileReadNoSuchFile) }
            for case let url as URL in enumerator where
                try url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true {
                files.append(url)
            }
            if let enumerationError { throw enumerationError }
        }
        return files
    }

    static func capture(in output: URL, variations: Int) throws -> Snapshot {
        var files: [String: Fingerprint] = [:]
        for index in 1...variations {
            let directory = folder(in: output, index: index)
            guard FileManager.default.fileExists(atPath: directory.path) else { continue }
            for image in try images(in: directory) {
                files[image.path] = try fingerprint(of: image)
            }
        }
        return Snapshot(files: files)
    }

    static func validate(in output: URL, variations: Int, after snapshot: Snapshot) throws -> Summary {
        var expectedSlides: Int?
        for index in 1...variations {
            let directory = folder(in: output, index: index)
            guard FileManager.default.fileExists(atPath: directory.path) else {
                throw ValidationError.missingVariation(index)
            }
            let slides = try images(in: directory)
            guard !slides.isEmpty else { throw ValidationError.emptyVariation(index) }
            if let expectedSlides, slides.count != expectedSlides {
                throw ValidationError.inconsistentSlides(index, expectedSlides, slides.count)
            }
            expectedSlides = slides.count
            for slide in slides {
                let current = try fingerprint(of: slide)
                guard snapshot.files[slide.path] != current else {
                    throw ValidationError.staleFile(slide.lastPathComponent)
                }
                guard let source = CGImageSourceCreateWithURL(slide as CFURL, nil),
                      CGImageSourceGetCount(source) > 0,
                      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
                      image.width > 0, image.height > 0 else {
                    throw ValidationError.invalidImage(slide.lastPathComponent)
                }
            }
        }
        return Summary(variations: variations, slidesPerVariation: expectedSlides ?? 0)
    }

    private static func number(_ index: Int) -> String { String(format: "%02d", index) }

    /// Next variation number after the highest `variacao-NN` already in `output`, so a new run
    /// lands next to the previous ones instead of replacing them.
    static func nextFreeIndex(in output: URL) -> Int {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: output.path)) ?? []
        let used = names.compactMap { name -> Int? in
            guard name.hasPrefix("variacao-") else { return nil }
            return Int(name.dropFirst("variacao-".count))
        }
        return (used.max() ?? 0) + 1
    }

    private static func folder(in output: URL, index: Int) -> URL {
        output.appendingPathComponent("variacao-\(number(index))", isDirectory: true)
    }

    private static func images(in directory: URL) throws -> [URL] {
        var enumerationError: Error?
        guard let enumerator = FileManager.default.enumerator(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles, .skipsPackageDescendants],
            errorHandler: { _, error in enumerationError = error; return false }
        ) else { throw CocoaError(.fileReadNoSuchFile) }
        var result: [URL] = []
        for case let url as URL in enumerator {
            guard imageExtensions.contains(url.pathExtension.lowercased()),
                  try url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else { continue }
            result.append(url)
        }
        if let enumerationError { throw enumerationError }
        return result.sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
    }

    private static func fingerprint(of file: URL) throws -> Fingerprint {
        let values = try file.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        return Fingerprint(bytes: Int64(values.fileSize ?? 0), modified: values.contentModificationDate)
    }
}
