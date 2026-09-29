import AppKit
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

/// The canvas wallpaper: the bundled photo by default, or a copy of one the user picked.
/// Custom images are downscaled on import so a huge photo can't make panning drop frames.
enum CanvasBackground {
    private static let maxPixelSize = 2560

    static var customURL: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("BulkMaker/fundo-canvas.jpg")
    }

    static var isCustom: Bool { FileManager.default.fileExists(atPath: customURL.path) }

    static func load() -> NSImage? {
        if isCustom, let image = NSImage(contentsOf: customURL) { return image }
        return Bundle.module.url(forResource: "fundo-canvas", withExtension: "jpg").flatMap(NSImage.init(contentsOf:))
    }

    static func importImage(from source: URL) throws {
        guard let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: maxPixelSize
              ] as CFDictionary) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        try FileManager.default.createDirectory(at: customURL.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        guard let destination = CGImageDestinationCreateWithURL(customURL as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw CocoaError(.fileWriteUnknown) }
    }

    static func reset() {
        try? FileManager.default.removeItem(at: customURL)
    }
}

struct SettingsPage: View {
    let background: NSImage?
    let isCustom: Bool
    let choose: () -> Void
    let drop: (URL) -> Void
    let reset: () -> Void
    let openBackgroundLibrary: () -> Void
    @State private var isTargeted = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Configurações").font(.system(size: 30, weight: .bold))
                section(title: "Fundo do canvas", icon: "photo") {
                    Button(action: choose) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 14).fill(.quaternary)
                            if let background {
                                Image(nsImage: background).resizable().scaledToFill()
                            }
                            if isTargeted {
                                RoundedRectangle(cornerRadius: 14).fill(Color.accentColor.opacity(0.25))
                                Label("Solte aqui", systemImage: "arrow.down.circle.fill")
                                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                            }
                        }
                        .frame(maxWidth: .infinity).frame(height: 300)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .overlay {
                            RoundedRectangle(cornerRadius: 14)
                                .strokeBorder(isTargeted ? Color.accentColor : .primary.opacity(0.12),
                                              lineWidth: isTargeted ? 2 : 1)
                        }
                        .contentShape(RoundedRectangle(cornerRadius: 14))
                    }
                    .buttonStyle(.plain)
                    .help("Clique ou arraste uma imagem")
                    .dropDestination(for: URL.self) { urls, _ in
                        guard let url = urls.first else { return false }
                        drop(url)
                        return true
                    } isTargeted: { isTargeted = $0 }
                    HStack(spacing: 8) {
                        Button("Escolher imagem…", action: choose).buttonStyle(.glassProminent)
                        if isCustom {
                            Button("Usar o padrão", action: reset).buttonStyle(.glass)
                        }
                    }
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
