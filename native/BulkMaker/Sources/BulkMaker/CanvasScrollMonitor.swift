import AppKit
import SwiftUI

/// Lets a trackpad pan the canvas in both axes without imposing scroll bounds.
struct CanvasScrollMonitor: NSViewRepresentable {
    /// Off while something sits on top of the canvas (like the design editor), so its own scroll views work.
    var isEnabled = true
    let onScroll: (CGSize) -> Void

    func makeNSView(context: Context) -> MonitoringView {
        let view = MonitoringView()
        view.onScroll = onScroll
        view.isEnabled = isEnabled
        view.monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak view] event in
            guard let view, view.isEnabled, let window = view.window, event.window === window,
                  view.bounds.contains(view.convert(event.locationInWindow, from: nil)) else {
                return event
            }
            view.onScroll?(CGSize(width: event.scrollingDeltaX, height: event.scrollingDeltaY))
            return nil
        }
        return view
    }

    func updateNSView(_ view: MonitoringView, context: Context) {
        view.onScroll = onScroll
        view.isEnabled = isEnabled
    }

    static func dismantleNSView(_ view: MonitoringView, coordinator: ()) {
        if let monitor = view.monitor { NSEvent.removeMonitor(monitor) }
        view.monitor = nil
    }

    final class MonitoringView: NSView {
        var monitor: Any?
        var onScroll: ((CGSize) -> Void)?
        var isEnabled = true

        override func hitTest(_ point: NSPoint) -> NSView? { nil }
    }
}
