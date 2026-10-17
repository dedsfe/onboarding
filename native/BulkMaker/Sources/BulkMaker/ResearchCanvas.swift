import AppKit

/// A reference stays a real image plus editable source text, rather than a flattened screenshot.
@MainActor
enum ResearchCanvas {
    struct Slide: Sendable {
        var number: Int
        var file: URL?
        var text: String
    }

    @discardableResult
    static func add(title: String, details: String, slides: [Slide], to directory: URL) throws -> [CanvasItem] {
        let media = directory.appendingPathComponent("media", isDirectory: true)
        try FileManager.default.createDirectory(at: media, withIntermediateDirectories: true)
        var staged: [URL] = []
        do {
            let boardFile = directory.appendingPathComponent("board.json")
            let existing = FileManager.default.fileExists(atPath: boardFile.path)
                ? try JSONDecoder().decode([CanvasItem].self, from: Data(contentsOf: boardFile)) : []
            // Each publication owns a row. Existing compositions keep their positions.
            let left = existing.map(\.x).min() ?? 0
            let top = existing.map { $0.frame.maxY }.max().map { $0 + 100 } ?? 0
            let gap = 24.0
            let widths = slides.map { slide -> Double in
                guard let file = slide.file, let size = CanvasBoard.naturalSize(of: file) else { return 270 }
                return size.width * min(480 / max(size.width, size.height), 1)
            }
            let rowWidth = widths.reduce(0, +) + gap * Double(max(0, slides.count - 1))
            var added: [CanvasItem] = []
            func label(_ text: String, size: Double, weight: String = "regular", at origin: CGPoint, width: Double) -> CanvasItem {
                let style = TextStyle(size: size, weight: weight, color: "#FFFFFF", background: "#191817", padding: 14, radius: 6)
                let measured = CanvasText.measure(text, style: style, maxWidth: max(100, width))
                return CanvasItem(file: "", x: origin.x, y: origin.y, width: measured.width,
                                  height: measured.height + 2, text: text, style: style)
            }
            let heading = label(title, size: 30, weight: "bold", at: CGPoint(x: left, y: top), width: max(650, rowWidth))
            added.append(heading)
            let metadata = label(details, size: 18, at: CGPoint(x: left, y: heading.frame.maxY + 12),
                                 width: max(650, min(rowWidth, 1100)))
            added.append(metadata)
            let imageTop = metadata.frame.maxY + 24
            let captionTop = imageTop + 480 + 16
            var x = left
            for (index, slide) in slides.enumerated() {
                let width = widths[index]
                if let file = slide.file, let size = CanvasBoard.naturalSize(of: file) {
                    let name = UUID().uuidString + "." + file.pathExtension
                    let target = media.appendingPathComponent(name)
                    try FileManager.default.copyItem(at: file, to: target)
                    staged.append(target)
                    let scale = min(480 / max(size.width, size.height), 1)
                    added.append(CanvasItem(file: name, x: x, y: imageTop, width: width, height: size.height * scale))
                } else {
                    added.append(label("Slide \(slide.number)\nImagem não baixada", size: 18,
                                       at: CGPoint(x: x, y: imageTop), width: width))
                }
                let text = slide.text.isEmpty ? "Texto não reconhecido automaticamente. Confira a imagem original." : slide.text
                added.append(label("Slide \(slide.number)\n\(text)", size: 16, at: CGPoint(x: x, y: captionTop), width: width))
                x += width + gap
            }
            // No suspension between reading the board and committing this whole publication.
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(existing + added).write(to: boardFile, options: .atomic)
            return added
        } catch {
            for file in staged { try? FileManager.default.removeItem(at: file) }
            throw error
        }
    }
}
