import CoreGraphics
import CoreText

/// Turns a wallpaper into colored ASCII art: each cell becomes a character as dense as the cell is bright,
/// painted with the cell's own color on black. Rendered once per wallpaper, off the main thread.
enum AsciiArt {
    /// From empty to full; brighter cells get denser characters.
    private static let ramp = Array(" .:-=+*#%@")
    private static let columns = 180
    /// Menlo's advance is 0.6 of its size, so a size of cell / 0.6 fills the cell edge to edge.
    private static let advanceRatio: CGFloat = 0.6

    static func render(_ source: CGImage) -> CGImage? {
        let cellWidth = CGFloat(source.width) / CGFloat(columns)
        let fontSize = cellWidth / advanceRatio
        let cellHeight = fontSize
        let rows = max(1, Int(CGFloat(source.height) / cellHeight))
        guard let colors = averageColors(of: source, columns: columns, rows: rows) else { return nil }

        let width = Int((cellWidth * CGFloat(columns)).rounded())
        let height = Int((cellHeight * CGFloat(rows)).rounded())
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))

        let font = CTFontCreateWithName("Menlo-Bold" as CFString, fontSize, nil)
        var glyphs = [CGGlyph](repeating: 0, count: ramp.count)
        let characters = ramp.map { UniChar($0.unicodeScalars.first!.value) }
        CTFontGetGlyphsForCharacters(font, characters, &glyphs, ramp.count)
        context.setFont(CTFontCopyGraphicsFont(font, nil))
        context.setFontSize(fontSize)
        // Centers each glyph vertically in its cell.
        let baseline = (cellHeight - CTFontGetAscent(font) - CTFontGetDescent(font)) / 2 + CTFontGetDescent(font)

        for row in 0..<rows {
            // Bitmap rows run top-down; Core Graphics draws bottom-up.
            let y = CGFloat(height) - CGFloat(row + 1) * cellHeight + baseline
            for column in 0..<columns {
                let offset = (row * columns + column) * 4
                let red = CGFloat(colors[offset]) / 255
                let green = CGFloat(colors[offset + 1]) / 255
                let blue = CGFloat(colors[offset + 2]) / 255
                let luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
                let index = min(ramp.count - 1, Int(luminance * CGFloat(ramp.count)))
                guard index > 0 else { continue }
                context.setFillColor(CGColor(red: red, green: green, blue: blue, alpha: 1))
                context.showGlyphs([glyphs[index]], at: [CGPoint(x: CGFloat(column) * cellWidth, y: y)])
            }
        }
        return context.makeImage()
    }

    /// Scales the image down to one pixel per cell, which averages each cell's color.
    private static func averageColors(of image: CGImage, columns: Int, rows: Int) -> [UInt8]? {
        var pixels = [UInt8](repeating: 0, count: columns * rows * 4)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: columns, height: rows, bitsPerComponent: 8,
                                          bytesPerRow: columns * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
            context.interpolationQuality = .high
            context.draw(image, in: CGRect(x: 0, y: 0, width: columns, height: rows))
            return true
        }
        return drawn ? pixels : nil
    }
}
