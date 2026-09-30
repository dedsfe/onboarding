import Foundation

/// What the AI decides for a batch: which photo and words go on each slide.
/// Everything visual that can be computed (fit, contrast, safe zones) is left to the renderer.
public struct CarouselPlan: Codable, Sendable {
    public var format: SlideFormat
    public var style: SlideStyle
    public var slides: [SlidePlan]

    public init(format: SlideFormat = .tiktok, style: SlideStyle = SlideStyle(), slides: [SlidePlan]) {
        self.format = format
        self.style = style
        self.slides = slides
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        format = try container.decodeIfPresent(SlideFormat.self, forKey: .format) ?? .tiktok
        style = try container.decodeIfPresent(SlideStyle.self, forKey: .style) ?? SlideStyle()
        slides = try container.decode([SlidePlan].self, forKey: .slides)
    }
}

public struct SlidePlan: Codable, Sendable {
    /// Absolute path to the background photo.
    public var photo: String
    public var text: String
    /// Words (or short phrases) painted in the highlight color.
    public var highlight: [String]
    /// Per-slide override of the style's position.
    public var position: TextPosition?
    /// Per-slide style: each field it sets wins over the plan's style, the rest comes from the plan.
    public var style: SlideStyle?

    public init(photo: String, text: String, highlight: [String] = [], position: TextPosition? = nil,
                style: SlideStyle? = nil) {
        self.photo = photo
        self.text = text
        self.highlight = highlight
        self.position = position
        self.style = style
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        photo = try container.decode(String.self, forKey: .photo)
        text = try container.decode(String.self, forKey: .text)
        highlight = try container.decodeIfPresent([String].self, forKey: .highlight) ?? []
        position = try container.decodeIfPresent(TextPosition.self, forKey: .position)
        style = try container.decodeIfPresent(SlideStyle.self, forKey: .style)
    }
}

public enum SlideFormat: String, Codable, Sendable {
    /// 1080×1920, full-screen TikTok / Reels / Stories.
    case tiktok
    /// 1080×1350, Instagram feed portrait.
    case feed

    public var size: CGSize {
        switch self {
        case .tiktok: return CGSize(width: 1080, height: 1920)
        case .feed: return CGSize(width: 1080, height: 1350)
        }
    }

    /// Areas the platform covers with its own UI, in pixels.
    public var safeInsets: (top: CGFloat, left: CGFloat, bottom: CGFloat, right: CGFloat) {
        switch self {
        // Status bar + tabs on top, caption + nav at the bottom, action rail on the right.
        case .tiktok: return (300, 90, 560, 170)
        case .feed: return (110, 90, 130, 90)
        }
    }
}

public enum TextPosition: String, Codable, Sendable {
    case top, middle, bottom
}

public enum TextAlign: String, Codable, Sendable {
    case leading, center, trailing
}

public enum TextCase: String, Codable, Sendable {
    case normal, upper
}

/// Visual direction for every slide in the batch. Nil means "renderer decides".
public struct SlideStyle: Codable, Sendable, Equatable {
    public var font: String?
    public var weight: Int?
    /// Preferred title size in px; the renderer shrinks it when the text would not fit.
    public var size: CGFloat?
    public var color: String?
    public var strokeWidth: CGFloat?
    public var strokeColor: String?
    public var highlightColor: String?
    public var position: TextPosition?
    public var align: TextAlign?
    public var textCase: TextCase?

    public init(font: String? = nil, weight: Int? = nil, size: CGFloat? = nil, color: String? = nil,
                strokeWidth: CGFloat? = nil, strokeColor: String? = nil, highlightColor: String? = nil,
                position: TextPosition? = nil, align: TextAlign? = nil, textCase: TextCase? = nil) {
        self.font = font
        self.weight = weight
        self.size = size
        self.color = color
        self.strokeWidth = strokeWidth
        self.strokeColor = strokeColor
        self.highlightColor = highlightColor
        self.position = position
        self.align = align
        self.textCase = textCase
    }

    /// This style with every field `override` sets replaced by it: the plan's style under a slide's style.
    public func overridden(by override: SlideStyle?) -> SlideStyle {
        guard let override else { return self }
        return SlideStyle(font: override.font ?? font, weight: override.weight ?? weight, size: override.size ?? size,
                          color: override.color ?? color, strokeWidth: override.strokeWidth ?? strokeWidth,
                          strokeColor: override.strokeColor ?? strokeColor,
                          highlightColor: override.highlightColor ?? highlightColor,
                          position: override.position ?? position, align: override.align ?? align,
                          textCase: override.textCase ?? textCase)
    }

    public enum Field: CaseIterable, Sendable {
        case font, weight, size, color, strokeWidth, strokeColor, highlightColor, position, align, textCase
    }

    /// Fields whose value differs between the two styles.
    public func changedFields(from other: SlideStyle) -> [Field] {
        Field.allCases.filter { field in
            switch field {
            case .font: return font != other.font
            case .weight: return weight != other.weight
            case .size: return size != other.size
            case .color: return color != other.color
            case .strokeWidth: return strokeWidth != other.strokeWidth
            case .strokeColor: return strokeColor != other.strokeColor
            case .highlightColor: return highlightColor != other.highlightColor
            case .position: return position != other.position
            case .align: return align != other.align
            case .textCase: return textCase != other.textCase
            }
        }
    }

    public mutating func clear(_ field: Field) {
        switch field {
        case .font: font = nil
        case .weight: weight = nil
        case .size: size = nil
        case .color: color = nil
        case .strokeWidth: strokeWidth = nil
        case .strokeColor: strokeColor = nil
        case .highlightColor: highlightColor = nil
        case .position: position = nil
        case .align: align = nil
        case .textCase: textCase = nil
        }
    }

    public var isEmpty: Bool { self == SlideStyle() }
}

extension CarouselPlan {
    /// Sets the post's style so it reaches every slide: fields that changed are dropped from the slides'
    /// own styles (and a changed position from their `position`), otherwise those slides would keep them.
    public mutating func setPostStyle(_ style: SlideStyle) {
        let changed = style.changedFields(from: self.style)
        self.style = style
        for index in slides.indices {
            if changed.contains(.position) { slides[index].position = nil }
            guard var own = slides[index].style else { continue }
            changed.forEach { own.clear($0) }
            slides[index].style = own.isEmpty ? nil : own
        }
    }

    /// Sets one slide's own style; an empty one is removed so the slide follows the post again.
    public mutating func setSlideStyle(_ style: SlideStyle, at index: Int) {
        guard slides.indices.contains(index) else { return }
        // The editor's position lives in the style; the legacy per-slide field would win over it.
        if style.position != slides[index].style?.position { slides[index].position = nil }
        slides[index].style = style.isEmpty ? nil : style
    }
}
