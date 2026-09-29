import Foundation

struct PhotoAssignment {
    let file: URL?
    let warning: String?
}

struct PhotoCatalog {
    let directory: URL
    let files: [URL]

    init(directory: URL) throws {
        let supported = Set(["jpg", "jpeg", "png", "webp", "gif", "avif"])
        let contents = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        )
        self.directory = directory
        self.files = contents.filter { url in
            supported.contains(url.pathExtension.lowercased()) &&
            ((try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true)
        }.sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
    }

    // Mirrors the web flow: _foto can be a 1-based index or exact filename.
    // A plain foto column is also accepted for the existing sample CSV.
    func assignment(headers: [String], row: [String], index: Int) -> PhotoAssignment {
        guard !files.isEmpty else {
            return PhotoAssignment(file: nil, warning: "Nenhuma foto na pasta")
        }
        let values = Dictionary(uniqueKeysWithValues: zip(headers, row))
        let choice = [values["_foto"], values["foto"]]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }

        guard let choice else {
            return PhotoAssignment(file: files[index % files.count], warning: nil)
        }
        if let number = Int(choice), number > 0, number <= files.count {
            return PhotoAssignment(file: files[number - 1], warning: nil)
        }
        if let match = files.first(where: { $0.lastPathComponent == choice }) {
            return PhotoAssignment(file: match, warning: nil)
        }
        return PhotoAssignment(file: nil, warning: "Foto não encontrada: \(choice)")
    }
}
