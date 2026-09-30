import AppKit
import ImageIO
import SwiftUI

@main
struct BulkMakerApp: App {
    var body: some Scene {
        WindowGroup("The Carousel Maker") {
            BatchFlowView().frame(minWidth: 960, minHeight: 690)
        }
        .windowStyle(.hiddenTitleBar)
        .windowBackgroundDragBehavior(.enabled)
    }
}

private struct BatchFlowView: View {
    @State private var photos: PhotoCatalog?
    @State private var desiredURL: URL?
    @State private var document: CSVDocument?
    @State private var csvName: String?
    @State private var csvURL: URL?
    @State private var outputURL: URL?
    @State private var outputCatalog: OutputCatalog?
    @State private var outputScanError: String?
    @State private var lastOutputScan = Date.distantPast
    @State private var outputScanSequence = 0
    @State private var errorMessage: String?
    @State private var pendingOverwrite: BatchRunRequest?
    @State private var overwriteFileCount = 0
    @State private var showOverwriteConfirmation = false
    @State private var lastSelectionData: Data?
    @State private var desiredCatalog: PhotoCatalog?
    @State private var showTerminalPanel = false
    // Decoded once and kept in state; reloading the JPEG on every body pass made panning drop frames.
    @State private var backgroundImage = CanvasBackground.load()
    @State private var backgroundIsCustom = CanvasBackground.isCustom
    @State private var page: Page = ProcessInfo.processInfo.arguments.contains("--calendar-preview") ? .calendar : .batch
    @State private var showDesignEditor = false
    @Namespace private var navSelection

    private enum Page { case batch, calendar, settings }
    private struct BatchRunRequest {
        let photos: URL
        let desired: URL
        let csv: URL?
        let output: URL
        let variations: Int
        let cli: AgentCLI
    }
    @AppStorage("terminalWidth") private var terminalWidth = 480.0
    @AppStorage("canvasZoom") private var zoom = 1.0
    @AppStorage("batchVariations") private var variations = 3
    @AppStorage("batchAgent") private var selectedAgentRaw = AgentCLI.claude.rawValue
    @State private var zoomStart: Double?
    @State private var canvasOffset = CGSize.zero
    @State private var panStart: CGSize?
    @State private var terminalDragStart: Double?
    @StateObject private var tabs = TerminalTabs()
    @StateObject private var batchRunner = BackgroundBatchRunner()

