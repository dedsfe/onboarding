import AppKit
import ImageIO
import SwiftUI

/// Visual direction edited on the post itself: a TikTok-framed slide with the real photo,
/// and an inspector sidebar on the right with every text control.
struct DesignEditorOverlay: View {
    /// First photo of the chosen folder; the Bible shot stands in when there is none.
    var photoURL: URL? = nil
    let close: () -> Void

    @AppStorage(DesignPreferences.modeKey) private var mode = "agent"
    @AppStorage(DesignPreferences.titleFontKey) private var titleFont = ""
    @AppStorage(DesignPreferences.titleWeightKey) private var titleWeight = "auto"
    @AppStorage(DesignPreferences.titleSizeKey) private var titleSize = "auto"
    @AppStorage(DesignPreferences.textColorKey) private var textColor = "auto"
    @AppStorage(DesignPreferences.alignKey) private var align = "auto"
    @AppStorage(DesignPreferences.strokeWidthKey) private var strokeWidth = "auto"
    @AppStorage(DesignPreferences.strokeColorKey) private var strokeColor = "auto"
    @AppStorage(DesignPreferences.positionKey) private var position = "auto"
    @AppStorage(DesignPreferences.caseKey) private var textCase = "auto"
    @AppStorage(DesignPreferences.highlightKey) private var highlight = "auto"
    @State private var userPhoto: NSImage?
    @State private var title = "Deus nunca esqueceu de você"
    @State private var appeared = false
    @Namespace private var glass

    private static let photo: NSImage? = Bundle.module
        .url(forResource: "modelo-ugc", withExtension: "jpg").flatMap(NSImage.init(contentsOf:))
    private static let featuredFonts = ["SF Pro", "New York", "Helvetica Neue", "Avenir Next", "Futura",
                                        "Didot", "Georgia", "Baskerville", "Gill Sans", "American Typewriter"]
        .filter { NSFontManager.shared.availableFontFamilies.contains($0) || $0 == "SF Pro" }
    private static let allFonts = NSFontManager.shared.availableFontFamilies
        .filter { !$0.hasPrefix(".") }
        .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    private static let colors = ["#FFFFFF", "#F5E6C8", "#FFD60A", "#FF9F0A", "#FF6B6B",
                                 "#FF8AD8", "#BF5AF2", "#4DA3FF", "#34C759", "#111111"]

    private var isCustom: Bool { mode == "custom" }

    var body: some View {
        GeometryReader { geometry in
            let phoneHeight = min(geometry.size.height - 80, 820)
            let phoneWidth = phoneHeight * 9 / 19.5
            ZStack {
                ModalBackdrop(close: close)
                HStack(spacing: 0) {
                    phone(width: phoneWidth, height: phoneHeight)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    sidebar
                        .frame(width: 320)
                        .padding(.vertical, 14).padding(.trailing, 14)
                }
                .modalAppearance(appeared)
            }
        }
        .onAppear { withAnimation(.modalAppear) { appeared = true } }
        .task(id: photoURL) { userPhoto = await photoURL.asyncMap(Self.loadPhoto) ?? nil }
        .onExitCommand(perform: close)
        .animation(.spring(response: 0.4, dampingFraction: 0.86), value: mode)
    }

    // MARK: - Sidebar

