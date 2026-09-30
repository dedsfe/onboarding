import AppKit
import SwiftUI

/// The Canvas page: an infinite board of images over the app wallpaper, with zoom controls.
struct CanvasPage: View {
    @State private var controller = CanvasController()

    var body: some View {
        ZStack {
            InfiniteCanvasRepresentable(controller: controller)
            if controller.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "photo.on.rectangle.angled").font(.system(size: 30, weight: .medium))
                    Text("Cole (⌘V) ou arraste imagens pra cá").font(.system(size: 17, weight: .semibold))
                }
                .foregroundStyle(.primary)
                .padding(.horizontal, 28).padding(.vertical, 22)
                .glassEffect(.regular, in: .rect(cornerRadius: 24))
                .allowsHitTesting(false)
            }
        }
        .overlay(alignment: .bottomTrailing) { zoomControls.padding(20) }
        .overlay(alignment: .bottomLeading) { importButton.padding(20) }
    }

    private var importButton: some View {
        Button { controller.view?.importImages(nil) } label: {
            Label("Importar", systemImage: "plus")
                .font(.system(size: 13, weight: .semibold))
                .padding(.horizontal, 8).frame(height: 28)
        }
        .buttonStyle(.plain)
        .padding(4)
        .glassEffect(.regular, in: .capsule)
        .help("Escolher imagens do Mac")
    }

    private var zoomControls: some View {
        HStack(spacing: 2) {
            Button { controller.view?.fitAll() } label: { Image(systemName: "scope").frame(width: 28, height: 28) }
                .help("Ver tudo (⌘1)")
                .keyboardShortcut("1", modifiers: .command)
            Button { controller.view?.zoomOut() } label: { Image(systemName: "minus").frame(width: 28, height: 28) }
                .help("Diminuir (⌘-)")
                .keyboardShortcut("-", modifiers: .command)
            Button { controller.view?.actualSize() } label: {
                Text("\(Int((controller.zoom * 100).rounded()))%").monospacedDigit().frame(minWidth: 48).frame(height: 28)
            }
            .help("Tamanho real (⌘0)")
            .keyboardShortcut("0", modifiers: .command)
            Button { controller.view?.zoomIn() } label: { Image(systemName: "plus").frame(width: 28, height: 28) }
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
        controller.view = view
        return view
    }

    func updateNSView(_ view: InfiniteCanvasView, context: Context) {}
}
