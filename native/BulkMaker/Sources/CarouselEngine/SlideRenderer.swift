import AppKit
import CoreText
import ImageIO
import UniformTypeIdentifiers
import Vision

/// What the renderer decided for one slide, so the AI (and the app) can review without opening the image.
public struct RenderReport: Codable, Sendable {
    public var file: String
    public var fontSize: CGFloat
    public var lines: Int
    /// Average luminance (0…1) of the photo under the text.
    public var backgroundLuminance: Double
    /// Where the text ended up: "top", "middle" or "bottom".
    public var position: String
    public var notes: [String]
}

public enum RenderError: LocalizedError {
    case photoUnreadable(String)
    case contextUnavailable
    case writeFailed(String)
    case emptyText(Int)

    public var errorDescription: String? {
        switch self {
        case .photoUnreadable(let path): return "Não consegui abrir a foto \(path)."
        case .contextUnavailable: return "Não consegui criar a imagem do slide."
        case .writeFailed(let path): return "Não consegui salvar \(path)."
        case .emptyText(let index): return "O slide \(index) está sem texto."
        }
    }
}

/// Native slide renderer: photo cover-fill plus a title set with Core Text.
/// It owns the "smart" parts — fitting, balanced lines, safe zones and contrast — so every
/// batch looks the same no matter which AI wrote the plan. No browser, no Python.
public enum SlideRenderer {
    public static let defaultFontSize: CGFloat = 76
    public static let minimumFontSize: CGFloat = 44

    public static func renderPlan(_ plan: CarouselPlan, to directory: URL) throws -> [RenderReport] {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return try plan.slides.enumerated().map { index, slide in
            let file = directory.appendingPathComponent(String(format: "slide-%02d.jpg", index + 1))
            let (image, report) = try render(slide, style: plan.style, format: plan.format, index: index + 1)
            try writeJPEG(image, to: file)
            var named = report
            named.file = file.path
            return named
        }
    }

    public static func render(_ slide: SlidePlan, style: SlideStyle, format: SlideFormat,
                              index: Int = 1) throws -> (CGImage, RenderReport) {
        let text = (style.textCase == .upper ? slide.text.uppercased() : slide.text)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw RenderError.emptyText(index) }

