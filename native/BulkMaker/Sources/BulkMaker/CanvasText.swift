import AppKit

/// Draws a canvas text box: a rounded background (optional) with the text inside, wrapped to the box.
/// The item keeps the string; this only makes the picture its layer shows.
@MainActor
enum CanvasText {
    static func font(_ style: TextStyle, scale: CGFloat = 1) -> NSFont {
        let weight: NSFont.Weight = switch style.weight {
        case "regular": .regular
        case "semibold": .semibold
        case "bold": .bold
        case "heavy": .heavy
        default: .medium
        }
        return .systemFont(ofSize: max(style.size * scale, 1), weight: weight)
    }

    static func attributes(_ style: TextStyle, scale: CGFloat = 1) -> [NSAttributedString.Key: Any] {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        paragraph.lineHeightMultiple = 1.08
        return [.font: font(style, scale: scale), .foregroundColor: color(style.color) ?? .white, .paragraphStyle: paragraph]
    }

    /// Box size (padding included) for the text wrapped at `maxWidth`.
    static func measure(_ text: String, style: TextStyle, maxWidth: CGFloat) -> CGSize {
        let padding = style.padding ?? 0
        let content = NSAttributedString(string: text.isEmpty ? " " : text, attributes: attributes(style))
            .boundingRect(with: CGSize(width: maxWidth - padding * 2, height: .greatestFiniteMagnitude),
                          options: [.usesLineFragmentOrigin, .usesFontLeading])
        return CGSize(width: ceil(content.width + padding * 2 + 2), height: ceil(content.height + padding * 2))
    }

    /// The box drawn so its longer side is `maxPixel` pixels.
    static func render(_ text: String, style: TextStyle, size: CGSize, maxPixel: Int) -> CGImage? {
        guard size.width > 0, size.height > 0 else { return nil }
        let k = CGFloat(maxPixel) / max(size.width, size.height)
        let pixels = CGSize(width: max(1, ceil(size.width * k)), height: max(1, ceil(size.height * k)))
        guard let context = CGContext(data: nil, width: Int(pixels.width), height: Int(pixels.height), bitsPerComponent: 8,
                                      bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue) else { return nil }
        // Top-left origin in canvas units, like the board.
        context.translateBy(x: 0, y: pixels.height)
        context.scaleBy(x: k, y: -k)
        let previous = NSGraphicsContext.current
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
        defer { NSGraphicsContext.current = previous }

        let box = CGRect(origin: .zero, size: size)
        if let background = color(style.background) {
            let radius = style.radius ?? 0
            background.setFill()
            NSBezierPath(roundedRect: box, xRadius: radius, yRadius: radius).fill()
        }
        let padding = style.padding ?? 0
        NSAttributedString(string: text, attributes: attributes(style))
            .draw(with: box.insetBy(dx: padding, dy: padding),
                  options: [.usesLineFragmentOrigin, .usesFontLeading, .truncatesLastVisibleLine])
        return context.makeImage()
    }

    /// `#RRGGBB` or `#RRGGBBAA`.
    static func color(_ hex: String?) -> NSColor? {
        guard var value = hex?.trimmingCharacters(in: .whitespaces), !value.isEmpty else { return nil }
        if value.hasPrefix("#") { value.removeFirst() }
        guard value.count == 6 || value.count == 8, let number = UInt64(value, radix: 16) else { return nil }
        let rgba = value.count == 6 ? number << 8 | 0xFF : number
        return NSColor(srgbRed: CGFloat(rgba >> 24 & 0xFF) / 255, green: CGFloat(rgba >> 16 & 0xFF) / 255,
                       blue: CGFloat(rgba >> 8 & 0xFF) / 255, alpha: CGFloat(rgba & 0xFF) / 255)
    }
}
