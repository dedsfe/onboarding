import AppKit
import SwiftUI

/// ⌘T opens a new terminal tab and ⌘W closes the current one while the batch terminal is showing.
/// A local key monitor sees them before SwiftTerm (the first responder) or the window's Close item.
struct TerminalShortcuts: ViewModifier {
    let isActive: Bool
    let tabs: TerminalTabs
    @State private var box = MonitorBox()

    func body(content: Content) -> some View {
        content
            .onChange(of: isActive, initial: true) { _, active in
                box.monitor = active ? NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [tabs] event in
                    let key = event.charactersIgnoringModifiers?.lowercased()
                    guard event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command,
                          key == "t" || key == "w" else { return event }
                    MainActor.assumeIsolated { key == "t" ? tabs.open() : tabs.close(tabs.selected) }
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