    var body: some View {
        HStack(spacing: 0) {
            mainPane.clipped()
            if showTerminalPanel && page == .batch {
                Rectangle().fill(Color(nsColor: .separatorColor)).frame(width: 1)
                    .overlay { terminalResizeHandle }
                    .zIndex(1)
                terminalPanel.frame(width: terminalWidth)
                    .transition(.move(edge: .trailing))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(alignment: .topTrailing) { if page == .batch { terminalToggle.padding(.top, 14).padding(.trailing, 16) } }
        .background { canvasBackground }
        .overlay {
            if showDesignEditor {
                DesignEditorOverlay(photoURL: photos?.files.first) {
                    withAnimation(.snappy(duration: 0.25)) { showDesignEditor = false }
                    _ = refreshContext()
                }
                .transition(.opacity)
            }
        }
        .ignoresSafeArea(.container, edges: .top)
        .onAppear(perform: importSelectionIfChanged)
        .onChange(of: desiredURL, initial: true) { _, url in desiredCatalog = url.flatMap { try? PhotoCatalog(directory: $0) } }
        .onChange(of: outputURL, initial: true) { _, _ in
            outputCatalog = nil
            outputScanError = nil
            refreshOutput(force: true)
        }
        .onChange(of: variations) { _, _ in _ = refreshContext() }
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { _ in
            importSelectionIfChanged()
            refreshOutput()
        }
        .alert("Não foi possível carregar", isPresented: Binding(
            get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK") { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
        .alert("Substituir arquivos existentes?", isPresented: $showOverwriteConfirmation,
               presenting: pendingOverwrite) { request in
            Button("Cancelar", role: .cancel) { pendingOverwrite = nil }
            Button("Substituir e gerar", role: .destructive) {
                pendingOverwrite = nil
                launchBatch(request, overwriteApproved: true)
            }
        } message: { request in
            Text("A pasta de saída já contém \(overwriteFileCount) arquivo(s) nas \(request.variations) pastas de variação desta geração. A IA poderá substituir esses arquivos.")
        }
    }

    private var terminalPanel: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        ForEach(tabs.sessions) { session in terminalTab(session) }
                        Menu {
                            Button("Terminal") { tabs.open() }
                            Divider()
                            Button("Claude") { launchCLI(.claude) }
                            Button("Codex") { launchCLI(.codex) }
                        } label: {
                            Image(systemName: "plus").font(.system(size: 13, weight: .semibold))
                        }
                        .menuStyle(.button)
                        .buttonStyle(.plain)
                        .menuIndicator(.hidden)
                        .frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                        .help("Nova aba: Terminal, Claude ou Codex")
                    }
                }
            }
            .padding(.leading, 12).padding(.trailing, 64).frame(height: 64)
            Divider()
            EmbeddedTerminal(session: tabs.selected)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .textBackgroundColor))
    }

    private func terminalTab(_ session: TerminalSession) -> some View {
        let isSelected = session.id == tabs.selectedID
        return HStack(spacing: 6) {
            Image(systemName: session.title == "zsh" ? "terminal" : "sparkle")
                .font(.system(size: 12))
            Text(session.title).font(.system(size: 13, weight: isSelected ? .semibold : .regular))
                .lineLimit(1)
            Button { tabs.close(session) } label: {
                Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
                    .frame(width: 18, height: 18)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help("Fechar aba")
        }
        .padding(.leading, 12).padding(.trailing, 6)
        .frame(height: 30)
        .foregroundStyle(isSelected ? .primary : .secondary)
        .background {
            if isSelected { RoundedRectangle(cornerRadius: 8).fill(.primary.opacity(0.08)) }
        }
        .contentShape(Rectangle())
        .onTapGesture { tabs.selectedID = session.id }
    }

    private var terminalResizeHandle: some View {
        Color.clear
            .frame(width: 9)
            .contentShape(Rectangle())
            .pointerStyle(.frameResize(position: .leading))
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .global)
                    .onChanged { value in
                        let start = terminalDragStart ?? terminalWidth
                        terminalDragStart = start
                        terminalWidth = min(max(start - value.translation.width, 320), 900)
                    }
                    .onEnded { _ in terminalDragStart = nil }
            )
            .onTapGesture(count: 2) {
                withAnimation(.snappy(duration: 0.24)) { terminalWidth = 480 }
            }
            .help("Arraste para ajustar a largura")
    }

    /// The only open/close control for the terminal; it sits at the window corner so it never moves.
    private var terminalToggle: some View {
        Button {
            if showTerminalPanel {
                withAnimation(.snappy(duration: 0.24)) { showTerminalPanel = false }
            } else {
                openTerminal()
            }
        } label: {
            Image(systemName: showTerminalPanel ? "sidebar.right" : "terminal")
                .frame(width: 20, height: 20)
        }
        .buttonStyle(.glass)
        .keyboardShortcut("`", modifiers: .control)
        .help(showTerminalPanel ? "Esconder Terminal (⌃`)" : "Mostrar Terminal (⌃`)")
    }

    private var topNav: some View {
        HStack(spacing: 4) {
            navButton("Criar em lote", icon: "square.stack.3d.up", page: .batch)
            comingSoonNavIcon("Canvas", icon: "square.dashed")
            navButton("Calendário", icon: "calendar", page: .calendar)
            navButton("Configurações", icon: "gearshape", page: .settings)
                .keyboardShortcut(",", modifiers: .command)
        }
        .padding(4)
        .glassEffect(.regular, in: .capsule)
    }

    /// The active page shows its name in a pill; the rest collapse to icons, like a morphing tab bar.
    private func navButton(_ title: String, icon: String, page target: Page) -> some View {
        let isSelected = page == target
        return Button {
            withAnimation(.snappy(duration: 0.3)) { page = target }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 15, weight: isSelected ? .semibold : .regular))
                if isSelected {
                    Text(title).font(.system(size: 14, weight: .semibold)).fixedSize()
                        .transition(.opacity.combined(with: .scale(scale: 0.8, anchor: .leading)))
                }
            }
            .padding(.horizontal, isSelected ? 14 : 0)
            .frame(minWidth: 40).frame(height: 36)
            .background {
                if isSelected {
                    Capsule().fill(.primary.opacity(0.08))
                        .matchedGeometryEffect(id: "nav-pill", in: navSelection)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .foregroundStyle(isSelected ? .primary : .secondary)
        .help(isSelected ? "" : title)
    }

    private func comingSoonNavIcon(_ title: String, icon: String) -> some View {
        Image(systemName: icon)
            .font(.system(size: 15))
            .foregroundStyle(.secondary)
            .frame(width: 40, height: 36)
            .contentShape(Rectangle())
            .help("\(title) · em breve")
            .accessibilityLabel("\(title), em breve")
    }

    private var mainPane: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
            }
            .font(.system(size: 14)).padding(.horizontal, 20).frame(height: 64)
            .overlay { topNav }
            .zIndex(1)
            if page == .calendar {
                CalendarPrototypeView(outputFolder: outputURL, background: backgroundImage)
                    .padding(.top, -64)
                    .transition(.opacity)
            } else if page == .settings {
                // Scrolls under the floating nav instead of being cut off below it.
                SettingsPage(background: backgroundImage, isCustom: backgroundIsCustom,
                             choose: chooseBackground, drop: setBackground, reset: resetBackground,
                             openBackgroundLibrary: openBackgroundLibrary)
                    .padding(.top, -64)
                    .transition(.opacity)
            } else {
            GeometryReader { geometry in
                Color.clear
                    .contentShape(Rectangle())
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .overlay(alignment: .center) {
                    flowCanvas
                        .scaleEffect(zoom)
                        .offset(canvasOffset)
                    }
            }
            .contentShape(Rectangle())
            .clipped()
            .background {
                CanvasScrollMonitor(isEnabled: !showDesignEditor) { delta in
                    canvasOffset.width += delta.width
                    canvasOffset.height += delta.height
                }
            }
            .simultaneousGesture(
                DragGesture(minimumDistance: 4)
                    .onChanged { value in
                        let start = panStart ?? canvasOffset
                        panStart = start
                        canvasOffset = CGSize(width: start.width + value.translation.width,
                                              height: start.height + value.translation.height)
                    }
                    .onEnded { _ in panStart = nil }
            )
            .simultaneousGesture(
                MagnifyGesture()
                    .onChanged { value in
                        let start = zoomStart ?? zoom
                        zoomStart = start
                        zoom = min(max(start * value.magnification, 0.5), 2)
                    }
                    .onEnded { _ in zoomStart = nil }
            )
            .overlay(alignment: .bottomTrailing) { zoomControls.padding(20) }
            .transition(.opacity)
            }
        }
    }

    private var canvasBackground: some View {
        Group {
            if let image = backgroundImage {
                Image(nsImage: image).resizable().scaledToFill()
            } else {
                Color(nsColor: .textBackgroundColor)
            }
        }
        .ignoresSafeArea()
    }

    private var zoomControls: some View {
        HStack(spacing: 2) {
            Button {
                withAnimation(.snappy(duration: 0.25)) { canvasOffset = .zero }
            } label: { Image(systemName: "scope").frame(width: 28, height: 28) }
                .help("Centralizar canvas")
            Button { setZoom(zoom - 0.1) } label: { Image(systemName: "minus").frame(width: 28, height: 28) }
                .keyboardShortcut("-", modifiers: .command)
                .help("Diminuir zoom (⌘-)")
            Button { setZoom(1) } label: {
                Text("\(Int((zoom * 100).rounded()))%")
                    .font(.system(size: 12, weight: .semibold)).monospacedDigit()
                    .frame(width: 46, height: 28)
            }
            .keyboardShortcut("0", modifiers: .command)
            .help("Voltar para 100% (⌘0)")
            Button { setZoom(zoom + 0.1) } label: { Image(systemName: "plus").frame(width: 28, height: 28) }
                .keyboardShortcut("=", modifiers: .command)
                .help("Aumentar zoom (⌘+)")
        }
        .buttonStyle(.plain)
        .padding(4)
        .glassEffect(.regular, in: .capsule)
    }

    private func setZoom(_ value: Double) {
        withAnimation(.snappy(duration: 0.2)) { zoom = min(max(value, 0.5), 2) }
    }

    private var flowCanvas: some View {
        ZStack(alignment: .topLeading) {
            Path { path in
                for startX in [128.0, 414.0, 700.0] {
                    path.move(to: CGPoint(x: startX, y: 176))
                    path.addCurve(to: CGPoint(x: 414, y: 236),
                                  control1: CGPoint(x: startX, y: 214), control2: CGPoint(x: 414, y: 202))
                }
                path.move(to: CGPoint(x: 414, y: 500))
                path.addLine(to: CGPoint(x: 414, y: 532))
            }
            .stroke(.white.opacity(0.85), style: StrokeStyle(lineWidth: 2, dash: [5, 6]))
            .shadow(color: .black.opacity(0.3), radius: 2)
            FlowNode(title: "Fotos", icon: "photo.on.rectangle", emptyAction: "Escolher pasta",
                     state: photosState, pick: choosePhotos, drop: { setPhotos($0) })
            FlowNode(title: "Resultado desejado", icon: "target", emptyAction: "Escolher pasta",
                     state: desiredState, pick: chooseDesired, drop: { setDesired($0) })
                .offset(x: 286)
            FlowNode(title: "Copy", icon: "text.alignleft", emptyAction: "Escolher CSV", isOptional: true,
                     state: copyState, pick: importCSV, drop: { loadCSV($0) })
                .offset(x: 572)
            AgentNode(missing: missingInputs, variations: $variations,
                      selectedAgentRaw: $selectedAgentRaw, runner: batchRunner,
                      generate: startBackgroundBatch,
                      openDesign: { withAnimation(.snappy(duration: 0.25)) { showDesignEditor = true } })
                .offset(x: 286, y: 236)
            FlowNode(title: "Saída", icon: "folder", emptyAction: "Escolher pasta", hasInput: true, hasOutput: false,
                     state: outputURL.map { .output(directory: $0, catalog: outputCatalog, error: outputScanError) } ?? .empty,
                     pick: chooseOutput, drop: { setOutput($0) })
                .offset(x: 286, y: 532)
        }
        .frame(width: 828, height: 720, alignment: .topLeading)
    }

    private var photosState: FlowNode.NodeState {
        guard let photos else { return .empty }
        return photos.files.isEmpty ? .warning("Nenhuma imagem nesta pasta") : .photos(photos)
    }
    private var desiredState: FlowNode.NodeState {
        if let desiredCatalog, !desiredCatalog.files.isEmpty { return .photos(desiredCatalog) }
        return desiredURL.map { .file(name: $0.lastPathComponent, detail: "Pasta de referências", icon: "folder.fill") } ?? .empty
    }
    private var copyState: FlowNode.NodeState {
        guard let document, let csvName else { return .empty }
        return .file(name: csvName, detail: "\(document.rows.count) \(document.rows.count == 1 ? "linha" : "linhas")",
                     icon: "tablecells")
    }
    private var missingInputs: [String] {
        [photos?.files.isEmpty == false ? nil : "Fotos",
         desiredURL == nil ? "Resultado" : nil,
         outputURL == nil ? "Saída" : nil].compactMap { $0 }
    }

    private func chooseBackground() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        setBackground(url)
    }
    private func setBackground(_ url: URL) {
        do {
            try CanvasBackground.importImage(from: url)
            backgroundImage = CanvasBackground.load()
            backgroundIsCustom = true
        } catch { errorMessage = "Não deu pra usar essa imagem como fundo." }
    }
    private func resetBackground() {
        CanvasBackground.reset()
        backgroundImage = CanvasBackground.load()
        backgroundIsCustom = false
    }

    private func openBackgroundLibrary() {
        let workspace = TerminalHandoff.projectDirectory.appendingPathComponent(".bulk-maker", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
            try TerminalHandoff.prepareDesignAssets(in: workspace)
            NSWorkspace.shared.open(workspace.appendingPathComponent("biblioteca-fundos", isDirectory: true))
        } catch { errorMessage = "Não deu para abrir a biblioteca de fundos." }
    }

    private func chooseFolder() -> URL? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        return panel.runModal() == .OK ? panel.url : nil
    }
    private func choosePhotos() { chooseFolder().map(setPhotos) }
    private func chooseDesired() { chooseFolder().map(setDesired) }
    private func chooseOutput() { chooseFolder().map(setOutput) }
    private func setPhotos(_ url: URL) {
        guard url.hasDirectoryPath else { return }
        do {
            photos = try PhotoCatalog(directory: url)
            refreshContext()
        } catch { errorMessage = error.localizedDescription }
    }
    private func setDesired(_ url: URL) {
        guard url.hasDirectoryPath else { return }
        desiredURL = url; refreshContext()
    }
    private func setOutput(_ url: URL) {
        guard url.hasDirectoryPath else { return }
        outputURL = url; refreshContext()
    }
    private func refreshOutput(force: Bool = false) {
        guard let directory = outputURL else { return }
        guard force || Date().timeIntervalSince(lastOutputScan) >= 3 else { return }
        lastOutputScan = Date()
        outputScanSequence += 1
        let sequence = outputScanSequence
        Task {
            let result = await Task.detached(priority: .utility) {
                Result { try OutputCatalog(directory: directory) }
            }.value
            guard outputURL == directory, outputScanSequence == sequence else { return }
            switch result {
            case .success(let catalog):
                if outputCatalog != catalog { outputCatalog = catalog }
                outputScanError = nil
            case .failure(let error):
                outputCatalog = nil
                outputScanError = error.localizedDescription
            }
        }
    }
    private func openTerminal() {
        guard refreshContext() else { return }
        withAnimation(.snappy(duration: 0.24)) { showTerminalPanel = true }
    }
    private func launchCLI(_ cli: AgentCLI) {
        guard refreshContext() else { return }
        tabs.open(cli, prompt: AgentSession.openingPrompt)
        withAnimation(.snappy(duration: 0.24)) { showTerminalPanel = true }
    }
    private func startBackgroundBatch() {
        guard missingInputs.isEmpty, let photos = photos?.directory,
              let desired = desiredURL, let output = outputURL else { return }
        let request = BatchRunRequest(photos: photos, desired: desired, csv: csvURL,
                                      output: output, variations: variations,
                                      cli: AgentCLI(rawValue: selectedAgentRaw) ?? .claude)
        // Each run goes to the next free variacao-NN, so nothing is replaced and runs sit side by side.
        launchBatch(request, overwriteApproved: false)
    }

    /// "Gerar" opens the chosen AI in the terminal panel, so the user watches the batch and can step in.
    private func launchBatch(_ request: BatchRunRequest, overwriteApproved: Bool) {
        do {
            _ = try TerminalHandoff.prepare(photos: request.photos, desired: request.desired,
                                            csv: request.csv, output: request.output,
                                            variations: request.variations,
                                            overwriteApproved: overwriteApproved)
            lastSelectionData = try Data(contentsOf: BatchSelectionBridge.fileURL)
            // Plans and review sheets from the previous run would be re-rendered by the `variacao-*` glob.
            let workspace = TerminalHandoff.projectDirectory.appendingPathComponent(".bulk-maker", isDirectory: true)
            for scratch in ["planos", "revisao"] {
                try? FileManager.default.removeItem(at: workspace.appendingPathComponent(scratch, isDirectory: true))
            }
            tabs.open(request.cli, prompt: AgentSession.generatePrompt(
                variations: request.variations, firstIndex: BatchOutputValidator.nextFreeIndex(in: request.output)))
            withAnimation(.snappy(duration: 0.24)) { showTerminalPanel = true }
        } catch { errorMessage = error.localizedDescription }
    }
    @discardableResult
    private func refreshContext() -> Bool {
        do {
            _ = try TerminalHandoff.prepare(photos: photos?.directory, desired: desiredURL,
                                            csv: csvURL, output: outputURL, variations: variations)
            lastSelectionData = try Data(contentsOf: BatchSelectionBridge.fileURL)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
    private func importSelectionIfChanged() {
        guard let data = try? Data(contentsOf: BatchSelectionBridge.fileURL),
              data != lastSelectionData,
              let selection = try? BatchSelectionBridge.decode(data) else { return }
        lastSelectionData = data
        do {
            let imported = try selection.resolve()
            photos = imported.photos
            desiredURL = imported.desired
            document = imported.csv
            csvURL = imported.csvURL
            csvName = imported.csvURL?.lastPathComponent
            outputURL = imported.output
            try TerminalHandoff.updateContext(photos: imported.photos?.directory,
                                              desired: imported.desired,
                                              csv: imported.csvURL, output: imported.output,
                                              variations: variations)
        } catch { errorMessage = error.localizedDescription }
    }
    private func importCSV() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.commaSeparatedText, .plainText]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        loadCSV(url)
    }
    private func loadCSV(_ url: URL) {
        guard ["csv", "txt"].contains(url.pathExtension.lowercased()) else { return }
        do {
            let data = try Data(contentsOf: url)
            guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .windowsCP1252) else {
                throw CocoaError(.fileReadInapplicableStringEncoding)
            }
            document = try CSVDocument(text: text)
            csvName = url.lastPathComponent
            csvURL = url
            refreshContext()
        } catch { errorMessage = error.localizedDescription }
    }
}

