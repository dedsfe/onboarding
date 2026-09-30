import AppKit
import CarouselEngine
import SwiftUI

struct DesignPreferences: Equatable {
    static let titleFontKey = "designTitleFont"
    static let bodyFontKey = "designBodyFont"
    static let titleWeightKey = "designTitleWeight"
    static let titleSizeKey = "designTitleSize"
    static let textColorKey = "designTextColor"
    static let borderKey = "designBorders"
    static let backgroundKey = "designBackgrounds"
    /// "agent" lets the AI decide everything from the references; "custom" applies the choices below.
    static let modeKey = "designMode"
    static let alignKey = "designAlign"
    static let strokeWidthKey = "designStrokeWidth"
    static let strokeColorKey = "designStrokeColor"
    static let positionKey = "designPosition"
    static let caseKey = "designCase"
    static let highlightKey = "designHighlight"

    var titleFont = ""
    var bodyFont = ""
    /// "auto" or a numeric weight 300…900.
    var titleWeight = "auto"
    /// "auto" or a size in points on a 1080px-wide slide.
    var titleSize = "auto"
    /// "auto" or a hex color like #FFFFFF.
    var textColor = "auto"
    /// "auto" or a border width in px (0 = none).
    var borders = "auto"
    var backgrounds = "auto"
    /// "auto", "leading", "center" or "trailing".
    var align = "auto"
    /// Text outline: "auto" or a width in px on a 1080px slide (0 = none), plus its color.
    var strokeWidth = "auto"
    var strokeColor = "auto"
    /// "auto", "top", "middle" or "bottom" of the slide.
    var position = "auto"
    /// "auto", "upper" or "normal".
    var textCase = "auto"
    /// "auto" or a hex color for 1–2 key words.
    var highlight = "auto"

    static var current: Self {
        let defaults = UserDefaults.standard
        // Choices stay stored while the AI is in charge, so switching back restores them.
        guard defaults.string(forKey: modeKey) == "custom" else { return Self() }
        // Only what the editor shows reaches the AI; body font, borders and backgrounds
        // were left over from an older screen and stay on auto.
        return Self(
            titleFont: defaults.string(forKey: titleFontKey) ?? "",
            titleWeight: defaults.string(forKey: titleWeightKey) ?? "auto",
            titleSize: defaults.string(forKey: titleSizeKey) ?? "auto",
            textColor: defaults.string(forKey: textColorKey) ?? "auto",
            align: defaults.string(forKey: alignKey) ?? "auto",
            strokeWidth: defaults.string(forKey: strokeWidthKey) ?? "auto",
            strokeColor: defaults.string(forKey: strokeColorKey) ?? "auto",
            position: defaults.string(forKey: positionKey) ?? "auto",
            textCase: defaults.string(forKey: caseKey) ?? "auto",
            highlight: defaults.string(forKey: highlightKey) ?? "auto"
        )
    }

    /// What carousel-render receives through --estilo. Every "auto" stays nil so the renderer decides;
    /// in "Com a IA" mode `current` is all auto, so the file is just `{}`.
    var slideStyle: SlideStyle {
        func chosen(_ value: String) -> String? {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty || trimmed == "auto" ? nil : trimmed
        }
        return SlideStyle(
            font: chosen(titleFont),
            weight: Int(titleWeight),
            size: Int(titleSize).map { CGFloat($0) },
            color: chosen(textColor),
            strokeWidth: Int(strokeWidth).map { CGFloat($0) },
            strokeColor: chosen(strokeColor),
            highlightColor: chosen(highlight),
            position: TextPosition(rawValue: position),
            align: TextAlign(rawValue: align),
            textCase: TextCase(rawValue: textCase)
        )
    }
}

extension DesignPreferences {
    /// The editor's view of a renderer style: every nil field reads as "auto".
    init(style: SlideStyle) {
        self.init(titleFont: style.font ?? "", titleWeight: style.weight.map(String.init) ?? "auto",
                  titleSize: style.size.map { String(Int($0)) } ?? "auto", textColor: style.color ?? "auto",
                  align: style.align?.rawValue ?? "auto", strokeWidth: style.strokeWidth.map { String(Int($0)) } ?? "auto",
                  strokeColor: style.strokeColor ?? "auto", position: style.position?.rawValue ?? "auto",
                  textCase: style.textCase?.rawValue ?? "auto", highlight: style.highlightColor ?? "auto")
    }
}

/// A full-width slider in the inspector style: label left, value right, the fill is the track.
struct SliderRow: View {
    let title: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double
    let label: String

    var body: some View {
        GeometryReader { geometry in
            let fraction = (value - range.lowerBound) / (range.upperBound - range.lowerBound)
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 12).fill(.clear)
                    .glassEffect(.regular, in: .rect(cornerRadius: 12))
                RoundedRectangle(cornerRadius: 12).fill(Color.primary.opacity(0.1))
                    .frame(width: max(geometry.size.width * fraction, 0))
                Rectangle().fill(Color.primary.opacity(0.8))
                    .frame(width: 2, height: 22)
                    .offset(x: min(max(geometry.size.width * fraction - 1, 12), geometry.size.width - 14))
                HStack {
                    Text(title).font(.system(size: 14, weight: .medium))
                    Spacer()
                    Text(label).font(.system(size: 14)).monospacedDigit().foregroundStyle(.secondary)
                }
                .padding(.horizontal, 16)
                .allowsHitTesting(false)
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { drag in
                let raw = range.lowerBound + (range.upperBound - range.lowerBound) * min(max(drag.location.x / geometry.size.width, 0), 1)
                value = (raw / step).rounded() * step
            })
        }
        .frame(height: 46)
    }
}

extension Color {
    init(hex: String) {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let number = UInt64(digits, radix: 16) ?? 0
        self.init(red: Double((number >> 16) & 0xFF) / 255,
                  green: Double((number >> 8) & 0xFF) / 255,
                  blue: Double(number & 0xFF) / 255)
    }
}
