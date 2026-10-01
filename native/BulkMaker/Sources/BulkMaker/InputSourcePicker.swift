import AppKit
import ImageIO
import SwiftUI

/// Opens the source picker from anywhere (the batch cards) without that screen owning its state.
@MainActor @Observable
final class InputPickerCenter {
    static let shared = InputPickerCenter()

    struct Request: Identifiable {
        let id = UUID()
        let kind: InputKind
        let completion: (URL) -> Void
    }

    var request: Request?

    /// `completion` gets the folder the batch should read, once the user confirms.
    func present(_ kind: InputKind, completion: @escaping (URL) -> Void) {
        request = Request(kind: kind, completion: completion)
    }
}

/// Lives over the batch screen; shows the picker while there is a request.
struct InputPickerHost: View {
    var body: some View {
        let center = InputPickerCenter.shared
        ZStack {
            if let request = center.request {
                InputSourcePicker(request: request) { center.request = nil }
                    .id(request.id)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: center.request?.id)
    }
}

/// Photos or references from the Mac (folders and loose files) and/or the project's canvas, picked one by one.
struct InputSourcePicker: View {
    let request: InputPickerCenter.Request
    let close: () -> Void

    @State private var sources = InputSources()
    @State private var canvas: [(item: CanvasItem, url: URL)] = []
    /// Files each chosen Finder folder brings, counted once when it is added.
    @State private var counts: [String: Int] = [:]
    @State private var isSaving = false
    @State private var error: String?
    @State private var appeared = false

    private var kind: InputKind { request.kind }
    private var total: Int {
        sources.folders.reduce(0) { $0 + (counts[$1] ?? 0) } + sources.files.count + sources.canvasItems.count
    }

    var body: some View {
        ZStack {
            // Just dimmed, no blur: the batch cards stay readable behind the picker.
            Rectangle().fill(.black.opacity(0.3))
                .ignoresSafeArea()
                .onTapGesture(perform: close)
            VStack(spacing: 0) {
                ModalHeader(title: kind.title, subtitle: error, subtitleIsError: true, done: apply)
                HStack(alignment: .top, spacing: 16) {
                    macColumn.frame(width: 240)
                    canvasColumn
                }
                .padding(.horizontal, 18)
                .frame(maxHeight: .infinity, alignment: .top)
                footer
            }
            .frame(width: 700, height: 480)
            .modalPanel()
            .modalAppearance(appeared)
        }
        .onAppear {
            load()
            withAnimation(.modalAppear) { appeared = true }
        }
        .onExitCommand(perform: close)
    }

    // MARK: - Mac

    private var macColumn: some View {
        VStack(alignment: .leading, spacing: 12) {
            columnTitle("Do Mac", symbol: "laptopcomputer")
            ScrollView {
                VStack(spacing: 6) {
                    ForEach(sources.folders, id: \.self) { path in
                        sourceRow(symbol: "folder.fill", name: URL(fileURLWithPath: path).lastPathComponent,
                                  badge: "\(counts[path] ?? 0)") { sources.folders.removeAll { $0 == path } }
                    }
                    ForEach(sources.files, id: \.self) { path in
                        sourceRow(symbol: "photo", name: URL(fileURLWithPath: path).lastPathComponent, badge: nil) {
                            sources.files.removeAll { $0 == path }
                        }
                    }
                    if sources.folders.isEmpty && sources.files.isEmpty {
                        Text("Nada do Mac ainda")
                            .font(.system(size: 14, weight: .medium))
                            .frame(maxWidth: .infinity).frame(height: 64)
                            .background(RoundedRectangle(cornerRadius: 12)
                                .strokeBorder(.white.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
                    }
                }
            }
            .scrollIndicators(.never)
            HStack(spacing: 8) {
                pillButton("Pasta", symbol: "folder.badge.plus", action: addFolders)
                pillButton(kind.acceptsAnyFile ? "Arquivos" : "Imagens", symbol: "photo.badge.plus", action: addFiles)
            }
        }
        .padding(.bottom, 14)
    }

    private func sourceRow(symbol: String, name: String, badge: String?, remove: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).font(.system(size: 14, weight: .semibold)).frame(width: 18)
            Text(name).font(.system(size: 14, weight: .medium)).lineLimit(1).truncationMode(.middle)
            Spacer(minLength: 6)
            if let badge {
                Text(badge).font(.system(size: 13, weight: .semibold)).monospacedDigit()
                    .padding(.horizontal, 8).frame(height: 22)
                    .background(Capsule().fill(.white.opacity(0.12)))
            }
            Button(action: { withAnimation(.snappy(duration: 0.2)) { remove() } }) {
                Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).frame(width: 22, height: 22)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Tirar do lote")
        }
        .padding(.horizontal, 12).frame(height: 42)
        .background(RoundedRectangle(cornerRadius: 12).fill(.white.opacity(0.08)))
        .transition(.opacity.combined(with: .move(edge: .leading)))
    }

