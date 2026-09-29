import Foundation

/// A lightweight inventory of files produced by the CLI in the chosen output folder.
struct OutputCatalog: Equatable {
    let directory: URL
    let fileCount: Int
    let imageCount: Int
    let previewImages: [URL]

    init(directory: URL) throws {
        let imageExtensions = Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "heic", "tif", "tiff"])
        var enumerationError: Error?
        guard let enumerator = FileManager.default.enumerator(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles, .skipsPackageDescendants],
            errorHandler: { _, error in enumerationError = error; return false }
        ) else { throw CocoaError(.fileReadNoSuchFile) }

        var files = 0
        var images: [URL] = []
        for case let url as URL in enumerator {
            guard try url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else { continue }
            files += 1
            if imageExtensions.contains(url.pathExtension.lowercased()) { images.append(url) }
        }
        if let enumerationError { throw enumerationError }

        self.directory = directory
        self.fileCount = files
        self.imageCount = images.count
        self.previewImages = Array(images.sorted {
            $0.path.localizedStandardCompare($1.path) == .orderedAscending
        }.prefix(4))
    }
}
