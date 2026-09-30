import AppKit
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Small grids that let the AI see many images in one read. Every image the AI opens is re-sent on each
/// later turn, so one sheet of 21 photos costs about as much as a single photo.
public enum ContactSheet {
    public static let imageExtensions: Set<String> = ["jpg", "jpeg", "png", "heic", "webp"]

    /// Image files directly inside `folder` (subfolders like `_descartadas` are skipped), in Finder order.
    public static func photos(in folder: URL) throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.isRegularFileKey],
                                                     options: [.skipsHiddenFiles])
            .filter { imageExtensions.contains($0.pathExtension.lowercased()) }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
    }

    /// Writes `folha-01.jpg`, `folha-02.jpg`… with every photo labeled by file name.
    /// 7×3 tiles of 160×284 (9:16, like the slides) keep each sheet under ~1 MP.
    public static func photoSheets(folder: URL, to directory: URL, columns: Int = 7, rows: Int = 3) throws -> [(URL, [String])] {
        let files = try photos(in: folder)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let perSheet = columns * rows
        return try stride(from: 0, to: files.count, by: perSheet).enumerated().map { number, start in
            let page = Array(files[start..<min(start + perSheet, files.count)])
            let url = directory.appendingPathComponent(String(format: "folha-%02d.jpg", number + 1))
            let labels = page.map { $0.deletingPathExtension().lastPathComponent }
            try drawGrid(images: page, labels: labels, tile: CGSize(width: 160, height: 284),
                         columns: min(columns, page.count), to: url)
            return (url, page.map(\.lastPathComponent))
        }
    }

    /// One image with every slide of a variation side by side, for a single-read review.
    public static func reviewSheet(slides: [URL], to file: URL, columns: Int = 5) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try drawGrid(images: slides, labels: slides.indices.map { "\($0 + 1)" },
                     tile: CGSize(width: 270, height: 480), columns: min(columns, max(slides.count, 1)), to: file)
    }

    private static func drawGrid(images: [URL], labels: [String], tile: CGSize, columns: Int, to url: URL) throws {
        let gap: CGFloat = 4
        let rows = Int((Double(images.count) / Double(columns)).rounded(.up))
        let width = Int(CGFloat(columns) * tile.width + CGFloat(columns - 1) * gap)
        let height = Int(CGFloat(rows) * tile.height + CGFloat(rows - 1) * gap)
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw RenderError.contextUnavailable
        }
        context.setFillColor(CGColor(gray: 0.1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.interpolationQuality = .medium

        for (index, file) in images.enumerated() {
            let column = index % columns, row = index / columns
            // Bottom-left origin: row 0 sits at the top.
            let frame = CGRect(x: CGFloat(column) * (tile.width + gap),
                               y: CGFloat(height) - CGFloat(row + 1) * tile.height - CGFloat(row) * gap,
                               width: tile.width, height: tile.height)
            if let image = thumbnail(file, longestSide: max(tile.width, tile.height) * 2) {
                let scale = max(frame.width / CGFloat(image.width), frame.height / CGFloat(image.height))
                let drawn = CGSize(width: CGFloat(image.width) * scale, height: CGFloat(image.height) * scale)
                context.saveGState()
                context.clip(to: frame)
                context.draw(image, in: CGRect(x: frame.midX - drawn.width / 2, y: frame.midY - drawn.height / 2,
                                               width: drawn.width, height: drawn.height))
                context.restoreGState()
            }
            drawLabel(labels[index], in: context, frame: frame)
        }
        guard let image = context.makeImage() else { throw RenderError.contextUnavailable }
        try SlideRenderer.writeJPEG(image, to: url, quality: 0.8)
    }

    private static func drawLabel(_ text: String, in context: CGContext, frame: CGRect) {
        let font = NSFont.systemFont(ofSize: 17, weight: .bold)
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [
            .font: font, .foregroundColor: NSColor.white
        ]))
        let bounds = CTLineGetBoundsWithOptions(line, [])
        let strip = CGRect(x: frame.minX, y: frame.minY, width: min(bounds.width + 14, frame.width), height: 26)
        context.setFillColor(CGColor(gray: 0, alpha: 0.72))
        context.fill(strip)
        context.textMatrix = .identity
        context.textPosition = CGPoint(x: strip.minX + 7, y: strip.minY + 7)
        CTLineDraw(line, context)
    }

    private static func thumbnail(_ url: URL, longestSide: CGFloat) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        return CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: Int(longestSide)
        ] as CFDictionary)
    }
}
