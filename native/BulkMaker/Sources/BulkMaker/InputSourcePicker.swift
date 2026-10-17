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

/// The visible library is independent of the selection: deselecting a photo never hides it.
@MainActor @Observable
final class InputPickerLibrary {
    let kind: InputKind
    var sources: InputSources
    var canvas: [(item: CanvasItem, url: URL)]
    private(set) var folderFiles: [String: [URL]] = [:]
    private(set) var loading = false
    private var revision = UUID()

    init(kind: InputKind, sources: InputSources = .init(), canvas: [(item: CanvasItem, url: URL)] = []) {
        self.kind = kind
        self.sources = sources
        self.canvas = Self.imageItems(canvas)
        let ids = Set(self.canvas.map(\.item.id))
        self.sources.canvasItems.removeAll { !ids.contains($0) }
    }

    static func imageItems(_ items: [(item: CanvasItem, url: URL)]) -> [(item: CanvasItem, url: URL)] {
        items.filter {
            !$0.item.isText && !$0.item.file.isEmpty && InputAssembler.isImage($0.url)
                && (try? $0.url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
        }
    }

    var macFiles: [URL] {
        var seen = Set<String>()
        return (sources.folders.flatMap { folderFiles[$0] ?? [] } + sources.files.map { URL(fileURLWithPath: $0) })
            .filter { seen.insert($0.standardizedFileURL.path).inserted }
    }
    var selectedMacFiles: [URL] { macFiles.filter(isSelected) }
    var total: Int {
        let selected = Set(sources.canvasItems)
        return Set((selectedMacFiles + canvas.filter { selected.contains($0.item.id) }.map(\.url))
            .map { $0.standardizedFileURL.path }).count
    }
    var allMacSelected: Bool { !macFiles.isEmpty && selectedMacFiles.count == macFiles.count }
    var allCanvasSelected: Bool { !canvas.isEmpty && sources.canvasItems.count == canvas.count }

    func isSelected(_ file: URL) -> Bool { !sources.excludedFiles.contains(file.standardizedFileURL.path) }

    func toggle(_ file: URL) {
        let key = file.standardizedFileURL.path
        if isSelected(file) { sources.excludedFiles.append(key) }
        else { sources.excludedFiles.removeAll { $0 == key } }
    }

    func selectMac(_ selected: Bool) {
        let paths = Set(macFiles.map { $0.standardizedFileURL.path })
        sources.excludedFiles.removeAll { paths.contains($0) }
        if !selected { sources.excludedFiles += paths.sorted() }
    }

    func toggleCanvas(_ id: UUID) {
        if sources.canvasItems.contains(id) { sources.canvasItems.removeAll { $0 == id } }
        else if canvas.contains(where: { $0.item.id == id }) { sources.canvasItems.append(id) }
    }

    func refresh() async {
        let id = UUID()
        revision = id
        loading = true
        let folders = sources.folders, kind = kind
        let found = await Task.detached(priority: .userInitiated) {
            Dictionary(uniqueKeysWithValues: folders.map { ($0, InputAssembler.files(in: URL(fileURLWithPath: $0), kind: kind)) })
        }.value
        guard revision == id else { return }
        folderFiles = found
        let known = Set(macFiles.map { $0.standardizedFileURL.path })
        sources.excludedFiles.removeAll { !known.contains($0) }
        loading = false
    }

    func add(_ urls: [URL]) async {
        for raw in urls {
            let url = raw.standardizedFileURL
            guard let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey]) else { continue }
            if values.isDirectory == true {
                if !sources.folders.contains(url.path) { sources.folders.append(url.path) }
            } else if values.isRegularFile == true, kind.acceptsAnyFile || InputAssembler.isImage(url) {
                if !sources.files.contains(url.path) { sources.files.append(url.path) }
                sources.excludedFiles.removeAll { $0 == url.path }
            }
        }
        await refresh()
    }

    func removeFolder(_ path: String) {
        sources.folders.removeAll { $0 == path }
        folderFiles.removeValue(forKey: path)
        let remaining = Set(macFiles.map { $0.standardizedFileURL.path })
        sources.excludedFiles.removeAll { !remaining.contains($0) }
    }
}

