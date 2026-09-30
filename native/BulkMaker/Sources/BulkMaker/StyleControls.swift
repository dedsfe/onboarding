import AppKit
import SwiftUI

/// Every text control of the visual direction (font, color, outline, size, weight, position, case,
/// highlight, alignment) on a `DesignPreferences`. Shared by the batch's design editor and the
/// calendar's slide editor, so both look and behave the same.
struct StyleControls: View {
    @Binding var prefs: DesignPreferences
    /// What the "Auto" choice means where the controls are used.
    var autoHelp = "Auto: a IA escolhe"

    static let featuredFonts = ["SF Pro", "New York", "Helvetica Neue", "Avenir Next", "Futura",
                                "Didot", "Georgia", "Baskerville", "Gill Sans", "American Typewriter"]
        .filter { NSFontManager.shared.availableFontFamilies.contains($0) || $0 == "SF Pro" }
    static let allFonts = NSFontManager.shared.availableFontFamilies
        .filter { !$0.hasPrefix(".") }
        .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    static let colors = ["#FFFFFF", "#F5E6C8", "#FFD60A", "#FF9F0A", "#FF6B6B",
                         "#FF8AD8", "#BF5AF2", "#4DA3FF", "#34C759", "#111111"]

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            fontSection
            Self.section("Cor") { colorGrid(selection: $prefs.textColor) }
            Self.section("Contorno") {
                SliderRow(title: "Grossura", value: numeric($prefs.strokeWidth, fallback: 0), range: 0...12, step: 1,
                          label: Int(prefs.strokeWidth).map { $0 == 0 ? "Sem contorno" : "\($0) px" } ?? "Auto")
                colorGrid(selection: $prefs.strokeColor)
                    .opacity(Int(prefs.strokeWidth) ?? 0 > 0 ? 1 : 0.4)
            }
            Self.section("Título") {
                VStack(spacing: 8) {
                    SliderRow(title: "Tamanho", value: numeric($prefs.titleSize, fallback: 88), range: 48...140, step: 2,
                              label: Int(prefs.titleSize).map { "\($0) px" } ?? "Auto")
                    SliderRow(title: "Peso", value: numeric($prefs.titleWeight, fallback: 700), range: 300...900, step: 100,
                              label: Int(prefs.titleWeight).map(String.init) ?? "Auto")
                }
            }
            Self.section("Posição") { positionTool }
            Self.section("Caixa") {
                HStack(spacing: 6) {
                    optionButton("Auto", systemImage: "sparkles", isOn: prefs.textCase == "auto") { prefs.textCase = "auto" }
                    optionButton("Aa", isOn: prefs.textCase == "normal") { prefs.textCase = "normal" }
                    optionButton("AA", isOn: prefs.textCase == "upper") { prefs.textCase = "upper" }
                }
            }
            Self.section("Destaque") { colorGrid(selection: $prefs.highlight) }
            Self.section("Alinhamento") { alignTool }
        }
    }

    static func section<Content: View>(_ title: String, value: String? = nil,
                                       @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title.uppercased())
                    .font(.system(size: 11, weight: .bold)).tracking(1.3)
                    .foregroundStyle(.white.opacity(0.55))
                Spacer()
                if let value { Text(value).font(.system(size: 12, weight: .semibold)).lineLimit(1) }
            }
            content()
        }
    }

    static func font(_ family: String, size: CGFloat) -> Font {
        // "SF Pro" is the system face; asking for it by name falls back to Helvetica.
        family.isEmpty || family == "SF Pro" ? .system(size: size) : .custom(family, size: size)
    }

    // MARK: - Font

    private var fontSection: some View {
        let selection = $prefs.titleFont
        return Self.section("Fonte", value: selection.wrappedValue.isEmpty ? "Auto" : selection.wrappedValue) {
            VStack(spacing: 2) {
                fontRow("Auto", family: "", selection: selection)
                ForEach(Self.featuredFonts, id: \.self) { fontRow($0, family: $0, selection: selection) }
            }
            Menu {
                ForEach(Self.allFonts, id: \.self) { family in
                    Button(family) { selection.wrappedValue = family }
                }
            } label: {
                Label("Todas as fontes do Mac", systemImage: "textformat")
                    .font(.system(size: 13, weight: .medium))
                    .frame(maxWidth: .infinity).frame(height: 34)
                    .background(RoundedRectangle(cornerRadius: 10).fill(.white.opacity(0.08)))
            }
            .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden)
        }
    }

    private func fontRow(_ name: String, family: String, selection: Binding<String>) -> some View {
        let isOn = selection.wrappedValue == family
        return Button { selection.wrappedValue = family } label: {
            HStack {
                Text(name).font(family.isEmpty ? .system(size: 15, weight: .medium) : Self.font(family, size: 17))
                    .lineLimit(1)
                Spacer()
                if isOn { Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)) }
            }
            .padding(.horizontal, 12).frame(height: 38)
            .background(RoundedRectangle(cornerRadius: 10).fill(isOn ? .white.opacity(0.14) : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(isOn ? .white : .white.opacity(0.8))
    }

    // MARK: - Colors

    private func colorGrid(selection: Binding<String>) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 6), spacing: 12) {
            colorDot(nil, selection: selection)
            ForEach(Self.colors, id: \.self) { colorDot($0, selection: selection) }
            customColorWell(selection: selection)
        }
    }

    /// The rainbow ring opens the system color picker for any color outside the palette.
    private func customColorWell(selection: Binding<String>) -> some View {
        let isCustomColor = selection.wrappedValue != "auto" && !Self.colors.contains(selection.wrappedValue)
        return ZStack {
            ColorPicker("Cor personalizada", selection: Binding(
                get: { selection.wrappedValue == "auto" ? .white : Color(hex: selection.wrappedValue) },
                set: { selection.wrappedValue = $0.hexString }
            ), supportsOpacity: false)
            .labelsHidden()
            .opacity(0.02) // still clickable, the ring below is what people see
            .frame(width: 36, height: 36)
            Circle()
                .strokeBorder(AngularGradient(colors: [.red, .yellow, .green, .cyan, .blue, .purple, .red],
                                              center: .center), lineWidth: 5)
                .background(Circle().fill(isCustomColor ? Color(hex: selection.wrappedValue) : .clear).padding(6))
                .frame(width: 30, height: 30)
                .padding(3)
                .overlay(Circle().strokeBorder(isCustomColor ? .white : .clear, lineWidth: 2))
                .allowsHitTesting(false)
        }
        .help("Escolher qualquer cor")
    }

    /// Glossy dots like a paint well: flat color plus a soft highlight.
    private func colorDot(_ hex: String?, selection: Binding<String>) -> some View {
        let isOn = hex == nil ? selection.wrappedValue == "auto" : selection.wrappedValue == hex
        return Button { selection.wrappedValue = hex ?? "auto" } label: {
            ZStack {
                if let hex {
                    Circle().fill(Color(hex: hex))
                    Circle().fill(RadialGradient(colors: [.white.opacity(0.55), .clear],
                                                 center: .init(x: 0.35, y: 0.3), startRadius: 0, endRadius: 14))
                } else {
                    Circle().fill(.white.opacity(0.1))
                    Text("A").font(.system(size: 13, weight: .bold))
                }
            }
            .frame(width: 30, height: 30)
            .padding(3)
            .overlay(Circle().strokeBorder(isOn ? .white : .clear, lineWidth: 2))
        }
        .buttonStyle(.plain)
        .help(hex ?? autoHelp)
    }

    // MARK: - Position and alignment

    private var positionTool: some View {
        HStack(spacing: 6) {
            optionButton("Auto", systemImage: "sparkles", isOn: prefs.position == "auto") { prefs.position = "auto" }
            optionButton("Topo", systemImage: "rectangle.tophalf.inset.filled", isOn: prefs.position == "top") { prefs.position = "top" }
            optionButton("Meio", systemImage: "rectangle.center.inset.filled", isOn: prefs.position == "middle") { prefs.position = "middle" }
            optionButton("Embaixo", systemImage: "rectangle.bottomhalf.inset.filled", isOn: prefs.position == "bottom") { prefs.position = "bottom" }
        }
    }

    private func optionButton(_ name: String, systemImage: String? = nil, isOn: Bool,
                              action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Group {
                if let systemImage {
                    Image(systemName: systemImage).font(.system(size: 14, weight: .semibold))
                } else {
                    Text(name).font(.system(size: 14, weight: .bold))
                }
            }
            .frame(maxWidth: .infinity).frame(height: 36)
            .background(RoundedRectangle(cornerRadius: 10).fill(isOn ? .white.opacity(0.22) : .white.opacity(0.08)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(name == "Auto" ? autoHelp : name)
    }

    private var alignTool: some View {
        HStack(spacing: 6) {
            alignButton("Auto", icon: "sparkles", value: "auto")
            alignButton("Esquerda", icon: "text.alignleft", value: "leading")
            alignButton("Centro", icon: "text.aligncenter", value: "center")
            alignButton("Direita", icon: "text.alignright", value: "trailing")
        }
    }

    private func alignButton(_ name: String, icon: String, value: String) -> some View {
        optionButton(name, systemImage: icon, isOn: prefs.align == value) { prefs.align = value }
    }

    private func numeric(_ binding: Binding<String>, fallback: Double) -> Binding<Double> {
        Binding(get: { Double(binding.wrappedValue) ?? fallback },
                set: { binding.wrappedValue = String(Int($0)) })
    }
}
