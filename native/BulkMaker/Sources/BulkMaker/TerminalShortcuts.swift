import AppKit
import SwiftUI

/// On the batch page ⌘S opens or closes the terminal; while it is open ⌘T opens a new tab and ⌘W closes the current one.
/// A local key monitor sees them before SwiftTerm (the first responder) or the window's Close item.
struct TerminalShortcuts: ViewModifier {
    let isAvailable: Bool
    let isOpen: Bool
    let tabs: TerminalTabs
    let toggle: () -> Void
    @State private var box = MonitorBox()

    func body(content: Content) -> some View {
        content
            .onChange(of: [isAvailable, isOpen], initial: true) { _, _ in
                box.monitor = isAvailable ? NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [tabs, isOpen, toggle] event in
                    let key = event.charactersIgnoringModifiers?.lowercased()
                    guard event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command else { return event }
                    switch key {
                    case "s": MainActor.assumeIsolated { toggle() }
                    case "t" where isOpen: MainActor.assumeIsolated { tabs.open() }
                    case "w" where isOpen: MainActor.assumeIsolated { tabs.close(tabs.selected) }
                    default: return event
                    }
                    return nil
                } : nil
            }
            .onDisappear { box.monitor = nil }
    }

    final class MonitorBox {
        var monitor: Any? {
            didSet { if let oldValue { NSEvent.removeMonitor(oldValue) } }
        }
        deinit { if let monitor { NSEvent.removeMonitor(monitor) } }
    }
}
