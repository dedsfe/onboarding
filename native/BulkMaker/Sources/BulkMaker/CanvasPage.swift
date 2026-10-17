import AppKit
import CarouselEngine
import SwiftUI

/// The Canvas page: an infinite board of images on frosted glass over the app wallpaper,
/// with a selection toolbar and zoom controls.
struct CanvasPage: View {
    @ObservedObject var terminals: TerminalTabs
    /// Can host an isolated board for previews and screen tests without touching the user's projects.
    var directory: URL? = nil
    var onControlFrame: ((String, CGRect) -> Void)? = nil
    private var canvasDirectory: URL { directory ?? ProjectStore.shared.current.canvasDirectory }
    @State private var controller = CanvasController()
    @State private var isGenerating = false
    /// 0 = wallpaper sharp like the other pages, 1 = fully frosted; the user picks with the slider.
    @AppStorage("canvasBackdropBlur") private var backdropBlur = 1.0

    var body: some View {
        ZStack {
            // Frosted wallpaper: the page keeps the app's look while images stay the loudest thing on it.
            Rectangle().fill(.ultraThinMaterial)
                .overlay(Color.black.opacity(0.28))
                .opacity(backdropBlur)
                .ignoresSafeArea()
            // Each project has its own board; switching projects builds a fresh canvas on its folder.
            InfiniteCanvasRepresentable(controller: controller, directory: canvasDirectory)
                .id(canvasDirectory)
            if controller.isEmpty {
                if isGenerating {
                    ImageGenerationStatus(compact: false)
                } else {
                    emptyState
                }
            }
        }
        .overlay(alignment: .top) {
            VStack(spacing: 16) {
                if isGenerating && !controller.isEmpty {
                    ImageGenerationStatus(compact: true)
                }
                if let arrival = controller.arrival {
                    arrivalNotice(arrival)
                        .transition(.opacity)
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 80)
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: controller.arrival?.id)
        .overlay(alignment: .bottom) {
            GeometryReader { geometry in
                VStack(spacing: 10) {
                    if controller.selectionCount > 0 {
                        selectionBar(compact: geometry.size.width < 840)
                            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("canvasScreen")) } action: { onControlFrame?("selection", $0) }
                    }
                    HStack(spacing: 10) {
                        importButton
                            .fixedSize()
                            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("canvasScreen")) } action: { onControlFrame?("import", $0) }
                        CanvasResearchButton(compact: geometry.size.width < 840).fixedSize()
                        blurControl(compact: geometry.size.width < 640)
                            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("canvasScreen")) } action: { onControlFrame?("blur", $0) }
                        Spacer(minLength: 0)
                        zoomControls
                            .fixedSize()
                            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("canvasScreen")) } action: { onControlFrame?("zoom", $0) }
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(20)
                .frame(maxHeight: .infinity, alignment: .bottom)
            }
        }
        .coordinateSpace(name: "canvasScreen")
        .animation(.spring(response: 0.35, dampingFraction: 0.82), value: controller.selectionCount > 0)
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: controller.isEmpty)
        .environment(\.colorScheme, .dark)
        .foregroundStyle(.white)
        .task(id: canvasDirectory) {
            let directory = canvasDirectory
            // Notices belong to this project too; don't carry one over after switching boards.
            controller.arrival = nil
            while !Task.isCancelled {
                isGenerating = CanvasFolder.isGenerating(in: directory, sessions: Set(terminals.sessions.map(\.activityID)))
                do { try await Task.sleep(for: .milliseconds(500)) }
                catch { return }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "square.dashed")
                .font(.system(size: 32, weight: .light))
                .foregroundStyle(.white.opacity(0.7))
            Text("Solte suas imagens aqui").font(.system(size: 22, weight: .bold))
            Text("Arraste do Finder, cole com ⌘V ou pesquise no TikTok aqui embaixo.")
                .font(.system(size: 14))
                .foregroundStyle(.white.opacity(0.7))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 36).padding(.vertical, 30)
        .glassEffect(.regular, in: .rect(cornerRadius: 28))
        .allowsHitTesting(false)
    }

    /// Frosted ↔ sharp wallpaper behind the canvas.
    private func blurControl(compact: Bool) -> some View {
        HStack(spacing: 8) {
            Button { withAnimation(.easeOut(duration: 0.25)) { backdropBlur = backdropBlur > 0 ? 0 : 1 } } label: {
                Image(systemName: backdropBlur > 0 ? "drop.halffull" : "drop")
                    .font(.system(size: 14, weight: .semibold))
                    .frame(width: 26, height: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(backdropBlur > 0 ? "Desligar o borrão do fundo" : "Ligar o borrão do fundo")
            if !compact {
                Slider(value: $backdropBlur, in: 0...1)
                    .frame(width: 110)
                    .controlSize(.small)
                    .help("Borrão do fundo")
            }
        }
        .padding(.leading, 6).padding(.trailing, 12)
        .padding(4)
        .glassEffect(.regular, in: .capsule)
    }

    /// "The AI put N images on the canvas", with a jump to them; fades on its own.
    private func arrivalNotice(_ arrival: CanvasController.Arrival) -> some View {
        HStack(spacing: 12) {
            Text(arrival.ids.count == 1 ? "1 imagem nova da IA" : "\(arrival.ids.count) imagens novas da IA")
                .font(.system(size: 14, weight: .semibold))
            Button {
                controller.view?.reveal(arrival.ids)
                controller.arrival = nil
            } label: {
                Text("Ver")
            }
            .buttonStyle(.appPrimary)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
        .task(id: arrival.id) {
            try? await Task.sleep(for: .seconds(8))
            if controller.arrival?.id == arrival.id { controller.arrival = nil }
        }
    }

    private var importButton: some View {
        Button { controller.view?.importImages(nil) } label: {
            Label("Importar", systemImage: "plus")
        }
        .buttonStyle(.appSecondary)
        .help("Escolher imagens do Mac")
    }

    /// What can be done with the selection, one click away.
    private func selectionBar(compact: Bool) -> some View {
        HStack(spacing: 2) {
            Text(controller.selectionCount == 1 ? "1 item" : "\(controller.selectionCount) itens")
                .font(.system(size: 13, weight: .semibold))
                .monospacedDigit()
                .padding(.horizontal, 12)
            Divider().frame(height: 18)
            toolbarButton("arrow.down.right.and.arrow.up.left", "Diminuir (-)") { controller.view?.shrinkSelection(nil) }
            toolbarButton("arrow.up.left.and.arrow.down.right", "Aumentar (=)") { controller.view?.growSelection(nil) }
            if !compact && controller.selectionCount > 1 {
                toolbarButton("arrow.up.and.down.square", "Igualar altura") { controller.view?.matchHeights(nil) }
                toolbarButton("rectangle.split.3x1", "Organizar em linha") { controller.view?.arrangeInRow(nil) }
            }
            Divider().frame(height: 18)
            toolbarButton("doc.on.doc", "Copiar (⌘C)") { controller.view?.copy(nil) }
            toolbarButton("calendar.badge.plus", "Enviar ao calendário") { controller.view?.sendToCalendar(nil) }
                .disabled(!controller.selectionHasImages)
            if compact {
                Menu {
                    Button("Duplicar") { controller.view?.duplicate(nil) }
                    if controller.selectionCount > 1 {
                        Button("Igualar altura") { controller.view?.matchHeights(nil) }
                        Button("Organizar em linha") { controller.view?.arrangeInRow(nil) }
                    }
                    Button("Trazer pra frente") { controller.view?.bringToFront(nil) }
                    Button("Mandar pra trás") { controller.view?.sendToBack(nil) }
                    Button("Aproximar") { controller.view?.focusSelection(nil) }
                    Button("Mostrar no Finder") { controller.view?.revealSelection(nil) }
                        .disabled(!controller.selectionHasImages)
                } label: {
                    Image(systemName: "ellipsis").frame(width: 34, height: 30)
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .help("Mais ações da seleção")
                .accessibilityLabel("Mais ações da seleção")
            } else {
                toolbarButton("plus.square.on.square", "Duplicar (⌘D)") { controller.view?.duplicate(nil) }
                toolbarButton("square.3.layers.3d.top.filled", "Trazer pra frente") { controller.view?.bringToFront(nil) }
                toolbarButton("plus.magnifyingglass", "Aproximar") { controller.view?.focusSelection(nil) }
                toolbarButton("folder", "Mostrar no Finder") { controller.view?.revealSelection(nil) }
                    .disabled(!controller.selectionHasImages)
            }
            Divider().frame(height: 18)
            toolbarButton("trash", "Apagar (⌫)", role: .destructive) { controller.view?.delete(nil) }
        }
        .padding(4)
        .glassEffect(.regular, in: .capsule)
    }

    private func toolbarButton(_ symbol: String, _ help: String, role: ButtonRole? = nil,
                               action: @escaping () -> Void) -> some View {
        Button(role: role, action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .frame(width: 34, height: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(role == .destructive ? Color.red : .white)
        .help(help)
        .accessibilityLabel(help)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("canvasScreen")) } action: { onControlFrame?(help, $0) }
    }

    private var zoomControls: some View {
        HStack(spacing: 2) {
            Button { controller.view?.fitAll() } label: { Image(systemName: "scope").frame(width: 30, height: 30) }
                .help("Ver tudo (⌘1)")
                .keyboardShortcut("1", modifiers: .command)
            Button { controller.view?.zoomOut() } label: { Image(systemName: "minus").frame(width: 30, height: 30) }
                .help("Diminuir (⌘-)")
                .keyboardShortcut("-", modifiers: .command)
            Button { controller.view?.actualSize() } label: {
                Text("\(Int((controller.zoom * 100).rounded()))%").monospacedDigit().frame(minWidth: 50).frame(height: 30)
            }
            .help("Tamanho real (⌘0)")
            .keyboardShortcut("0", modifiers: .command)
            Button { controller.view?.zoomIn() } label: { Image(systemName: "plus").frame(width: 30, height: 30) }
                .help("Aumentar (⌘+)")
                .keyboardShortcut("=", modifiers: .command)
        }
        .buttonStyle(.plain)
        .font(.system(size: 13, weight: .semibold))
        .padding(4)
        .glassEffect(.regular, in: .capsule)
    }
}

/// Bridge between the SwiftUI controls and the AppKit canvas.
@MainActor @Observable
final class CanvasController {
    weak var view: InfiniteCanvasView?
    var zoom: CGFloat = 1
    var isEmpty = true
    var selectionCount = 0
    var selectionHasImages = false
    /// The latest images the AI added while the canvas was open.
    var arrival: Arrival?

    struct Arrival: Equatable {
        let id = UUID()
        let ids: [UUID]
    }
}

private struct InfiniteCanvasRepresentable: NSViewRepresentable {
    let controller: CanvasController
    let directory: URL

    func makeNSView(context: Context) -> InfiniteCanvasView {
        let view = InfiniteCanvasView(board: CanvasBoard(directory: directory))
        InfiniteCanvasView.controlView = view
        InfiniteCanvasView.controlViews.add(view)
        // A new project starts with nothing selected; the toolbar must not keep the old count.
        DispatchQueue.main.async { [weak controller] in
            controller?.selectionCount = 0
            controller?.selectionHasImages = false
        }
        view.onViewportChange = { [weak controller] zoom, isEmpty in
            guard let controller else { return }
            if controller.zoom != zoom { controller.zoom = zoom }
            if controller.isEmpty != isEmpty { controller.isEmpty = isEmpty }
        }
        view.onSelectionChange = { [weak controller, weak view] count in
            controller?.selectionCount = count
            controller?.selectionHasImages = view?.board.items.contains { !$0.isText && (view?.selection.contains($0.id) ?? false) } ?? false
        }
        view.onExternalAdd = { [weak controller] ids in controller?.arrival = .init(ids: ids) }
        controller.view = view
        return view
    }

    func updateNSView(_ view: InfiniteCanvasView, context: Context) {}
}