/// Both sources share the same thumbnail grid and selection controls, on the app's native glass panel.
struct InputSourcePicker: View {
    let request: InputPickerCenter.Request
    let close: () -> Void
    private let store: ProjectStore
    private let suppliedLibrary: Bool
    private let selectionCompletion: (([URL]) -> Void)?
    private let actionTitle: String
    var onControlFrame: ((String, CGRect) -> Void)?
    @State private var library: InputPickerLibrary
    @State private var isSaving = false
    @State private var error: String?
    @State private var sourceTab = 0

    init(request: InputPickerCenter.Request, store: ProjectStore? = nil, library: InputPickerLibrary? = nil,
         onControlFrame: ((String, CGRect) -> Void)? = nil,
         initialSourceTab: Int = 0, actionTitle: String = "Usar no lote", selectionCompletion: (([URL]) -> Void)? = nil,
         close: @escaping () -> Void) {
        self.request = request
        self.close = close
        self.store = store ?? .shared
        self.suppliedLibrary = library != nil
        self.onControlFrame = onControlFrame
        self.actionTitle = actionTitle
        self.selectionCompletion = selectionCompletion
        _sourceTab = State(initialValue: initialSourceTab)
        _library = State(initialValue: library ?? InputPickerLibrary(kind: request.kind))
    }

    private var kind: InputKind { request.kind }
    private var columns: [GridItem] { [GridItem(.adaptive(minimum: 96, maximum: 160), spacing: 12)] }

