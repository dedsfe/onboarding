import AppKit
import ImageIO
import SwiftUI

/// Inspector beside the calendar's phone preview: the slide's words, highlights and photo, plus the
/// visual-direction controls for this slide or the whole post. Every change redraws the slide on screen.
struct SlideEditorPanel: View {
    @Bindable var session: SlideEditSession
    let index: Int
    let close: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            ModalHeader(title: "Editar slide \(index + 1)", subtitle: session.error, subtitleIsError: true, done: close) {
                if session.isRendering {
                    ProgressView().controlSize(.small).padding(.trailing, 8)
                }
            }
            if let slide = session.slide(index) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        StyleControls.section("Frase") {
                            TextField("Frase do slide", text: Binding(get: { slide.text },
                                                                      set: { session.setText($0, at: index) }),
                                      axis: .vertical)
                                .textFieldStyle(.plain)
                                .lineLimit(2...6)
                                .modalField()
                        }
                        highlightSection
                        photoSection(current: slide.photo)
                        StyleControls.section("Estilo") { scopePicker }
                        StyleControls(prefs: Binding(get: { session.preferences(for: index) },
                                                     set: { session.setStyle($0, for: index) }),
                                      autoHelp: session.scope == .slide ? "Auto: igual ao post" : "Auto: o renderizador decide")
                    }
                    .padding(.horizontal, 18).padding(.vertical, 20)
                }
                .scrollIndicators(.never)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "doc.badge.clock").font(.system(size: 28, weight: .medium))
                    Text("Esse post é de antes do editor e não tem o plano salvo. Peça pra IA refazer ele que aí dá pra editar aqui.")
                        .font(.system(size: 14, weight: .medium))
                        .multilineTextAlignment(.center)
                }
                .padding(28)
                .frame(maxHeight: .infinity)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .modalPanel()
    }

    // MARK: - Words

    private var highlightSection: some View {
        StyleControls.section("Destaque") {
            FlowLayout(spacing: 6) {
                ForEach(session.words(at: index), id: \.self) { word in
                    let isOn = session.isHighlighted(word, at: index)
                    Button { session.toggleHighlight(word, at: index) } label: {
                        Text(word)
                            .font(.system(size: 13, weight: .semibold))
                            .padding(.horizontal, 10).frame(height: 30)
                            .background(Capsule().fill(isOn ? Color(hex: "#FFD60A") : .white.opacity(0.08)))
                            .foregroundStyle(isOn ? .black : .white.opacity(0.85))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .help(isOn ? "Tirar o destaque" : "Destacar essa palavra")
                }
            }
        }
    }

    // MARK: - Photo

    private func photoSection(current: String) -> some View {
        let photos = session.photos(for: index)
        return StyleControls.section("Foto") {
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 4), spacing: 6) {
                    ForEach(photos, id: \.self) { photo in
                        let isOn = photo.path == (current as NSString).expandingTildeInPath
                        Button { session.setPhoto(photo, at: index) } label: {
                            PhotoThumbnail(url: photo)
                                .aspectRatio(9 / 16, contentMode: .fit)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(isOn ? .white : .clear, lineWidth: 2))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help(photo.lastPathComponent)
                    }
                }
            }
            .frame(height: photos.count > 8 ? 230 : nil)
            .scrollIndicators(.never)
        }
    }

    // MARK: - Scope

    private var scopePicker: some View {
        HStack(spacing: 2) {
            scopeOption("Este slide", value: .slide)
            scopeOption("Post inteiro", value: .post)
        }
        .padding(3)
        .background(Capsule().fill(.white.opacity(0.08)))
    }

    private func scopeOption(_ title: String, value: SlideEditSession.Scope) -> some View {
        let isOn = session.scope == value
        return Button { session.scope = value } label: {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .frame(maxWidth: .infinity).frame(height: 32)
                .background(Capsule().fill(isOn ? .white : .clear))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .foregroundStyle(isOn ? .black : .white.opacity(0.75))
    }
}

/// A photo thumbnail decoded off the main thread and kept in memory.
private struct PhotoThumbnail: View {
    let url: URL
    @State private var image: NSImage?

    private static let cache: NSCache<NSURL, NSImage> = {
        let cache = NSCache<NSURL, NSImage>()
        cache.countLimit = 400
        return cache
    }()

    var body: some View {
        Color.white.opacity(0.06)
            .overlay {
                if let image = image ?? Self.cache.object(forKey: url as NSURL) {
                    Image(nsImage: image).resizable().scaledToFill()
                }
            }
            .clipped()
            .task(id: url) {
                guard Self.cache.object(forKey: url as NSURL) == nil else { return }
                let url = url
                let decoded = await Task.detached(priority: .utility) { () -> CGImage? in
                    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
                    return CGImageSourceCreateThumbnailAtIndex(source, 0, [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceThumbnailMaxPixelSize: 240
                    ] as CFDictionary)
                }.value
                guard let decoded else { return }
                let loaded = NSImage(cgImage: decoded, size: .zero)
                Self.cache.setObject(loaded, forKey: url as NSURL)
                image = loaded
            }
    }
}

/// Wraps its children into rows, like words in a paragraph.
private struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0,
                      height: rows.last.map { $0.y + $0.height } ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
        }
    }

    private struct Row { var items: [Int] = []; var y: CGFloat = 0; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if !rows[rows.count - 1].items.isEmpty && rows[rows.count - 1].width + spacing + size.width > width {
                let last = rows[rows.count - 1]
                rows.append(Row(y: last.y + last.height + spacing))
            }
            let gap = rows[rows.count - 1].items.isEmpty ? 0 : spacing
            rows[rows.count - 1].items.append(index)
            rows[rows.count - 1].width += gap + size.width
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
        }
        return rows
    }
}