        let size = format.size
        let width = Int(size.width), height = Int(size.height)
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw RenderError.contextUnavailable
        }
        context.interpolationQuality = .high
        var notes: [String] = []

        // 1. Photo, cover-filled.
        context.setFillColor(CGColor(srgbRed: 0.08, green: 0.07, blue: 0.06, alpha: 1))
        context.fill(CGRect(origin: .zero, size: size))
        let photo = try loadPhoto(slide.photo, longestSide: max(size.width, size.height) * 1.25)
        let scale = max(size.width / CGFloat(photo.width), size.height / CGFloat(photo.height))
        let drawn = CGSize(width: CGFloat(photo.width) * scale, height: CGFloat(photo.height) * scale)
        context.draw(photo, in: CGRect(x: (size.width - drawn.width) / 2, y: (size.height - drawn.height) / 2,
                                       width: drawn.width, height: drawn.height))

        // 2. Fit the words inside the safe zone.
        let insets = format.safeInsets
        let safe = CGRect(x: insets.left, y: insets.bottom,
                          width: size.width - insets.left - insets.right,
                          height: size.height - insets.top - insets.bottom)
        let preferredSize = style.size ?? defaultFontSize
        let maxHeight = safe.height * 0.62
        let fitted = fit(text: text, style: style, highlights: slide.highlight, boxWidth: safe.width,
                         maxHeight: maxHeight, preferredSize: preferredSize)
        if fitted.fontSize < preferredSize {
            notes.append("fonte reduzida de \(Int(preferredSize)) para \(Int(fitted.fontSize)) px pra caber sem cortar palavras")
        }

        // 3. Place it: top / middle / bottom of the safe zone, horizontally inside the box.
        //    With no position chosen, put the words where the photo is quietest (least salient).
        let alignment = style.align ?? .center
        let x: CGFloat
        switch alignment {
        case .leading: x = safe.minX
        case .trailing: x = safe.maxX - fitted.width
        case .center: x = safe.midX - fitted.width / 2
        }
        func rect(for position: TextPosition) -> CGRect {
            let y: CGFloat
            switch position {
            case .top: y = safe.maxY - fitted.height
            case .bottom: y = safe.minY
            // Optical middle sits a little above the true middle.
            case .middle: y = safe.midY - fitted.height / 2 + safe.height * 0.06
            }
            return CGRect(x: x, y: y, width: fitted.width, height: fitted.height).integral
        }
        let chosen: TextPosition
        if let fixed = slide.position ?? style.position {
            chosen = fixed
        } else if let heat = context.makeImage().flatMap({ SaliencyMap(image: $0) }) {
            // Small bias toward the top: it reads first and never fights the caption.
            let scores: [(TextPosition, Double)] = [(.top, 0.0), (.middle, 0.04), (.bottom, 0.08)].map { position, bias in
                (position, heat.mean(in: rect(for: position), canvas: size) + bias)
            }
            chosen = scores.min { $0.1 < $1.1 }!.0
            notes.append("posição automática: \(chosen.rawValue), onde a foto tem menos coisa importante")
        } else {
            chosen = .middle
        }
        let textRect = rect(for: chosen)

        // 4. Contrast: look at the pixels under the words before drawing them.
        let luminance = averageLuminance(of: context, in: textRect.insetBy(dx: -30, dy: -30))
        let fill = style.color.flatMap(cgColor(hex:)) ?? CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)
        let fillIsLight = relativeLuminance(fill) > 0.5
        let hasStroke = (style.strokeWidth ?? 0) > 0
        if !hasStroke {
            if fillIsLight && luminance > 0.5 {
                drawScrim(in: context, around: textRect, color: CGColor(gray: 0, alpha: 0.42))
                notes.append("foto clara atrás do texto: escureci suavemente a área pra dar leitura")
            } else if !fillIsLight && luminance < 0.45 {
                drawScrim(in: context, around: textRect, color: CGColor(gray: 1, alpha: 0.55))
                notes.append("texto escuro em foto escura: clareei suavemente a área pra dar leitura")
            }
        }

        // 5. Draw: outline pass first, then the fill on top, so the stroke grows outward only.
        context.saveGState()
        if fillIsLight {
            context.setShadow(offset: CGSize(width: 0, height: -4), blur: 22, color: CGColor(gray: 0, alpha: 0.5))
        }
        if let strokeWidth = style.strokeWidth, strokeWidth > 0 {
            let strokeColor = style.strokeColor.flatMap(cgColor(hex:)) ?? (fillIsLight ? CGColor(gray: 0, alpha: 1)
                                                                                         : CGColor(gray: 1, alpha: 1))
            context.setLineJoin(.round)
            let outline = attributed(text, style: style, highlights: [], fontSize: fitted.fontSize,
                                     stroke: (strokeWidth, strokeColor))
            draw(outline, in: context, rect: textRect)
            context.setShadow(offset: .zero, blur: 0, color: nil)
        }
        let body = attributed(text, style: style, highlights: slide.highlight, fontSize: fitted.fontSize, stroke: nil)
        draw(body, in: context, rect: textRect)
        context.restoreGState()

        guard let image = context.makeImage() else { throw RenderError.contextUnavailable }
        return (image, RenderReport(file: "", fontSize: fitted.fontSize, lines: fitted.lines,
                                    backgroundLuminance: (luminance * 100).rounded() / 100,
                                    position: chosen.rawValue, notes: notes))
    }

    public static func writeJPEG(_ image: CGImage, to url: URL, quality: Double = 0.92) throws {
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw RenderError.writeFailed(url.path)
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw RenderError.writeFailed(url.path) }
    }

    // MARK: - Fitting

    private struct Fit {
        var fontSize: CGFloat
        var width: CGFloat
        var height: CGFloat
        var lines: Int
    }

    /// Largest size (down to the minimum) whose lines fit the box without splitting a word,
    /// then the narrowest width that keeps the same line count, for balanced lines.
    private static func fit(text: String, style: SlideStyle, highlights: [String], boxWidth: CGFloat,
                            maxHeight: CGFloat, preferredSize: CGFloat) -> Fit {
        var fontSize = preferredSize
        var measured = measure(text, style: style, fontSize: fontSize, width: boxWidth)
        while fontSize > minimumFontSize {
            let font = resolveFont(style, size: fontSize)
            let widestWord = text.split(whereSeparator: \.isWhitespace)
                .map { (String($0) as NSString).size(withAttributes: [.font: font]).width }
                .max() ?? 0
            if measured.height <= maxHeight && widestWord <= boxWidth { break }
            fontSize -= 2
            measured = measure(text, style: style, fontSize: fontSize, width: boxWidth)
        }
        // Balance: shrink the box while the line count holds, so lines come out even.
        var low = boxWidth * 0.72, high = boxWidth
        for _ in 0..<10 {
            let mid = (low + high) / 2
            let candidate = measure(text, style: style, fontSize: fontSize, width: mid)
            if candidate.lines <= measured.lines && candidate.height <= measured.height + 1 {
                high = mid
            } else {
                low = mid
            }
        }
        let balanced = measure(text, style: style, fontSize: fontSize, width: high)
        return Fit(fontSize: fontSize, width: ceil(high) + 2, height: ceil(balanced.height) + 2, lines: balanced.lines)
    }

    private static func measure(_ text: String, style: SlideStyle, fontSize: CGFloat,
                                width: CGFloat) -> (height: CGFloat, lines: Int) {
        let string = attributed(text, style: style, highlights: [], fontSize: fontSize, stroke: nil)
        let setter = CTFramesetterCreateWithAttributedString(string)
        let size = CTFramesetterSuggestFrameSizeWithConstraints(setter, CFRange(), nil,
                                                                CGSize(width: width, height: .greatestFiniteMagnitude), nil)
        let path = CGPath(rect: CGRect(x: 0, y: 0, width: width, height: size.height + 4), transform: nil)
        let frame = CTFramesetterCreateFrame(setter, CFRange(), path, nil)
        let lines = (CTFrameGetLines(frame) as? [CTLine])?.count ?? 1
        return (size.height, lines)
    }

    // MARK: - Text

    private static func attributed(_ text: String, style: SlideStyle, highlights: [String], fontSize: CGFloat,
                                   stroke: (width: CGFloat, color: CGColor)?) -> NSAttributedString {
        let font = resolveFont(style, size: fontSize)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineHeightMultiple = 0.98
        paragraph.lineBreakMode = .byWordWrapping
        switch style.align ?? .center {
        case .leading: paragraph.alignment = .left
        case .trailing: paragraph.alignment = .right
        case .center: paragraph.alignment = .center
        }
        let fill = style.color.flatMap(cgColor(hex:)) ?? CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)
        var attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .paragraphStyle: paragraph,
            .foregroundColor: NSColor(cgColor: fill) ?? .white,
            .kern: fontSize * -0.01
        ]
        if let stroke {
            // Core Text strokes are centered on the glyph edge and sized in % of the font size;
            // doubling keeps the visible outline at the requested pixel width.
            attributes[.strokeWidth] = stroke.width * 2 / fontSize * 100
            attributes[.strokeColor] = NSColor(cgColor: stroke.color) ?? .black
        }
        let string = NSMutableAttributedString(string: text, attributes: attributes)
        if stroke == nil {
            let highlight = NSColor(cgColor: style.highlightColor.flatMap(cgColor(hex:))
                                    ?? CGColor(srgbRed: 1, green: 0.84, blue: 0.04, alpha: 1)) ?? .systemYellow
            for word in highlights where !word.isEmpty {
                var searchRange = NSRange(location: 0, length: string.length)
                while true {
                    let found = (text as NSString).range(of: word, options: [.caseInsensitive, .diacriticInsensitive],
                                                         range: searchRange)
                    guard found.location != NSNotFound else { break }
                    string.addAttribute(.foregroundColor, value: highlight, range: found)
                    let next = found.location + found.length
                    searchRange = NSRange(location: next, length: string.length - next)
                }
            }
        }
        return string
    }

    private static func draw(_ string: NSAttributedString, in context: CGContext, rect: CGRect) {
        let setter = CTFramesetterCreateWithAttributedString(string)
        let frame = CTFramesetterCreateFrame(setter, CFRange(), CGPath(rect: rect, transform: nil), nil)
        context.textMatrix = .identity
        CTFrameDraw(frame, context)
    }

    /// Resolves "family + CSS weight" to an installed face; the system font covers "SF Pro" and misses.
    static func resolveFont(_ style: SlideStyle, size: CGFloat) -> NSFont {
        let css = style.weight ?? 700
        let systemWeight: NSFont.Weight
        switch css {
        case ..<350: systemWeight = .light
        case ..<450: systemWeight = .regular
        case ..<550: systemWeight = .medium
        case ..<650: systemWeight = .semibold
        case ..<750: systemWeight = .bold
        case ..<850: systemWeight = .heavy
        default: systemWeight = .black
        }
        if let family = style.font, !family.isEmpty, family != "SF Pro" {
            // NSFontManager weights run 0…15; 5 is regular, 9 is bold.
            let managerWeight = min(max(Int((Double(css) - 400) / 100 * 1.6 + 5), 1), 14)
            if let font = NSFontManager.shared.font(withFamily: family, traits: [], weight: managerWeight, size: size) {
                return font
            }
        }
        return NSFont.systemFont(ofSize: size, weight: systemWeight)
    }

    // MARK: - Pixels

    private static func loadPhoto(_ path: String, longestSide: CGFloat) throws -> CGImage {
        let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: Int(longestSide)
              ] as CFDictionary) else {
            throw RenderError.photoUnreadable(path)
        }
        return image
    }

    private static func averageLuminance(of context: CGContext, in rect: CGRect) -> Double {
        guard let snapshot = context.makeImage() else { return 0.5 }
        // CGImage cropping uses a top-left origin; the context draws bottom-left.
        let flipped = CGRect(x: rect.minX, y: CGFloat(snapshot.height) - rect.maxY, width: rect.width, height: rect.height)
            .intersection(CGRect(x: 0, y: 0, width: snapshot.width, height: snapshot.height))
        guard !flipped.isEmpty, let crop = snapshot.cropping(to: flipped) else { return 0.5 }
        var pixels = [UInt8](repeating: 0, count: 16 * 16 * 4)
        guard let tiny = CGContext(data: &pixels, width: 16, height: 16, bitsPerComponent: 8, bytesPerRow: 64,
                                   space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                   bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return 0.5 }
        tiny.interpolationQuality = .medium
        tiny.draw(crop, in: CGRect(x: 0, y: 0, width: 16, height: 16))
        var total = 0.0
        for i in stride(from: 0, to: pixels.count, by: 4) {
            total += (0.2126 * Double(pixels[i]) + 0.7152 * Double(pixels[i + 1]) + 0.0722 * Double(pixels[i + 2])) / 255
        }
        return total / 256
    }

    /// A soft elliptical wash behind the words: invisible as a shape, but it makes them read.
    private static func drawScrim(in context: CGContext, around rect: CGRect, color: CGColor) {
        let area = rect.insetBy(dx: -rect.width * 0.25, dy: -rect.height * 0.6)
        guard let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                                        colors: [color, color.copy(alpha: 0)!] as CFArray,
                                        locations: [0, 1]) else { return }
        context.saveGState()
        context.translateBy(x: area.midX, y: area.midY)
        context.scaleBy(x: area.width / 2, y: area.height / 2)
        context.drawRadialGradient(gradient, startCenter: .zero, startRadius: 0, endCenter: .zero, endRadius: 1,
                                   options: [])
        context.restoreGState()
    }

    static func cgColor(hex: String) -> CGColor? {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "# "))
        guard digits.count == 6, let value = UInt64(digits, radix: 16) else { return nil }
        return CGColor(srgbRed: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255,
                       blue: CGFloat(value & 0xFF) / 255, alpha: 1)
    }

    private static func relativeLuminance(_ color: CGColor) -> Double {
        guard let srgb = color.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil),
              let c = srgb.components, c.count >= 3 else { return 1 }
        return 0.2126 * Double(c[0]) + 0.7152 * Double(c[1]) + 0.0722 * Double(c[2])
    }
}

