import AppKit
import SwiftUI

/// The Canvas page: an infinite board of images on frosted glass over the app wallpaper,
/// with a selection toolbar and zoom controls.
struct CanvasPage: View {
    @State private var controller = CanvasController()
    /// 0 = wallpaper sharp like the other pages, 1 = fully frosted; the user picks with the slider.
    @AppStorage("canvasBackdropBlur") private var backdropBlur = 1.0

    var body: some View {
        ZStack {
            // Frosted wallpaper: the page keeps the app's look while images stay the loudest thing on it.
            Rectangle().fill(.ultraThinMaterial)
                .overlay(Color.black.opacity(0.28))
                .opacity(backdropBlur)
                .ignoresSafeArea()
            InfiniteCanvasRepresentable(controller: controller)
            if controller.isEmpty {
                emptyState
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
            }
        }
        .overlay(alignment: .bottom) {
            HStack(alignment: .bottom) {
                HStack(spacing: 10) {
                    importButton
                    blurControl
                }
                Spacer(minLength: 12)
                if controller.selectionCount > 0 {
                    selectionBar
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                Spacer(minLength: 12)
                zoomControls
            }
            .padding(20)
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.82), value: controller.selectionCount > 0)
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: controller.isEmpty)
        .environment(\.colorScheme, .dark)
    }

    private var emptyState: some View {
        VStack(spacing: 18) {
            Image(systemName: "photo.stack")
                .font(.system(size: 40, weight: .medium))
                .symbolRenderingMode(.hierarchical)
            Text("Solte suas imagens aqui").font(.system(size: 22, weight: .bold))
            HStack(spacing: 8) {
                hintChip("⌘V", "Colar")
                hintChip("arrow.down.doc", "Arrastar do Finder", isSymbol: true)
                hintChip("plus", "Importar", isSymbol: true)
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 36).padding(.vertical, 30)
        .glassEffect(.regular, in: .rect(cornerRadius: 28))
        .allowsHitTesting(false)
    }

    private func hintChip(_ key: String, _ title: String, isSymbol: Bool = false) -> some View {
        HStack(spacing: 6) {
            if isSymbol { Image(systemName: key) } else { Text(key).monospaced() }
            Text(title)
        }
        .font(.system(size: 14, weight: .semibold))
        .padding(.horizontal, 12).frame(height: 32)
        .background(Capsule().fill(.white.opacity(0.12)))
    }

    /// Frosted ↔ sharp wallpaper behind the canvas.
    private var blurControl: some View {
        HStack(spacing: 8) {
            Button { withAnimation(.easeOut(duration: 0.25)) { backdropBlur = backdropBlur > 0 ? 0 : 1 } } label: {
                Image(systemName: backdropBlur > 0 ? "drop.halffull" : "drop")
                    .font(.system(size: 14, weight: .semibold))
                    .frame(width: 26, height: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(backdropBlur > 0 ? "Desligar o borrão do fundo" : "Ligar o borrão do fundo")
            Slider(value: $backdropBlur, in: 0...1)
                .frame(width: 110)
                .controlSize(.small)
                .help("Borrão do fundo")
        }
        .padding(.leading, 6).padding(.trailing, 12)
        .padding(4)
        .glassEffect(.regular, in: .capsule)
    }

    private var importButton: some View {
        Button { controller.view?.importImages(nil) } label: {
            Label("Importar", systemImage: "plus")
                .font(.system(size: 13, weight: .semibold))
                .padding(.horizontal, 10).frame(height: 30)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .padding(4)
        .glassEffect(.regular.interactive(), in: .capsule)
        .help("Escolher imagens do Mac")
    }

    /// What can be done with the selection, one click away.
    private var selectionBar: some View {
        HStack(spacing: 2) {
            Text(controller.selectionCount == 1 ? "1 imagem" : "\(controller.selectionCount) imagens")
                .font(.system(size: 13, weight: .semibold))
                .monospacedDigit()
                .padding(.horizontal, 12)
            Divider().frame(height: 18)
            toolbarButton("doc.on.doc", "Copiar (⌘C)") { controller.view?.copy(nil) }
            toolbarButton("plus.square.on.square", "Duplicar (⌘D)") { controller.view?.duplicate(nil) }
            toolbarButton("square.3.layers.3d.top.filled", "Trazer pra frente") { controller.view?.bringToFront(nil) }
            toolbarButton("plus.magnifyingglass", "Aproximar") { controller.view?.focusSelection(nil) }
            toolbarButton("folder", "Mostrar no Finder") { controller.view?.revealSelection(nil) }
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
}

private struct InfiniteCanvasRepresentable: NSViewRepresentable {
    let controller: CanvasController

    func makeNSView(context: Context) -> InfiniteCanvasView {
        let view = InfiniteCanvasView(board: CanvasBoard())
        view.onViewportChange = { [weak controller] zoom, isEmpty in
            guard let controller else { return }
            if controller.zoom != zoom { controller.zoom = zoom }
            if controller.isEmpty != isEmpty { controller.isEmpty = isEmpty }
        }
        view.onSelectionChange = { [weak controller] count in controller?.selectionCount = count }
        controller.view = view
        return view
    }

    func updateNSView(_ view: InfiniteCanvasView, context: Context) {}
}