private struct FlowNode: View {
    enum NodeState {
        case empty
        case photos(PhotoCatalog)
        case file(name: String, detail: String, icon: String)
        case output(directory: URL, catalog: OutputCatalog?, error: String?)
        case warning(String)

        var isReady: Bool {
            switch self {
            case .photos, .file, .output: return true
            case .empty, .warning: return false
            }
        }
    }

    let title: String
    let icon: String
    let emptyAction: String
    var isOptional = false
    var hasInput = false
    var hasOutput = true
    let state: NodeState
    let pick: () -> Void
    let drop: (URL) -> Void
    @State private var isHovering = false
    @State private var isTargeted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            NodeHeader(title: title, icon: icon, isReady: state.isReady, isOptional: isOptional)
            content
        }
        .padding(16).frame(width: 256, height: 176, alignment: .topLeading)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .strokeBorder(borderColor, lineWidth: isTargeted ? 2 : 1)
        }
        .scaleEffect(isTargeted ? 1.03 : (isHovering ? 1.015 : 1))
        .shadow(color: .black.opacity(isHovering ? 0.18 : 0.08), radius: isHovering ? 18 : 8, y: isHovering ? 8 : 3)
        .animation(.snappy(duration: 0.2), value: isHovering)
        .animation(.snappy(duration: 0.2), value: isTargeted)
        .onHover { isHovering = $0 }
        .dropDestination(for: URL.self) { urls, _ in
            guard let url = urls.first else { return false }
            drop(url)
            return true
        } isTargeted: { isTargeted = $0 }
        .overlay(alignment: .top) { if hasInput { FlowPort().offset(y: -6) } }
        .overlay(alignment: .bottom) { if hasOutput { FlowPort().offset(y: 6) } }
    }

    private var borderColor: Color {
        if isTargeted { return .accentColor }
        switch state {
        case .photos, .file, .output: return .green.opacity(0.45)
        case .warning: return .orange.opacity(0.6)
        case .empty: return .white.opacity(0.35)
        }
    }

    @ViewBuilder private var content: some View {
        switch state {
        case .empty:
            Button(action: pick) {
                VStack(spacing: 8) {
                    Image(systemName: isTargeted ? "arrow.down.circle.fill" : "plus.circle.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(.tint)
                    Text(isTargeted ? "Solte aqui" : emptyAction)
                        .font(.system(size: 13, weight: .semibold))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background {
                    RoundedRectangle(cornerRadius: 14)
                        .fill(isTargeted ? Color.accentColor.opacity(0.12) : .white.opacity(isHovering ? 0.16 : 0.08))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(isTargeted ? Color.accentColor : .primary.opacity(0.22),
                                      style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                }
                .contentShape(RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .help("\(emptyAction) ou arraste até aqui")
        case .photos(let catalog):
            Spacer(minLength: 0)
            PhotoStrip(files: catalog.files)
            changeRow(icon: "folder",
                      text: "\(catalog.directory.lastPathComponent) · \(catalog.files.count) \(catalog.files.count == 1 ? "foto" : "fotos")")
        case .file(let name, let detail, let fileIcon):
            Spacer(minLength: 0)
            Button(action: pick) {
                HStack(spacing: 10) {
                    Image(systemName: fileIcon)
                        .font(.system(size: 16))
                        .foregroundStyle(.tint)
                        .frame(width: 38, height: 38)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.accentColor.opacity(0.14)))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(name).font(.system(size: 14, weight: .semibold)).lineLimit(1).truncationMode(.middle)
                        Text(detail).font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .opacity(isHovering ? 1 : 0)
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 14).fill(.white.opacity(isHovering ? 0.18 : 0.1)))
                .contentShape(RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .help("Trocar")
        case .output(let directory, let catalog, let error):
            // Same rhythm as the photo cards: preview on top, one folder row below, all inside 176pt.
            Spacer(minLength: 0)
            if let error {
                Label("Não foi possível ler a pasta", systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(.orange)
                    .help(error)
            } else if let catalog, !catalog.previewImages.isEmpty {
                PhotoStrip(files: catalog.previewImages)
            } else {
                Label(catalog == nil ? "Verificando arquivos…" : "Aguardando o lote",
                      systemImage: catalog == nil ? "arrow.triangle.2.circlepath" : "hourglass")
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 40)
                    .background(RoundedRectangle(cornerRadius: 12).fill(.white.opacity(0.1)))
            }
            HStack(spacing: 8) {
                changeRow(icon: "folder", text: outputSummary(directory: directory, catalog: catalog))
                Button { NSWorkspace.shared.open(directory) } label: {
                    Image(systemName: "arrow.up.forward.app")
                        .font(.system(size: 13, weight: .semibold))
                        .frame(width: 26, height: 26)
                        .background(Circle().fill(.white.opacity(0.3)))
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .help("Abrir no Finder")
            }
        case .warning(let message):
            Spacer(minLength: 0)
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.orange)
            Button("Escolher outra pasta", action: pick).buttonStyle(.glass)
        }
    }

    private func outputSummary(directory: URL, catalog: OutputCatalog?) -> String {
        guard let catalog, catalog.imageCount > 0 else { return directory.lastPathComponent }
        return "\(directory.lastPathComponent) · \(catalog.imageCount) \(catalog.imageCount == 1 ? "imagem" : "imagens")"
    }

    private func changeRow(icon: String, text: String) -> some View {
        Button(action: pick) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                Text(text).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 0)
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 11, weight: .semibold))
                    .opacity(isHovering ? 1 : 0)
            }
            .font(.system(size: 13))
            .foregroundStyle(.secondary)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Trocar pasta")
    }
}

