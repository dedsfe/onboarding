import AppKit
import SwiftTerm
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
            guard let view else { return event }
            return view.handleScroll(event)
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

        func handleScroll(_ event: NSEvent) -> NSEvent? {
            guard isEnabled, let window, event.window === window,
                  bounds.contains(convert(event.locationInWindow, from: nil)) else {
                return event
            }
            // Local monitors run before normal hit testing, even when another view covers us.
            // Let native/SwiftUI scroll views receive their own wheel and trackpad events.
            if let content = window.contentView {
                var target = content.hitTest(content.convert(event.locationInWindow, from: nil))
                while let view = target {
                    if view is NSScrollView || view is TerminalView { return event }
                    target = view.superview
                }
            }
            onScroll?(CGSize(width: event.scrollingDeltaX, height: event.scrollingDeltaY))
            return nil
        }

        override func hitTest(_ point: NSPoint) -> NSView? { nil }
    }
}