    var body: some View {
        GeometryReader { geometry in
            let width = min(920, max(320, geometry.size.width - 48))
            let height = min(640, max(280, geometry.size.height - 48))
            ZStack {
                Color.black.opacity(0.3).ignoresSafeArea().onTapGesture { dismiss() }
                VStack(spacing: 0) {
                    header
                    if width >= 720 {
                        HStack(alignment: .top, spacing: 28) {
                            macColumn.frame(maxWidth: .infinity)
                            canvasColumn.frame(maxWidth: .infinity)
                        }
                        .padding(.horizontal, 24)
                    } else {
                        Picker("Origem das imagens", selection: $sourceTab) {
                            Text("Do Mac").tag(0)
                            Text("Do canvas").tag(1)
                        }
                        .pickerStyle(.segmented).labelsHidden().padding(.horizontal, 24).padding(.bottom, 16)
                        Group { if sourceTab == 0 { macColumn } else { canvasColumn } }
                            .padding(.horizontal, 24)
                    }
                    footer(compact: width < 480)
                }
                .frame(width: width, height: height)
                .modalPanel()
                .reportPickerControl("panel", to: onControlFrame)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .coordinateSpace(name: "input-picker")
        }
        .task {
            if !suppliedLibrary { load() }
            await library.refresh()
        }
        .onExitCommand { dismiss() }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 5) {
                Text(kind.title).font(.system(size: 20, weight: .semibold))
                Text("Escolha as imagens que vão entrar no lote.")
                    .font(.system(size: 13)).foregroundStyle(.white.opacity(0.65))
            }
            Spacer()
            Button(action: dismiss) {
                Image(systemName: "xmark")
            }
            .buttonStyle(.appIcon)
            .disabled(isSaving).help("Fechar")
            .accessibilityLabel("Fechar seletor de imagens")
            .reportPickerControl("close", to: onControlFrame)
        }
        .padding(24)
    }

    private var macColumn: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Label("Do Mac", systemImage: "laptopcomputer").font(.system(size: 14, weight: .semibold))
                Spacer(minLength: 0)
                if !library.macFiles.isEmpty {
                    selectionButton(library.allMacSelected ? "Limpar" : "Todas", id: "mac-all") {
                        library.selectMac(!library.allMacSelected)
                    }
                }
                Menu {
                    Button("Adicionar pasta…", systemImage: "folder.badge.plus") { choose(folders: true) }
                    Button(kind.acceptsAnyFile ? "Adicionar arquivos…" : "Adicionar imagens…", systemImage: "photo.badge.plus") { choose(folders: false) }
                } label: {
                    Label("Adicionar", systemImage: "plus")
                }
                .menuStyle(.button).buttonStyle(.appSecondary).controlSize(.small)
                .disabled(isSaving || library.loading)
                .accessibilityLabel("Adicionar do Mac")
                .reportPickerControl("add", to: onControlFrame)
            }
            .frame(height: 32)
            Text("\(library.selectedMacFiles.count) de \(library.macFiles.count) selecionadas")
                .font(.system(size: 12)).foregroundStyle(.white.opacity(0.6)).monospacedDigit()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24) {
                    if library.macFiles.isEmpty && library.sources.folders.isEmpty && !library.loading {
                        emptyState("Suas fotos aparecem aqui", detail: "Adicione uma pasta ou arraste imagens do Finder.", symbol: "photo.on.rectangle")
                    }
                    ForEach(library.sources.folders, id: \.self) { path in
                        VStack(alignment: .leading, spacing: 12) {
                            groupHeader(URL(fileURLWithPath: path).lastPathComponent, symbol: "folder",
                                        count: library.folderFiles[path]?.count ?? 0, folder: path)
                            if let files = library.folderFiles[path], !files.isEmpty {
                                macGrid(files)
                            } else if !library.loading {
                                Text("Nenhuma imagem compatível nesta pasta.")
                                    .font(.system(size: 12)).foregroundStyle(.secondary).padding(.vertical, 16)
                            }
                        }
                    }
                    if !library.sources.files.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Imagens adicionadas").font(.system(size: 13, weight: .medium))
                            macGrid(library.sources.files.map { URL(fileURLWithPath: $0) })
                        }
                    }
                }
                .padding(.bottom, 12).padding(.horizontal, 2)
            }
            .contentMargins(.all, 0, for: .scrollContent)
            .defaultScrollAnchor(.top)
            .scrollEdgeEffectStyle(.soft, for: [.top, .bottom])
            .overlay { if library.loading { ProgressView("Abrindo imagens…").controlSize(.small) } }
            .dropDestination(for: URL.self) { urls, _ in
                guard !isSaving, !urls.isEmpty else { return false }
                Task { await library.add(urls) }
                return true
            }
        }
    }

    private func macGrid(_ files: [URL]) -> some View {
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(files, id: \.path) { file in
                imageCell(url: file, selected: library.isSelected(file), title: file.lastPathComponent,
                          control: "mac-\(file.path)") { library.toggle(file) }
            }
        }
    }

    private var canvasColumn: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Label("Do canvas", systemImage: "square.dashed").font(.system(size: 14, weight: .semibold))
                Spacer(minLength: 0)
                if !library.canvas.isEmpty {
                    selectionButton(library.allCanvasSelected ? "Limpar" : "Todas", id: "canvas-all") {
                        library.sources.canvasItems = library.allCanvasSelected ? [] : library.canvas.map(\.item.id)
                    }
                }
            }
            .frame(height: 32)
            Text("\(library.sources.canvasItems.count) de \(library.canvas.count) selecionadas")
                .font(.system(size: 12)).foregroundStyle(.white.opacity(0.6)).monospacedDigit()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24) {
                    if library.canvas.isEmpty {
                        emptyState("O canvas está vazio", detail: "Cole ou arraste imagens para o canvas do projeto.", symbol: "square.dashed")
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                            groupHeader("Imagens do projeto")
                            LazyVGrid(columns: columns, spacing: 12) {
                                ForEach(Array(library.canvas.enumerated()), id: \.element.item.id) { index, entry in
                                    imageCell(url: entry.url, selected: library.sources.canvasItems.contains(entry.item.id),
                                              title: "Imagem \(index + 1)", control: "canvas-\(entry.item.id)") {
                                        library.toggleCanvas(entry.item.id)
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.bottom, 12).padding(.horizontal, 2)
            }
            .contentMargins(.all, 0, for: .scrollContent)
            .defaultScrollAnchor(.top)
            .scrollEdgeEffectStyle(.soft, for: [.top, .bottom])
        }
    }

    private func groupHeader(_ title: String, symbol: String? = nil, count: Int? = nil, folder: String? = nil) -> some View {
        HStack(spacing: 8) {
            if let symbol { Image(systemName: symbol).foregroundStyle(.white.opacity(0.65)) }
            Text(title).font(.system(size: 13, weight: .medium)).lineLimit(1).truncationMode(.middle)
                .help(folder ?? title)
            Spacer(minLength: 0)
            if let count { Text("\(count)").font(.system(size: 12)).foregroundStyle(.white.opacity(0.6)).monospacedDigit() }
            if let folder {
                Button { library.removeFolder(folder) } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.appIcon).controlSize(.small).disabled(isSaving).help("Remover pasta do lote")
                .accessibilityLabel("Remover pasta \(title)")
                .reportPickerControl("remove-\(folder)", to: onControlFrame)
            }
        }
        .frame(height: 32)
    }

    private func imageCell(url: URL, selected: Bool, title: String, control: String, toggle: @escaping () -> Void) -> some View {
        Button(action: toggle) {
            VStack(alignment: .leading, spacing: 7) {
                SourceThumbnail(url: url)
                    .aspectRatio(1, contentMode: .fit)
                    .clipShape(.rect(cornerRadius: 12))
                    .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(.white.opacity(selected ? 0.9 : 0.12), lineWidth: selected ? 2 : 1) }
                    .overlay(alignment: .topTrailing) {
                        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 21, weight: .medium))
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(selected ? .black : .white, .white)
                            .padding(8)
                    }
                Text(title).font(.system(size: 11)).foregroundStyle(.white.opacity(0.7))
                    .lineLimit(1).truncationMode(.middle)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).disabled(isSaving || library.loading)
        .accessibilityLabel(title).accessibilityValue(selected ? "Selecionada" : "Não selecionada")
        .help(title)
        .reportPickerControl(control, to: onControlFrame)
    }

    private var selectionSummary: String {
        let noun = kind.acceptsAnyFile ? (library.total == 1 ? "arquivo selecionado" : "arquivos selecionados")
                                      : (library.total == 1 ? "imagem selecionada" : "imagens selecionadas")
        return isSaving ? "Preparando lote…" : "\(library.total) \(noun)"
    }

    private var selectedCount: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(selectionSummary).font(.system(size: 13, weight: .semibold)).monospacedDigit()
        }
    }

    private var footerActions: some View {
        HStack(spacing: 12) {
            Button("Cancelar", action: dismiss)
                .buttonStyle(.appSecondary).disabled(isSaving)
                .keyboardShortcut(.cancelAction)
                .reportPickerControl("cancel", to: onControlFrame)
            Button(action: apply) {
                HStack(spacing: 8) {
                    if isSaving { ProgressView().controlSize(.small) }
                    Text(actionTitle)
                }
            }
            .buttonStyle(.appPrimary)
            .keyboardShortcut(.defaultAction)
            .disabled(isSaving || library.loading || library.total == 0)
            .reportPickerControl("apply", to: onControlFrame)
        }
    }

    private func footer(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let error {
                Text(error).font(.system(size: 12)).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            }
            if compact {
                selectedCount
                HStack { Spacer(minLength: 0); footerActions }
            } else {
                HStack(spacing: 16) { selectedCount; Spacer(minLength: 8); footerActions }
            }
        }
        .padding(24)
    }

    private func selectionButton(_ title: String, id: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .buttonStyle(.appSecondary).controlSize(.small).disabled(isSaving || library.loading)
            .reportPickerControl(id, to: onControlFrame)
    }

    private func emptyState(_ title: String, detail: String, symbol: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: symbol).font(.system(size: 24, weight: .light))
            Text(title).font(.system(size: 14, weight: .medium))
            Text(detail).font(.system(size: 12)).foregroundStyle(.white.opacity(0.65))
        }
        .multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.horizontal, 16).padding(.vertical, 44)
    }

    private func dismiss() { if !isSaving { close() } }

    private func load() {
        let project = store.current
        library.canvas = InputPickerLibrary.imageItems(CanvasBoard.savedItems(in: project.canvasDirectory))
        let selection = (try? Data(contentsOf: BatchSelectionBridge.fileURL)).flatMap { try? BatchSelectionBridge.decode($0) }
        let chosen = kind == .photos ? selection?.photos : selection?.desired
        let assembled = project.inputsFolder(kind).standardizedFileURL.path
        let chosenPath = chosen.map { URL(fileURLWithPath: $0).standardizedFileURL.path }
        if let stored = project.project.sources(for: kind),
           chosenPath == assembled || stored.singleFolder?.standardizedFileURL.path == chosenPath {
            library.sources = stored
        } else if let chosen { library.sources = InputSources(folders: [chosen]) }
        let ids = Set(library.canvas.map(\.item.id))
        library.sources.canvasItems.removeAll { !ids.contains($0) }
    }

    private func choose(folders: Bool) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = folders
        panel.canChooseFiles = !folders
        panel.allowsMultipleSelection = true
        if !folders && !kind.acceptsAnyFile { panel.allowedContentTypes = [.image, .pdf] }
        panel.prompt = "Adicionar"
        panel.begin { response in
            guard response == .OK else { return }
            Task { @MainActor in await library.add(panel.urls) }
        }
    }

    private func apply() {
        guard !isSaving, !library.loading, library.total > 0 else { return }
        if let selectionCompletion {
            let selected = Set(library.sources.canvasItems)
            var seen = Set<String>()
            let files = (library.selectedMacFiles + library.canvas.filter { selected.contains($0.item.id) }.map(\.url))
                .filter { seen.insert($0.standardizedFileURL.path).inserted }
            selectionCompletion(files)
            close()
            return
        }
        isSaving = true
        error = nil
        let project = store.current, chosen = library.sources, kind = kind, target = project.inputsFolder(kind)
        let media = Dictionary(uniqueKeysWithValues: library.canvas.map { ($0.item.id, $0.url) })
        Task {
            let result = await Task.detached(priority: .userInitiated) {
                Result { try InputAssembler.assemble(chosen, kind: kind, into: target, canvasMedia: media) }
            }.value
            isSaving = false
            guard store.current.id == project.id else { error = "O projeto mudou. Abra novamente o seletor neste projeto."; return }
            switch result {
            case .success(let folder):
                store.setSources(chosen, for: kind)
                request.completion(folder)
                close()
            case .failure(let failure): error = "Não deu pra juntar os arquivos: \(failure.localizedDescription)"
            }
        }
    }
}