private struct NodeHeader: View {
    let title: String
    let icon: String
    let isReady: Bool
    var isOptional = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(isReady ? .white : .primary)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 9)
                    .fill(isReady ? AnyShapeStyle(Color.green.gradient) : AnyShapeStyle(.white.opacity(0.35))))
            Text(title).font(.system(size: 16, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.8)
            if isOptional {
                Text("Opcional")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(Capsule().fill(.primary.opacity(0.07)))
            }
            Spacer(minLength: 0)
            if isReady {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(.green)
                    .transition(.scale.combined(with: .opacity))
                    .accessibilityLabel("Pronto")
            }
        }
        .animation(.snappy(duration: 0.25), value: isReady)
    }
}

/// The hub card: lights up once every required input is in, so the next step is obvious.
private struct AgentNode: View {
    let missing: [String]
    @Binding var variations: Int
    @Binding var selectedAgentRaw: String
    @AppStorage(ClaudeModel.storageKey) private var claudeModel = ClaudeModel.sonnet.rawValue
    @ObservedObject var runner: BackgroundBatchRunner
    let generate: () -> Void
    let openDesign: () -> Void
    @State private var isHovering = false

    private var isReady: Bool { missing.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            NodeHeader(title: "CLI + IA", icon: "sparkles", isReady: isReady)
            VStack(spacing: 0) {
                controlRow("IA") {
                    // One menu for CLI + model: "codex" or a Claude model name.
                    Picker("IA", selection: Binding(
                        get: { selectedAgentRaw == AgentCLI.codex.rawValue ? AgentCLI.codex.rawValue : claudeModel },
                        set: { choice in
                            if choice == AgentCLI.codex.rawValue {
                                selectedAgentRaw = AgentCLI.codex.rawValue
                            } else {
                                selectedAgentRaw = AgentCLI.claude.rawValue
                                claudeModel = choice
                            }
                        }
                    )) {
                        ForEach(ClaudeModel.allCases, id: \.self) { Text("Claude \($0.label)").tag($0.rawValue) }
                        Text("Codex").tag(AgentCLI.codex.rawValue)
                    }
                    .labelsHidden().pickerStyle(.menu).fixedSize()
                    .help("Haiku gasta menos, Opus capricha mais. O Gerar abre a IA escolhida no terminal.")
                }
                Divider().opacity(0.6)
                controlRow("Variações") {
                    HStack(spacing: 2) {
                        stepButton("minus", enabled: variations > 1) { variations -= 1 }
                        TextField("", value: Binding(
                            get: { variations },
                            set: { variations = min(max($0, 1), 20) }
                        ), format: .number)
                            .textFieldStyle(.plain)
                            .font(.system(size: 14, weight: .semibold)).monospacedDigit()
                            .multilineTextAlignment(.center)
                            .frame(width: 30)
                            .help("Digite de 1 a 20")
                        stepButton("plus", enabled: variations < 20) { variations += 1 }
                    }
                    .help("Número de versões completas do carrossel")
                }
                Divider().opacity(0.6)
                Button(action: openDesign) {
                    controlRow("Direção visual") {
                        HStack(spacing: 6) {
                            Text(DesignPreferences.current == DesignPreferences() ? "Com a IA" : "Eu escolho")
                                .font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1).fixedSize()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Fontes, bordas e fundos que a IA deve seguir")
            }
            .padding(.horizontal, 12)
            .background(RoundedRectangle(cornerRadius: 14).fill(.white.opacity(0.14)))
            Spacer(minLength: 0)
            statusLine
            actionButton
        }
        .padding(16).frame(width: 256, height: 264, alignment: .topLeading)
        .glassEffect(isReady ? .regular.tint(.green.opacity(0.14)) : .regular, in: .rect(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .strokeBorder(isReady ? Color.green.opacity(0.45) : .white.opacity(0.35), lineWidth: 1)
        }
        .scaleEffect(isHovering ? 1.015 : 1)
        .shadow(color: .black.opacity(isHovering ? 0.18 : 0.08), radius: isHovering ? 18 : 8, y: isHovering ? 8 : 3)
        .animation(.snappy(duration: 0.2), value: isHovering)
        .animation(.snappy(duration: 0.3), value: isReady)
        .animation(.snappy(duration: 0.2), value: variations)
        .onHover { isHovering = $0 }
        .overlay(alignment: .top) { FlowPort().offset(y: -6) }
        .overlay(alignment: .bottom) { FlowPort().offset(y: 6) }
    }

    private func controlRow<Control: View>(_ title: String, @ViewBuilder control: () -> Control) -> some View {
        HStack {
            Text(title).font(.system(size: 13, weight: .medium))
            Spacer(minLength: 8)
            control()
        }
        .frame(height: 38)
        .disabled(runner.status == .running)
    }

    private func stepButton(_ icon: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .bold))
                .frame(width: 26, height: 26)
                .background(Circle().fill(.white.opacity(0.35)))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
    }