    // MARK: - Canvas

    private var canvasColumn: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                columnTitle("Do canvas", symbol: "square.dashed")
                Spacer()
                if !canvas.isEmpty {
                    Button(allCanvasSelected ? "Nenhuma" : "Todas") {
                        withAnimation(.snappy(duration: 0.2)) {
                            sources.canvasItems = allCanvasSelected ? [] : canvas.map(\.item.id)
                        }
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 13, weight: .semibold))
                    .padding(.horizontal, 12).frame(height: 28)
                    .background(Capsule().fill(.white.opacity(0.12)))
                }
            }
            if canvas.isEmpty {
                SlidiMessage(state: .curious, title: "Cadê as imagens?",
                             detail: "Cole imagens no canvas (⌘V) e volte aqui.", width: 52, stacked: true)
                .padding(20)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: 8)], spacing: 8) {
                        ForEach(canvas, id: \.item.id) { entry in canvasCell(entry) }
                    }
                    .padding(4)
                }
                .scrollIndicators(.never)
            }
        }
        .padding(.bottom, 14)
    }

    private var allCanvasSelected: Bool { !canvas.isEmpty && sources.canvasItems.count == canvas.count }

    private func canvasCell(_ entry: (item: CanvasItem, url: URL)) -> some View {
        let order = sources.canvasItems.firstIndex(of: entry.item.id)
        let isOn = order != nil
        return Button {
            withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) {
                if isOn { sources.canvasItems.removeAll { $0 == entry.item.id } } else { sources.canvasItems.append(entry.item.id) }
            }
        } label: {
            SourceThumbnail(url: entry.url)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(isOn ? Color.accentColor : .white.opacity(0.1), lineWidth: isOn ? 3 : 1))
                .overlay(alignment: .topTrailing) {
                    // The number is the order the images go into the batch.
                    ZStack {
                        Circle().fill(isOn ? Color.accentColor : .black.opacity(0.35))
                        Circle().strokeBorder(.white, lineWidth: 1.5)
                        if let order { Text("\(order + 1)").font(.system(size: 12, weight: .bold)).monospacedDigit() }
                    }
                    .frame(width: 24, height: 24)
                    .padding(7)
                }
                .scaleEffect(isOn ? 0.95 : 1)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            SlidiMessage(state: isSaving ? .thinking : error != nil ? .concerned : total > 0 ? .happy : .idle,
                         title: isSaving ? "Juntando arquivos" : total == 1 ? "1 arquivo no lote" : "\(total) arquivos no lote",
                         width: 28)
                .monospacedDigit()
            Spacer()
            Button(action: close) {
                Text("Cancelar").font(.system(size: 14, weight: .semibold)).padding(.horizontal, 16).frame(height: 36)
            }
            .buttonStyle(.plain)
            Button(action: apply) {
                HStack(spacing: 8) {
                    if isSaving { ProgressView().controlSize(.small) }
                    Text("Usar no lote").font(.system(size: 14, weight: .bold))
                }
                .padding(.horizontal, 18).frame(height: 36)
                .background(Capsule().fill(.white))
                .foregroundStyle(.black)
            }
            .buttonStyle(.plain)
            .disabled(isSaving)
        }
        .padding(.horizontal, 18).padding(.vertical, 14)
        .overlay(alignment: .top) { Rectangle().fill(.white.opacity(0.1)).frame(height: 1) }
    }

    private func columnTitle(_ title: String, symbol: String) -> some View {
        Label(title.uppercased(), systemImage: symbol)
            .font(.system(size: 12, weight: .bold)).tracking(1.2)
            .foregroundStyle(.white.opacity(0.7))
    }

    private func pillButton(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.system(size: 13, weight: .semibold))
                .frame(maxWidth: .infinity).frame(height: 36)
                .background(RoundedRectangle(cornerRadius: 12).fill(.white.opacity(0.12)))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Actions

    private func load() {
        let project = ProjectStore.shared.current
        canvas = CanvasBoard.savedItems(in: project.canvasDirectory)
            .filter { FileManager.default.fileExists(atPath: $0.url.path) }
        let selection = (try? Data(contentsOf: BatchSelectionBridge.fileURL)).flatMap { try? BatchSelectionBridge.decode($0) }
        let chosen = kind == .photos ? selection?.photos : selection?.desired
        let assembled = project.inputsFolder(kind).standardizedFileURL.path
        let chosenPath = chosen.map { URL(fileURLWithPath: $0).standardizedFileURL.path }
        if let stored = project.project.sources(for: kind),
           chosenPath == assembled || stored.singleFolder?.standardizedFileURL.path == chosenPath {
            sources = stored
        } else if let chosen {
            // A folder dropped straight on the card (or picked before sources existed) is the truth.
            sources = InputSources(folders: [chosen])
        }
        let ids = Set(canvas.map(\.item.id))
        sources.canvasItems.removeAll { !ids.contains($0) }
        for folder in sources.folders { count(folder) }
    }

    private func count(_ folder: String) {
        counts[folder] = InputAssembler.files(in: URL(fileURLWithPath: folder, isDirectory: true), kind: kind).count
    }

    private func addFolders() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = true
        panel.prompt = "Adicionar"
        guard panel.runModal() == .OK else { return }
        withAnimation(.snappy(duration: 0.2)) {
            for url in panel.urls where !sources.folders.contains(url.path) {
                sources.folders.append(url.path)
                count(url.path)
            }
        }
    }

    private func addFiles() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        if !kind.acceptsAnyFile { panel.allowedContentTypes = [.image, .pdf] }
        panel.prompt = "Adicionar"
        guard panel.runModal() == .OK else { return }
        withAnimation(.snappy(duration: 0.2)) {
            for url in panel.urls where !sources.files.contains(url.path) { sources.files.append(url.path) }
        }
    }

    private func apply() {
        guard !sources.isEmpty else {
            error = "Escolha uma pasta, uma imagem ou fotos do canvas."
            return
        }
        guard !isSaving else { return }
        isSaving = true
        error = nil
        let project = ProjectStore.shared.current
        let chosen = sources, kind = kind, target = project.inputsFolder(kind)
        let media = Dictionary(uniqueKeysWithValues: canvas.map { ($0.item.id, $0.url) })
        Task {
            let result = await Task.detached(priority: .userInitiated) {
                Result { try InputAssembler.assemble(chosen, kind: kind, into: target, canvasMedia: media) }
            }.value
            isSaving = false
            switch result {
            case .success(let folder):
                ProjectStore.shared.setSources(chosen, for: kind)
                request.completion(folder)
                close()
            case .failure(let failure):
                error = "Não deu pra juntar os arquivos: \(failure.localizedDescription)"
            }
        }
    }
}

/// A square thumbnail decoded off the main thread and kept in memory.
struct SourceThumbnail: View {
    let url: URL
    @State private var image: NSImage?

    private static let cache: NSCache<NSURL, NSImage> = {
        let cache = NSCache<NSURL, NSImage>()
        cache.countLimit = 300
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
                let decoded = await Task.detached(priority: .utility) {
                    CanvasBoard.displayImage(of: url, maxPixel: 280)
                }.value
                guard let decoded else { return }
                let loaded = NSImage(cgImage: decoded, size: .zero)
                Self.cache.setObject(loaded, forKey: url as NSURL)
                withAnimation(.easeOut(duration: 0.15)) { image = loaded }
            }
    }
}