    private var sidebar: some View {
        VStack(spacing: 0) {
            ModalHeader(title: "Direção visual", done: close)
            HStack(spacing: 2) {
                modeOption("Com a IA", icon: "sparkles", value: "agent")
                modeOption("Eu escolho", icon: "slider.horizontal.3", value: "custom")
            }
            .padding(3)
            .background(Capsule().fill(.white.opacity(0.08)))
            .padding(.horizontal, 14)
            TextField("Frase de teste", text: $title, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...3)
                .modalField()
                .padding(.horizontal, 14).padding(.top, 12)
                .help("Escreva uma frase pra testar no slide")
            if isCustom {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        fontSection
                        section("Cor") { colorGrid(selection: $textColor) }
                        section("Contorno") {
                            SliderRow(title: "Grossura", value: numeric($strokeWidth, fallback: 0), range: 0...12, step: 1,
                                      label: Int(strokeWidth).map { $0 == 0 ? "Sem contorno" : "\($0) px" } ?? "Auto")
                            colorGrid(selection: $strokeColor)
                                .opacity(Int(strokeWidth) ?? 0 > 0 ? 1 : 0.4)
                        }
                        section("Título") {
                            VStack(spacing: 8) {
                                SliderRow(title: "Tamanho", value: numeric($titleSize, fallback: 88), range: 48...140, step: 2,
                                          label: Int(titleSize).map { "\($0) px" } ?? "Auto")
                                SliderRow(title: "Peso", value: numeric($titleWeight, fallback: 700), range: 300...900, step: 100,
                                          label: Int(titleWeight).map(String.init) ?? "Auto")
                            }
                        }
                        section("Posição") { positionTool }
                        section("Caixa") {
                            HStack(spacing: 6) {
                                optionButton("Auto", systemImage: "sparkles", isOn: textCase == "auto") { textCase = "auto" }
                                optionButton("Aa", isOn: textCase == "normal") { textCase = "normal" }
                                optionButton("AA", isOn: textCase == "upper") { textCase = "upper" }
                            }
                        }
                        section("Destaque") {
                            colorGrid(selection: $highlight)
                        }
                        section("Alinhamento") { alignTool }
                    }
                    .padding(.horizontal, 18).padding(.vertical, 20)
                }
                .scrollIndicators(.never)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "sparkles").font(.system(size: 28, weight: .medium))
                    Text("A IA escolhe fonte, cor, contorno, posição e destaque olhando as suas referências.")
                        .font(.system(size: 14, weight: .medium))
                        .multilineTextAlignment(.center)
                }
                .padding(28)
                .frame(maxHeight: .infinity)
                .transition(.opacity)
            }
            Spacer(minLength: 0)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .modalPanel()
    }

    private func modeOption(_ title: String, icon: String, value: String) -> some View {
        let isOn = mode == value
        return Button { mode = value } label: {
            Label(title, systemImage: icon)
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
                .frame(maxWidth: .infinity).frame(height: 32)
                .background {
                    if isOn {
                        Capsule().fill(.white)
                            .matchedGeometryEffect(id: "mode", in: glass)
                    }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .foregroundStyle(isOn ? .black : .white.opacity(0.75))
    }

    private func section<Content: View>(_ title: String, value: String? = nil,
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

    // MARK: - Phone

    private func phone(width: CGFloat, height: CGFloat) -> some View {
        ZStack {
            if let photo = userPhoto ?? Self.photo {
                Image(nsImage: photo).resizable().scaledToFill()
                    .frame(width: width, height: height).clipped()
            }
            LinearGradient(stops: [.init(color: .black.opacity(0.35), location: 0),
                                   .init(color: .clear, location: 0.18),
                                   .init(color: .clear, location: 0.7),
                                   .init(color: .black.opacity(0.5), location: 1)],
                           startPoint: .top, endPoint: .bottom)
            TikTokChrome()
            slideText(width: width)
                .padding(.leading, width * 0.07)
                .padding(.trailing, width * 0.19) // clear of the action rail, like a real post
                .padding(.top, height * 0.17)     // below the tabs
                .padding(.bottom, height * 0.27)  // above caption and nav, TikTok's safe zone
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: verticalPlacement)
                .animation(.spring(response: 0.4, dampingFraction: 0.85), value: position)
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 46, style: .continuous))
        .shadow(color: .black.opacity(0.45), radius: 40, y: 20)
        .environment(\.colorScheme, .dark)
    }

    private var verticalPlacement: Alignment {
        guard isCustom else { return .center }
        switch position {
        case "top": return .top
        case "bottom": return .bottom
        default: return .center
        }
    }

    /// Title with case applied and the last word painted in the highlight color.
    private var styledTitle: AttributedString {
        let text = isCustom && textCase == "upper" ? title.uppercased() : title
        var attributed = AttributedString(text)
        if isCustom, highlight != "auto",
           let lastWord = text.split(separator: " ").last,
           let range = attributed.range(of: String(lastWord), options: .backwards) {
            attributed[range].foregroundColor = Color(hex: highlight)
        }
        return attributed
    }

    private var textAlignment: TextAlignment {
        switch align {
        case "leading": return .leading
        case "trailing": return .trailing
        default: return .center
        }
    }

    private var frameAlignment: Alignment {
        switch align {
        case "leading": return .leading
        case "trailing": return .trailing
        default: return .center
        }
    }

    private func slideText(width: CGFloat) -> some View {
        let scale = width / 1080
        return VStack(spacing: 14) {
            VStack(alignment: isCustom ? frameAlignment.horizontal : .center, spacing: 10) {
                Text(styledTitle)
                    .font(font(isCustom ? titleFont : "", size: CGFloat(isCustom ? Int(titleSize) ?? 88 : 88) * scale * 1.15))
                    .fontWeight(isCustom ? weight : .bold)
                    .multilineTextAlignment(isCustom ? textAlignment : .center)
                    .lineLimit(4)
                    .minimumScaleFactor(0.6)
            }
            .foregroundStyle(isCustom && textColor != "auto" ? Color(hex: textColor) : .white)
            .modifier(TextOutline(width: isCustom ? CGFloat(Int(strokeWidth) ?? 0) * scale * 1.15 : 0,
                                  color: strokeColor == "auto" ? .black : Color(hex: strokeColor)))
            .shadow(color: .black.opacity(0.45), radius: 8, y: 2)
            .frame(maxWidth: .infinity, alignment: isCustom ? frameAlignment : .center)
            .padding(10)
            .overlay {
                if isCustom {
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(.white.opacity(0.55), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                }
            }
        }
    }

    private func font(_ family: String, size: CGFloat) -> Font {
        // "SF Pro" is the system face; asking for it by name falls back to Helvetica.
        family.isEmpty || family == "SF Pro" ? .system(size: size) : .custom(family, size: size)
    }

    private var weight: Font.Weight {
        switch Int(titleWeight) ?? 700 {
        case ..<350: return .light
        case ..<450: return .regular
        case ..<550: return .medium
        case ..<650: return .semibold
        case ..<750: return .bold
        case ..<850: return .heavy
        default: return .black
        }
    }

    // MARK: - Popover

    /// Font list for the slide title.
    private var fontSection: some View {
        let selection = $titleFont
        return section("Fonte", value: selection.wrappedValue.isEmpty ? "Auto" : selection.wrappedValue) {
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
                Text(name).font(family.isEmpty ? .system(size: 15, weight: .medium) : font(family, size: 17))
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
        .help(hex ?? "Auto: a IA escolhe a cor")
    }

    private var positionTool: some View {
        HStack(spacing: 6) {
            optionButton("Auto", systemImage: "sparkles", isOn: position == "auto") { position = "auto" }
            optionButton("Topo", systemImage: "rectangle.tophalf.inset.filled", isOn: position == "top") { position = "top" }
            optionButton("Meio", systemImage: "rectangle.center.inset.filled", isOn: position == "middle") { position = "middle" }
            optionButton("Embaixo", systemImage: "rectangle.bottomhalf.inset.filled", isOn: position == "bottom") { position = "bottom" }
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
        .help(name)
    }

    private static func loadPhoto(_ url: URL) async -> NSImage? {
        await Task.detached(priority: .userInitiated) {
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                  let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                      kCGImageSourceCreateThumbnailFromImageAlways: true,
                      kCGImageSourceCreateThumbnailWithTransform: true,
                      kCGImageSourceThumbnailMaxPixelSize: 1400
                  ] as CFDictionary) else { return nil }
            return NSImage(cgImage: image, size: .zero)
        }.value
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
        let isOn = align == value
        return Button { align = value } label: {
            Image(systemName: icon).font(.system(size: 14, weight: .semibold))
                .frame(maxWidth: .infinity).frame(height: 36)
                .background(RoundedRectangle(cornerRadius: 10).fill(isOn ? .white.opacity(0.22) : .white.opacity(0.08)))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(name)
    }

    private func numeric(_ binding: Binding<String>, fallback: Double) -> Binding<Double> {
        Binding(get: { Double(binding.wrappedValue) ?? fallback },
                set: { binding.wrappedValue = String(Int($0)) })
    }
}

/// The TikTok For You chrome drawn over the slide, laid out from a real iPhone screenshot
/// (proportions of a 390×845pt screen) so the safe zones match what people will see.
struct TikTokChrome: View {
    var slideCount = 5
    var selectedSlide = 0

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let k = w / 390 // scale from iPhone points
            ZStack(alignment: .topLeading) {
                statusBar(k: k).frame(width: w).position(x: w / 2, y: 26 * k)
                topTabs(k: k).frame(width: w).position(x: w / 2, y: 80 * k)
                rail(k: k).position(x: w - 32 * k, y: h * 0.585)
                caption(k: k)
                    .frame(width: w - 90 * k, alignment: .leading)
                    .position(x: 16 * k + (w - 90 * k) / 2, y: h - 142 * k)
                searchStrip(k: k).frame(width: w, height: 36 * k).position(x: w / 2, y: h - 98 * k)
                navBar(k: k).frame(width: w, height: 80 * k).position(x: w / 2, y: h - 40 * k)
            }
        }
        .foregroundStyle(.white)
        .allowsHitTesting(false)
    }

    private func statusBar(k: CGFloat) -> some View {
        HStack {
            Text("16:35").font(.system(size: 16 * k, weight: .semibold)).frame(width: 90 * k)
            Spacer()
            Capsule().fill(.black).frame(width: 124 * k, height: 36 * k)
            Spacer()
            HStack(spacing: 5 * k) {
                Image(systemName: "wifi").font(.system(size: 13 * k, weight: .semibold))
                RoundedRectangle(cornerRadius: 3 * k).fill(.white).frame(width: 24 * k, height: 12 * k)
            }
            .frame(width: 90 * k)
        }
    }

    private func topTabs(k: CGFloat) -> some View {
        HStack(spacing: 0) {
            Image(systemName: "play.tv").font(.system(size: 19 * k, weight: .semibold))
                .frame(width: 44 * k)
            HStack(spacing: 16 * k) {
                Text("Minisséries").foregroundStyle(.white.opacity(0.55))
                Text("Seguindo").foregroundStyle(.white.opacity(0.7))
                Text("Loja").foregroundStyle(.white.opacity(0.7))
                Text("Para você")
                    .overlay(alignment: .bottom) {
                        Capsule().fill(.white).frame(width: 22 * k, height: 2.5 * k).offset(y: 9 * k)
                    }
            }
            .font(.system(size: 16 * k, weight: .semibold))
            .lineLimit(1).fixedSize()
            .frame(maxWidth: .infinity, alignment: .trailing)
            .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.12)],
                                 startPoint: .leading, endPoint: .trailing))
            .clipped()
            Image(systemName: "magnifyingglass").font(.system(size: 20 * k, weight: .semibold))
                .frame(width: 44 * k)
        }
        .shadow(color: .black.opacity(0.25), radius: 2)
    }

    private func rail(k: CGFloat) -> some View {
        VStack(spacing: 20 * k) {
            ZStack(alignment: .bottom) {
                Circle().fill(.white).frame(width: 46 * k, height: 46 * k)
                    .overlay(Image(systemName: "hands.and.sparkles.fill")
                        .font(.system(size: 20 * k)).foregroundStyle(.black))
                    .overlay(Circle().strokeBorder(.white, lineWidth: 1.5 * k))
                Image(systemName: "plus.circle.fill").font(.system(size: 18 * k))
                    .foregroundStyle(.white, Color(red: 1, green: 0.17, blue: 0.33))
                    .offset(y: 9 * k)
            }
            .padding(.bottom, 4 * k)
            railItem("heart.fill", "11,5 mil", k: k)
            railItem("ellipsis.bubble.fill", "52", k: k)
            railItem("bookmark.fill", "493", k: k)
            railItem("arrowshape.turn.up.right.fill", "191", k: k)
            Circle().fill(Color(white: 0.15)).frame(width: 44 * k, height: 44 * k)
                .overlay(Circle().fill(.white).frame(width: 22 * k, height: 22 * k)
                    .overlay(Image(systemName: "hands.and.sparkles.fill").font(.system(size: 11 * k)).foregroundStyle(.black)))
                .padding(.top, 4 * k)
        }
        .shadow(color: .black.opacity(0.25), radius: 3)
    }

    private func railItem(_ icon: String, _ label: String, k: CGFloat) -> some View {
        VStack(spacing: 4 * k) {
            Image(systemName: icon).font(.system(size: 30 * k))
            Text(label).font(.system(size: 12 * k, weight: .semibold)).lineLimit(1).fixedSize()
        }
    }

    private func caption(k: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 6 * k) {
            HStack(spacing: 4 * k) {
                ForEach(0..<max(1, slideCount), id: \.self) { index in
                    Capsule().fill(.white.opacity(index == selectedSlide ? 1 : 0.35))
                        .frame(width: index == selectedSlide ? 14 * k : 5 * k, height: 5 * k)
                }
            }
            .padding(.bottom, 4 * k)
            Text("oracaodiaria").font(.system(size: 16 * k, weight: .semibold))
            Text("salva pra ler de novo amanhã 🙏").font(.system(size: 15 * k)).lineLimit(1)
        }
        .shadow(color: .black.opacity(0.3), radius: 2)
    }

    private func searchStrip(k: CGFloat) -> some View {
        HStack(spacing: 6 * k) {
            Image(systemName: "magnifyingglass").font(.system(size: 14 * k, weight: .semibold))
            Text("Pesquisa · versículos para dormir em paz").font(.system(size: 14 * k, weight: .medium)).lineLimit(1)
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.system(size: 13 * k, weight: .semibold))
        }
        .padding(.horizontal, 14 * k)
        .frame(maxHeight: .infinity)
        .background(.black.opacity(0.35))
    }

    private func navBar(k: CGFloat) -> some View {
        HStack(alignment: .top, spacing: 0) {
            navItem("house.fill", "Início", on: true, k: k)
            navItem("person.2", "Amigos", k: k)
            ZStack {
                RoundedRectangle(cornerRadius: 9 * k).fill(Color(red: 0.15, green: 0.96, blue: 0.94))
                    .frame(width: 46 * k, height: 30 * k).offset(x: -3 * k)
                RoundedRectangle(cornerRadius: 9 * k).fill(Color(red: 1, green: 0.17, blue: 0.33))
                    .frame(width: 46 * k, height: 30 * k).offset(x: 3 * k)
                RoundedRectangle(cornerRadius: 8 * k).fill(.white)
                    .frame(width: 42 * k, height: 30 * k)
                Image(systemName: "plus").font(.system(size: 16 * k, weight: .bold)).foregroundStyle(.black)
            }
            .frame(maxWidth: .infinity).padding(.top, 4 * k)
            navItem("bubble.left", "Mensagens", badge: "20", k: k)
            navItem("person", "Perfil", k: k)
        }
        .padding(.top, 8 * k)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(.black)
    }

    private func navItem(_ icon: String, _ label: String, on: Bool = false, badge: String? = nil, k: CGFloat) -> some View {
        VStack(spacing: 3 * k) {
            Image(systemName: icon).font(.system(size: 21 * k))
                .overlay(alignment: .topTrailing) {
                    if let badge {
                        Text(badge).font(.system(size: 10 * k, weight: .bold))
                            .padding(.horizontal, 5 * k).frame(height: 16 * k)
                            .background(Capsule().fill(Color(red: 1, green: 0.17, blue: 0.33)))
                            .offset(x: 14 * k, y: -7 * k)
                    }
                }
            Text(label).font(.system(size: 10.5 * k, weight: .semibold))
        }
        .foregroundStyle(on ? .white : .white.opacity(0.85))
        .frame(maxWidth: .infinity)
    }
}

extension Color {
    /// "#RRGGBB" in sRGB, the format the AI instructions use.
    var hexString: String {
        let color = NSColor(self).usingColorSpace(.sRGB) ?? .white
        return String(format: "#%02X%02X%02X", Int(round(color.redComponent * 255)),
                      Int(round(color.greenComponent * 255)), Int(round(color.blueComponent * 255)))
    }
}

/// Outline for text in the preview: four hard shadows read as a stroke, like TikTok captions.
private struct TextOutline: ViewModifier {
    let width: CGFloat
    let color: Color

    func body(content: Content) -> some View {
        if width > 0 {
            content
                .shadow(color: color, radius: 0, x: width / 2, y: 0)
                .shadow(color: color, radius: 0, x: -width / 2, y: 0)
                .shadow(color: color, radius: 0, x: 0, y: width / 2)
                .shadow(color: color, radius: 0, x: 0, y: -width / 2)
        } else {
            content
        }
    }
}

private extension Optional {
    func asyncMap<T>(_ transform: (Wrapped) async -> T) async -> T? {
        guard let value = self else { return nil }
        return await transform(value)
    }
}