    @ViewBuilder private var actionButton: some View {
        if runner.status == .running {
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text("Gerando…").font(.system(size: 13, weight: .semibold))
                Spacer(minLength: 0)
                Button("Parar", action: runner.cancel).buttonStyle(.glass)
            }
            .frame(height: 34)
        } else if isReady {
            Button(action: generate) {
                Label(variations == 1 ? "Gerar 1 variação" : "Gerar \(variations) variações", systemImage: "sparkles")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
        } else {
            Label("Falta \(missing.joined(separator: ", "))", systemImage: "circle.dashed")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .frame(maxWidth: .infinity).frame(height: 34)
                .background(Capsule().fill(.white.opacity(0.14)))
        }
    }

    @ViewBuilder private var statusLine: some View {
        switch runner.status {
        case .idle, .running:
            EmptyView()
        case .completed:
            Label("Pronto · confira a Saída", systemImage: "checkmark.circle.fill")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.green)
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.orange)
                .lineLimit(1)
                .help(message)
        case .cancelled:
            Label("Interrompido", systemImage: "stop.circle")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.secondary)
        }
    }
}

/// First few photos of the folder plus a "+N" tile, like a contact-sheet preview.
private struct PhotoStrip: View {
    let files: [URL]
    private let visible = 4

    var body: some View {
        HStack(spacing: 5) {
            ForEach(files.prefix(visible), id: \.self) { PhotoThumbnail(url: $0) }
            if files.count > visible {
                Text("+\(files.count - visible)")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 40, height: 40)
                    .background(RoundedRectangle(cornerRadius: 9).fill(.primary.opacity(0.07)))
            }
        }
    }
}

