import AppKit
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

/// One wallpaper option: the bundled photo or a copy of one the user added.
struct Wallpaper: Identifiable, Equatable {
    static let defaultID = "padrao"
    let id: String
    let url: URL
    var isDefault: Bool { id == Self.defaultID }
}

/// How often the wallpaper changes while "Alternar fundos" is on, like macOS.
enum WallpaperRotation: String, CaseIterable, Identifiable {
    case launch, minute, fiveMinutes, fifteenMinutes, thirtyMinutes, hour

    var id: String { rawValue }

    var title: String {
        switch self {
        case .launch: return "Ao abrir o app"
        case .minute: return "A cada minuto"
        case .fiveMinutes: return "A cada 5 minutos"
        case .fifteenMinutes: return "A cada 15 minutos"
        case .thirtyMinutes: return "A cada 30 minutos"
        case .hour: return "A cada hora"
        }
    }

    var interval: TimeInterval? {
        switch self {
        case .launch: return nil
        case .minute: return 60
        case .fiveMinutes: return 5 * 60
        case .fifteenMinutes: return 15 * 60
        case .thirtyMinutes: return 30 * 60
        case .hour: return 60 * 60
        }
    }
}

/// The app wallpaper: the single background every page shows (the terminal keeps its own).
/// Added images are downscaled on import and decoded off the main thread,
/// so a huge photo can't make panning or the crossfade drop frames.
@MainActor
final class WallpaperStore: ObservableObject {
    private enum Keys {
        static let selected = "wallpaperSelected"
        static let rotates = "wallpaperRotates"
        static let rotation = "wallpaperRotation"
        static let ascii = "wallpaperAscii"
    }
    nonisolated private static let maxPixelSize = 2560
    nonisolated private static let thumbnailPixelSize = 480

    @Published private(set) var items: [Wallpaper] = []
    /// The decoded current wallpaper; nil only when no image could be read.
    @Published private(set) var image: NSImage?
    @Published private(set) var thumbnails: [String: NSImage] = [:]
    @Published private(set) var selectedID: String
    @Published var rotates: Bool {
        didSet { UserDefaults.standard.set(rotates, forKey: Keys.rotates); schedule() }
    }
    @Published var rotation: WallpaperRotation {
        didSet { UserDefaults.standard.set(rotation.rawValue, forKey: Keys.rotation); schedule() }
    }
    /// Shows every wallpaper as colored ASCII art.
    @Published var ascii: Bool {
        didSet { UserDefaults.standard.set(ascii, forKey: Keys.ascii); applyEffect() }
    }
    private var timer: Timer?
    /// The current wallpaper before any effect, so toggling ASCII never re-reads the file.
    private var source: CGImage?