/// Vision's attention saliency: where a viewer's eye lands on the photo. Text should avoid it.
struct SaliencyMap {
    private let values: [Float]
    private let width: Int
    private let height: Int

    init?(image full: CGImage) {
        // Saliency only needs a thumbnail; the full 1080×1920 frame made it take seconds per slide.
        let small = CGSize(width: 216, height: CGFloat(full.height) / CGFloat(full.width) * 216)
        guard let context = CGContext(data: nil, width: Int(small.width), height: Int(small.height), bitsPerComponent: 8,
                                      bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.draw(full, in: CGRect(origin: .zero, size: small))
        guard let image = context.makeImage() else { return nil }
        let request = VNGenerateAttentionBasedSaliencyImageRequest()
        guard (try? VNImageRequestHandler(cgImage: image).perform([request])) != nil,
              let buffer = request.results?.first?.pixelBuffer else { return nil }
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        width = CVPixelBufferGetWidth(buffer)
        height = CVPixelBufferGetHeight(buffer)
        let rowBytes = CVPixelBufferGetBytesPerRow(buffer)
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
        var values = [Float](repeating: 0, count: width * height)
        for row in 0..<height {
            let line = base.advanced(by: row * rowBytes).assumingMemoryBound(to: Float32.self)
            for column in 0..<width { values[row * width + column] = line[column] }
        }
        self.values = values
    }

    /// Mean saliency (0…1) inside a canvas rect given in bottom-left coordinates.
    func mean(in rect: CGRect, canvas: CGSize) -> Double {
        let minX = max(Int(rect.minX / canvas.width * CGFloat(width)), 0)
        let maxX = min(Int(ceil(rect.maxX / canvas.width * CGFloat(width))), width)
        // Heat map rows run top to bottom.
        let minY = max(Int((canvas.height - rect.maxY) / canvas.height * CGFloat(height)), 0)
        let maxY = min(Int(ceil((canvas.height - rect.minY) / canvas.height * CGFloat(height))), height)
        guard maxX > minX, maxY > minY else { return 0 }
        var total: Float = 0
        for row in minY..<maxY { for column in minX..<maxX { total += values[row * width + column] } }
        return Double(total) / Double((maxX - minX) * (maxY - minY))
    }
}
