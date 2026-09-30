import SwiftUI

/// A public-domain painting from the National Gallery of Art (CC0), listed in obras-nga.json.
/// Regenerate the list with export-nga-artworks.py.
struct Artwork: Identifiable, Decodable, Hashable {
    let id: String
    let title: String
    let artist: String
    let date: String

    var wallpaperID: String { "nga-" + id }

    /// IIIF image at the given width; the height follows the painting.
    func imageURL(width: Int) -> URL {
        URL(string: "https://api.nga.gov/iiif/\(id)/full/\(width),/0/default.jpg")!
    }

    /// Shuffled once per launch so every visit shows different paintings first.
    static let catalog: [Artwork] = {
        guard let url = Bundle.module.url(forResource: "obras-nga", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let artworks = try? JSONDecoder().decode([Artwork].self, from: data) else { return [] }
        return artworks.shuffled()
    }()
}

/// Browse the National Gallery paintings and add one as the app wallpaper with a click.
struct ArtworkBrowser: View {
    @ObservedObject var wallpapers: WallpaperStore
    let close: () -> Void

    @State private var query = ""
    @State private var downloading: Set<String> = []
    @State private var failed: String?
    @State private var appeared = false

    /// Thumbnails come through AsyncImage; the default cache is too small to keep a scrolled grid.
    private static let cache: Void = {
        URLCache.shared = URLCache(memoryCapacity: 64 << 20, diskCapacity: 256 << 20)
    }()

    init(wallpapers: WallpaperStore, close: @escaping () -> Void) {
        self.wallpapers = wallpapers
        self.close = close
        _ = Self.cache
    }

    private var results: [Artwork] {
        let words = query.split(separator: " ").map(String.init)
        guard !words.isEmpty else { return Artwork.catalog }
        return Artwork.catalog.filter { artwork in
            let text = "\(artwork.title) \(artwork.artist) \(artwork.date)"
            return words.allSatisfy { text.range(of: $0, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
        }
    }

    var body: some View {
        ZStack {
            ModalBackdrop(close: close)
            panel
                .frame(maxWidth: 1080, maxHeight: 780)
                .padding(.horizontal, 40).padding(.vertical, 32)
                .modalAppearance(appeared)
        }
        .onAppear { withAnimation(.modalAppear) { appeared = true } }
        .onExitCommand(perform: close)
    }

    private var panel: some View {
        Group {
            let results = results
            if results.isEmpty {
                ContentUnavailableView.search(text: query)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 184, maximum: 260), spacing: 10)], spacing: 10) {
                        ForEach(results) { artwork in
                            ArtworkTile(artwork: artwork,
                                        isAdded: wallpapers.contains(artwork),
                                        isSelected: wallpapers.selectedID == artwork.wallpaperID,
                                        isDownloading: downloading.contains(artwork.id)) {
                                pick(artwork)
                            }
                        }
                    }
                    .padding(.horizontal, 14).padding(.bottom, 14)
                }
                .scrollIndicators(.never)
                // Paintings slide under the glass header and fade out instead of being cut.
                .scrollEdgeEffectStyle(.soft, for: .top)
            }
        }
        .safeAreaBar(edge: .top) { header }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        // Scrolled paintings must not poke past the panel's rounded corners.
        .clipShape(.rect(cornerRadius: 26))
        .modalPanel()
    }

    private var header: some View {
        ModalHeader(title: "Obras de arte",
                    subtitle: failed ?? "\(Artwork.catalog.count.formatted(.number.locale(Locale(identifier: "pt_BR")))) pinturas em domínio público · National Gallery of Art",
                    subtitleIsError: failed != nil,
                    done: close) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.white.opacity(0.55))
                TextField("Buscar obra ou artista", text: $query)
                    .textFieldStyle(.plain)
            }
            .modalField()
            .frame(width: 240)
            .padding(.trailing, 6)
        }
    }

    private func pick(_ artwork: Artwork) {
        if wallpapers.contains(artwork) {
            wallpapers.select(artwork.wallpaperID)
            return
        }
        guard !downloading.contains(artwork.id) else { return }
        downloading.insert(artwork.id)
        failed = nil
        Task {
            let ok = await wallpapers.addArtwork(artwork)
            downloading.remove(artwork.id)
            guard !ok else { return }
            failed = "Não deu pra baixar “\(artwork.title)”. Confira a internet e tente de novo."
            try? await Task.sleep(for: .seconds(4))
            if failed?.contains(artwork.title) == true { failed = nil }
        }
    }
}

/// A painting thumbnail. Hover reveals title and artist; the selected one gets the same ring as the wallpaper grid.
private struct ArtworkTile: View {
    let artwork: Artwork
    let isAdded: Bool
    let isSelected: Bool
    let isDownloading: Bool
    let action: () -> Void
    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            Color.clear
                .aspectRatio(16 / 10, contentMode: .fit)
                .overlay {
                    AsyncImage(url: artwork.imageURL(width: 480),
                               transaction: Transaction(animation: .easeOut(duration: 0.3))) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill().transition(.opacity)
                        }
                    }
                }
                .overlay(alignment: .bottomLeading) { caption.opacity(isHovering ? 1 : 0) }
                .overlay {
                    if isDownloading {
                        Rectangle().fill(.black.opacity(0.35))
                            .overlay { ProgressView().controlSize(.small).tint(.white) }
                            .transition(.opacity)
                    }
                }
                .overlay(alignment: .topTrailing) {
                    if isAdded && !isSelected {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white)
                            .shadow(color: .black.opacity(0.6), radius: 3)
                            .padding(8)
                            .transition(.opacity)
                    }
                }
                .background(.white.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                .padding(4)
                .overlay {
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .strokeBorder(isSelected ? .white : .clear, lineWidth: 2.5)
                }
                .scaleEffect(isHovering && !isSelected ? 1.02 : 1)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isHovering)
        .animation(.spring(response: 0.35, dampingFraction: 0.75), value: isSelected)
        .animation(.easeOut(duration: 0.2), value: isDownloading)
        .animation(.easeOut(duration: 0.2), value: isAdded)
        .accessibilityLabel("\(artwork.title), \(artwork.artist)")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var caption: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(artwork.title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
            Text([artwork.artist, artwork.date].filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.system(size: 11)).lineLimit(1).opacity(0.8)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 10).padding(.top, 22).padding(.bottom, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .top, endPoint: .bottom))
    }
}