    nonisolated static var directory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("BulkMaker/fundos", isDirectory: true)
    }
    /// Where the single custom wallpaper lived before the app took several.
    private static var legacyURL: URL {
        directory.deletingLastPathComponent().appendingPathComponent("fundo-canvas.jpg")
    }
    private static let defaultURL = Bundle.module.url(forResource: "fundo-canvas", withExtension: "jpg")

    init() {
        let defaults = UserDefaults.standard
        selectedID = defaults.string(forKey: Keys.selected) ?? Wallpaper.defaultID
        rotates = defaults.bool(forKey: Keys.rotates)
        rotation = defaults.string(forKey: Keys.rotation).flatMap(WallpaperRotation.init) ?? .fifteenMinutes
        ascii = defaults.bool(forKey: Keys.ascii)
        migrateLegacyWallpaper()
        reloadItems()
        if rotates && rotation == .launch, let next = items.filter({ $0.id != selectedID }).randomElement() {
            selectedID = next.id
        } else if !items.contains(where: { $0.id == selectedID }) {
            selectedID = Wallpaper.defaultID
        }
        defaults.set(selectedID, forKey: Keys.selected)
        // Decoded synchronously once so the window never opens on an empty background.
        source = currentURL.flatMap { Self.decode($0, maxPixel: Self.maxPixelSize) }
        image = (ascii ? source.flatMap(AsciiArt.render) : source).map { NSImage(cgImage: $0, size: .zero) }
        schedule()
        loadThumbnails()
    }

    func select(_ id: String) {
        guard id != selectedID else { return }
        show(id)
        schedule()
    }

    /// Copies the images in and selects the last one. Returns how many could not be read.
    func add(_ urls: [URL]) async -> Int {
        guard !urls.isEmpty else { return 0 }
        let directory = Self.directory
        let added = await Task.detached(priority: .userInitiated) { () -> [String] in
            let stamp = Int(Date().timeIntervalSince1970 * 1000)
            return urls.enumerated().compactMap { index, url in
                let id = "\(stamp)-\(index)"
                let target = directory.appendingPathComponent(id + ".jpg")
                return (try? Self.importImage(from: url, to: target)) == nil ? nil : id
            }
        }.value
        reloadItems()
        loadThumbnails()
        if let last = added.last { show(last) }
        schedule()
        return urls.count - added.count
    }

    /// Downloads a National Gallery painting at wallpaper size and selects it.
    func addArtwork(_ artwork: Artwork) async -> Bool {
        let id = artwork.wallpaperID
        if items.contains(where: { $0.id == id }) { select(id); return true }
        guard let (file, response) = try? await URLSession.shared.download(from: artwork.imageURL(width: Self.maxPixelSize)),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return false }
        let target = Self.directory.appendingPathComponent(id + ".jpg")
        let imported = await Task.detached(priority: .userInitiated) {
            defer { try? FileManager.default.removeItem(at: file) }
            return (try? Self.importImage(from: file, to: target)) != nil
        }.value
        guard imported else { return false }
        reloadItems()
        loadThumbnails()
        show(id)
        schedule()
        return true
    }

    func contains(_ artwork: Artwork) -> Bool { items.contains { $0.id == artwork.wallpaperID } }

    func remove(_ id: String) {
        guard let item = items.first(where: { $0.id == id }), !item.isDefault else { return }
        try? FileManager.default.removeItem(at: item.url)
        let index = items.firstIndex(of: item) ?? 0
        reloadItems()
        thumbnails[id] = nil
        if selectedID == id { show(items[min(index, items.count - 1)].id) }
        schedule()
    }

    private var currentURL: URL? { items.first(where: { $0.id == selectedID })?.url }

    private func show(_ id: String) {
        selectedID = id
        UserDefaults.standard.set(id, forKey: Keys.selected)
        guard let url = currentURL else { return }
        let ascii = ascii
        Task {
            let (decoded, shown) = await Task.detached(priority: .userInitiated) { () -> (CGImage?, CGImage?) in
                let decoded = Self.decode(url, maxPixel: Self.maxPixelSize)
                return (decoded, ascii ? decoded.flatMap(AsciiArt.render) : decoded)
            }.value
            // A newer pick or toggle may have landed while this one was decoding.
            guard id == selectedID, ascii == self.ascii, let decoded, let shown else { return }
            source = decoded
            image = NSImage(cgImage: shown, size: .zero)
        }
    }

    private func applyEffect() {
        guard let source else { return }
        let id = selectedID, ascii = ascii
        Task {
            let shown: CGImage? = ascii
                ? await Task.detached(priority: .userInitiated) { AsciiArt.render(source) }.value
                : source
            guard id == selectedID, ascii == self.ascii, let shown else { return }
            image = NSImage(cgImage: shown, size: .zero)
        }
    }

    private func schedule() {
        timer?.invalidate()
        timer = nil
        guard rotates, items.count > 1, let interval = rotation.interval else { return }
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.advance() }
        }
    }

    /// Shuffles to any other wallpaper, never the one already showing.
    private func advance() {
        guard let next = items.filter({ $0.id != selectedID }).randomElement() else { return }
        show(next.id)
    }

    private func reloadItems() {
        let files = (try? FileManager.default.contentsOfDirectory(at: Self.directory, includingPropertiesForKeys: [.creationDateKey])) ?? []
        func created(_ url: URL) -> Date { (try? url.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast }
        // In the order they were added, whether from disk or from the National Gallery.
        let custom = files
            .filter { $0.pathExtension.lowercased() == "jpg" }
            .sorted { created($0) < created($1) }
            .map { Wallpaper(id: $0.deletingPathExtension().lastPathComponent, url: $0) }
        items = (Self.defaultURL.map { [Wallpaper(id: Wallpaper.defaultID, url: $0)] } ?? []) + custom
    }

    private func loadThumbnails() {
        let missing = items.filter { thumbnails[$0.id] == nil }
        guard !missing.isEmpty else { return }
        Task {
            for item in missing {
                let url = item.url
                let decoded = await Task.detached(priority: .utility) {
                    Self.decode(url, maxPixel: Self.thumbnailPixelSize)
                }.value
                if let decoded { thumbnails[item.id] = NSImage(cgImage: decoded, size: .zero) }
            }
        }
    }

    private func migrateLegacyWallpaper() {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: Self.legacyURL.path) else { return }
        let id = "\(Int(Date().timeIntervalSince1970 * 1000))-0"
        try? fileManager.createDirectory(at: Self.directory, withIntermediateDirectories: true)
        guard (try? fileManager.moveItem(at: Self.legacyURL, to: Self.directory.appendingPathComponent(id + ".jpg"))) != nil else { return }
        // It was the one in use, so it stays in use.
        selectedID = id
    }

    nonisolated private static func decode(_ url: URL, maxPixel: Int) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        return CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel
        ] as CFDictionary)
    }

    nonisolated private static func importImage(from source: URL, to target: URL) throws {
        guard let image = decode(source, maxPixel: maxPixelSize) else { throw CocoaError(.fileReadCorruptFile) }
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard let destination = CGImageDestinationCreateWithURL(target as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw CocoaError(.fileWriteUnknown) }
    }
}