/// Full-image thumbnails share one decoder and one bounded cache across both sources.
struct SourceThumbnail: View {
    let url: URL
    @State private var image: NSImage?
    @State private var failed = false
    private static let cache: NSCache<NSURL, NSImage> = {
        let cache = NSCache<NSURL, NSImage>()
        cache.countLimit = 300
        return cache
    }()

    var body: some View {
        Color.black.opacity(0.12)
            .overlay {
                if !InputAssembler.isImage(url) {
                    VStack(spacing: 8) {
                        Image(systemName: "doc.text").font(.system(size: 24))
                        Text(url.pathExtension.uppercased()).font(.system(size: 11, weight: .medium))
                    }.foregroundStyle(.white.opacity(0.7))
                } else if let image = image ?? Self.cache.object(forKey: url as NSURL) {
                    Image(nsImage: image).resizable().scaledToFit()
                } else if failed {
                    Image(systemName: "photo.badge.exclamationmark").font(.system(size: 22)).foregroundStyle(.secondary)
                } else { ProgressView().controlSize(.small) }
            }
            .clipped()
            .task(id: url) {
                image = nil
                failed = false
                guard InputAssembler.isImage(url), Self.cache.object(forKey: url as NSURL) == nil else { return }
                let file = url
                let decoded = await Task.detached(priority: .utility) { CanvasBoard.displayImage(of: file, maxPixel: 320) }.value
                guard !Task.isCancelled else { return }
                guard let decoded else { failed = true; return }
                let loaded = NSImage(cgImage: decoded, size: .zero)
                Self.cache.setObject(loaded, forKey: file as NSURL)
                image = loaded
            }
    }
}

private extension View {
    func reportPickerControl(_ id: String, to report: ((String, CGRect) -> Void)?) -> some View {
        onGeometryChange(for: CGRect.self) { $0.frame(in: .named("input-picker")) } action: { report?(id, $0) }
    }
}