private struct PhotoThumbnail: View {
    let url: URL
    @State private var image: NSImage?
    private static let cache = NSCache<NSURL, NSImage>()

    var body: some View {
        RoundedRectangle(cornerRadius: 9).fill(.primary.opacity(0.07))
            .overlay {
                if let image { Image(nsImage: image).resizable().scaledToFill() }
            }
            .frame(width: 40, height: 40)
            .clipShape(RoundedRectangle(cornerRadius: 9))
            .task(id: url) { image = await Self.load(url) }
    }

    /// Decodes a small thumbnail off the main thread so big photo folders don't stall the canvas.
    private static func load(_ url: URL) async -> NSImage? {
        if let cached = cache.object(forKey: url as NSURL) { return cached }
        let image = await Task.detached(priority: .utility) { () -> NSImage? in
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                  let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                      kCGImageSourceCreateThumbnailFromImageAlways: true,
                      kCGImageSourceCreateThumbnailWithTransform: true,
                      kCGImageSourceThumbnailMaxPixelSize: 120
                  ] as CFDictionary) else { return nil }
            return NSImage(cgImage: cgImage, size: .zero)
        }.value
        if let image { cache.setObject(image, forKey: url as NSURL) }
        return image
    }
}

private struct FlowPort: View {
    var body: some View {
        Circle().fill(Color(nsColor: .windowBackgroundColor))
            .frame(width: 12, height: 12)
            .overlay { Circle().strokeBorder(Color(nsColor: .separatorColor), lineWidth: 2) }
    }
}