struct SettingsPage: View {
    @ObservedObject var wallpapers: WallpaperStore
    let choose: () -> Void
    let add: ([URL]) -> Void
    let openBackgroundLibrary: () -> Void
    let openArtworks: () -> Void
    @State private var isTargeted = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Configurações").font(.system(size: 30, weight: .bold))
                section(title: "Fundo do app", icon: "photo") {
                    wallpaperGrid
                    Button(action: openArtworks) {
                        Label("Explorar obras de arte", systemImage: "building.columns")
                    }
                    .buttonStyle(.glass)
                    .help("Pinturas em domínio público da National Gallery of Art")
                    Divider()
                    HStack {
                        Toggle("Efeito ASCII", isOn: $wallpapers.ascii)
                            .toggleStyle(.switch)
                            .font(.system(size: 14))
                        Spacer()
                    }
                    .help("Mostra o fundo como arte em letras, com as cores da imagem")
                    HStack(spacing: 12) {
                        Toggle("Alternar fundos", isOn: $wallpapers.rotates)
                            .toggleStyle(.switch)
                            .font(.system(size: 14))
                        Spacer()
                        Picker("Intervalo", selection: $wallpapers.rotation) {
                            ForEach(WallpaperRotation.allCases) { Text($0.title).tag($0) }
                        }
                        .labelsHidden()
                        .fixedSize()
                        .opacity(wallpapers.rotates ? 1 : 0)
                        .animation(.snappy(duration: 0.2), value: wallpapers.rotates)
                    }
                    .disabled(wallpapers.items.count < 2)
                    .help(wallpapers.items.count < 2 ? "Adicione mais de um fundo para alternar" : "")
                }
                section(title: "Fundos para os carrosséis", icon: "photo.on.rectangle.angled") {
                    Text("Adicione imagens à biblioteca local. A IA poderá usá-las quando combinarem com o conteúdo.")
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                    Button("Abrir biblioteca no Finder", action: openBackgroundLibrary)
                        .buttonStyle(.glass)
                }
                // Visual only for now: the account, purchase and legal flows are not wired yet.
                section(title: "Assinatura", icon: "star.circle") {
                    settingsRow("Plano", value: "Grátis")
                    HStack(spacing: 8) {
                        Button("Gerenciar assinatura") {}.buttonStyle(.glass)
                        Button("Restaurar compras") {}.buttonStyle(.glass)
                    }
                }
                section(title: "Conta", icon: "person.crop.circle") {
                    settingsRow("E-mail", value: "Não conectado")
                    HStack(spacing: 8) {
                        Button("Sair") {}.buttonStyle(.glass)
                        Button("Apagar conta", role: .destructive) {}.buttonStyle(.glass).tint(.red)
                    }
                }
                section(title: "Suporte e privacidade", icon: "questionmark.circle") {
                    linkRow("Falar com o suporte", icon: "envelope")
                    Divider()
                    linkRow("Política de Privacidade", icon: "hand.raised")
                    Divider()
                    linkRow("Termos de Uso", icon: "doc.text")
                    Divider()
                    settingsRow("Versão", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                }
            }
            .frame(maxWidth: 640, alignment: .leading)
            .padding(.horizontal, 32).padding(.top, 76).padding(.bottom, 40)
            .frame(maxWidth: .infinity)
        }
    }

    /// macOS-style picker: click a thumbnail to use it; the real wallpaper behind the page crossfades live.
    private var wallpaperGrid: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 112, maximum: 160), spacing: 10)], spacing: 10) {
            ForEach(wallpapers.items) { item in
                WallpaperTile(thumbnail: wallpapers.thumbnails[item.id],
                              isSelected: item.id == wallpapers.selectedID) {
                    wallpapers.select(item.id)
                }
                .contextMenu {
                    if !item.isDefault {
                        Button("Remover fundo", role: .destructive) {
                            withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { wallpapers.remove(item.id) }
                        }
                    }
                }
                .help(item.isDefault ? "Fundo padrão" : "Clique para usar · botão direito para remover")
                .transition(.scale(scale: 0.85).combined(with: .opacity))
            }
            AddWallpaperTile(action: choose)
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: wallpapers.items)
        .padding(4)
        .overlay {
            if isTargeted {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.accentColor.opacity(0.14))
                    .strokeBorder(Color.accentColor, lineWidth: 2)
                    .overlay {
                        Label("Solte para adicionar", systemImage: "arrow.down")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: isTargeted)
        .dropDestination(for: URL.self) { urls, _ in
            let images = urls.filter { UTType(filenameExtension: $0.pathExtension)?.conforms(to: .image) == true }
            guard !images.isEmpty else { return false }
            add(images)
            return true
        } isTargeted: { isTargeted = $0 }
    }

    private func settingsRow(_ title: String, value: String) -> some View {
        HStack {
            Text(title).font(.system(size: 14))
            Spacer()
            Text(value).font(.system(size: 14)).foregroundStyle(.secondary)
        }
    }

    private func linkRow(_ title: String, icon: String) -> some View {
        Button {} label: {
            HStack(spacing: 10) {
                Image(systemName: icon).frame(width: 20).foregroundStyle(.tint)
                Text(title).font(.system(size: 14))
                Spacer()
                Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func section<Content: View>(title: String, icon: String,
                                        @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(title, systemImage: icon).font(.system(size: 16, weight: .semibold))
            content()
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
    }
}

/// One wallpaper thumbnail. Selected gets a macOS-style ring with a small gap around the image.
private struct WallpaperTile: View {
    let thumbnail: NSImage?
    let isSelected: Bool
    let select: () -> Void
    @State private var isHovering = false

    var body: some View {
        Button(action: select) {
            Color.clear
                .aspectRatio(16 / 10, contentMode: .fit)
                .overlay {
                    if let thumbnail {
                        Image(nsImage: thumbnail).resizable().scaledToFill()
                            .transition(.opacity)
                    }
                }
                .background(.quaternary)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                .padding(4)
                .overlay {
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .strokeBorder(isSelected ? Color.accentColor : .primary.opacity(isHovering ? 0.22 : 0),
                                      lineWidth: isSelected ? 2.5 : 1.5)
                }
                .scaleEffect(isHovering && !isSelected ? 1.025 : 1)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isHovering)
        .animation(.spring(response: 0.35, dampingFraction: 0.75), value: isSelected)
        .animation(.easeOut(duration: 0.3), value: thumbnail != nil)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// The "+" slot at the end of the grid; opens a picker that takes several images at once.
private struct AddWallpaperTile: View {
    let action: () -> Void
    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(.primary.opacity(isHovering ? 0.08 : 0.03))
                .strokeBorder(.primary.opacity(isHovering ? 0.35 : 0.2), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                .aspectRatio(16 / 10, contentMode: .fit)
                .overlay {
                    Image(systemName: "plus")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .padding(4)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .animation(.easeOut(duration: 0.15), value: isHovering)
        .help("Adicionar imagens")
        .accessibilityLabel("Adicionar fundos")
    }
}
