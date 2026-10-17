import AppKit
import CarouselEngine
import Combine
import SwiftTerm
import SwiftUI

enum AgentCLI: String {
    case claude
    case codex

    func shellCommand(prompt: String) -> String {
        // No MCP: the AI draws through .bulk-maker/bin/carousel-render in the shell, so no node/Chrome
        // renderer is started. --strict-mcp-config without a config also skips the user's global servers.
        // The session starts already knowing the app (sessao.md) and the live batch state (estado-hook);
        // forgetting what was "seen" makes the first message carry the full state.
        let workspace = TerminalHandoff.projectDirectory.appendingPathComponent(".bulk-maker", isDirectory: true)
        let reset = "rm -f \(TerminalHandoff.shellQuote(workspace.appendingPathComponent(".estado-visto.md").path)); "
        switch self {
        case .claude:
            let instructions = workspace.appendingPathComponent("sessao.md").path
            return reset + "exec claude \(AgentSession.claudeCostFlags.map(TerminalHandoff.shellQuote).joined(separator: " ")) --strict-mcp-config --append-system-prompt-file \(TerminalHandoff.shellQuote(instructions)) "
                + "--settings \(TerminalHandoff.shellQuote(AgentSession.claudeSettings(workspace: workspace))) \(TerminalHandoff.shellQuote(prompt))"
        case .codex:
            let quoted = String(decoding: (try? JSONEncoder().encode(AgentSession.codexInstructions)) ?? Data(), as: UTF8.self)
            let home = TerminalHandoff.shellQuote(AgentSession.codexHome().path)
            return reset + "CODEX_HOME=\(home) exec codex --no-alt-screen \(AgentSession.codexCostFlags.map(TerminalHandoff.shellQuote).joined(separator: " ")) -c \(TerminalHandoff.shellQuote("developer_instructions=" + quoted)) \(TerminalHandoff.shellQuote(prompt))"
        }
    }
}

/// Keeps one zsh session alive while the panel is hidden, so closing the panel does not kill the CLI.
@MainActor
final class TerminalSession: NSObject, ObservableObject, Identifiable, LocalProcessTerminalViewDelegate {
    let id = UUID()
    let title: String
    var onExit: ((TerminalSession) -> Void)?
    private(set) var view: LocalProcessTerminalView?
    @Published private(set) var generation = 0
    /// Changes on restart, so an interrupted run cannot leave the generation indicator running in a new session.
    private(set) var activityID = UUID()
    private var pendingCLI: AgentCLI?
    /// The CLI this tab is running, so a failed start can say which one to install.
    private var runningCLI: AgentCLI?
    private var pendingPrompt = ""
    private var licenseObservation: AnyCancellable?
    private var licenseWasAllowed = false

    init(cli: AgentCLI? = nil, prompt: String = "") {
        // The tab names the model, so comparing Sonnet and Opus side by side stays readable.
        title = cli.map { $0 == .claude ? "Claude \(ClaudeModel.current.label)" : $0.rawValue.capitalized } ?? "zsh"
        pendingCLI = cli
        pendingPrompt = prompt
        super.init()
        licenseWasAllowed = License.shared.canUse(.useAI)
        licenseObservation = License.shared.objectWillChange.sink { [weak self] _ in
            Task { @MainActor [weak self] in self?.licenseChanged() }
        }
    }

    func terminalView() -> LocalProcessTerminalView {
        if let view { return view }
        let view = ScrollableTerminalView(frame: .zero)
        view.getTerminal().changeHistorySize(10_000)
        view.processDelegate = self
        view.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        view.nativeBackgroundColor = .textBackgroundColor
        view.nativeForegroundColor = .labelColor
        view.caretColor = .controlAccentColor
        view.optionAsMetaKey = true

        var environment = ProcessInfo.processInfo.environment
        environment["TERM"] = "xterm-256color"
        environment["COLORTERM"] = "truecolor"
        environment["LANG"] = environment["LANG"] ?? "pt_BR.UTF-8"
        environment[CanvasFolder.generationSessionKey] = activityID.uuidString
        let cli = pendingCLI
        let prompt = pendingPrompt
        pendingCLI = nil
        pendingPrompt = ""
        self.view = view
        guard License.shared.canUse(.useAI) else {
            view.feed(text: "Ative a licença ou comece o teste grátis para usar a IA.\r\nSeus arquivos continuam disponíveis para abrir e exportar.\r\n")
            return view
        }
        runningCLI = cli
        view.startProcess(executable: "/bin/zsh",
                          args: cli.map { ["-ilc", $0.shellCommand(prompt: prompt)] } ?? ["-il"],
                          environment: environment.map { "\($0.key)=\($0.value)" },
                          execName: "-zsh",
                          currentDirectory: TerminalHandoff.projectDirectory.path)
        if cli == nil {
            view.feed(text: "The Carousel Maker\r\nUse o + para abrir Claude ou Codex já por dentro do lote.\r\n\r\n")
        }
        return view
    }

    func launch(_ cli: AgentCLI, prompt: String) {
        guard License.shared.require(.useAI) else { return }
        pendingCLI = cli
        pendingPrompt = prompt
        restart()
    }

    func restart() {
        let previous = view
        view = nil
        previous?.terminate()
        activityID = UUID()
        generation += 1
    }

    private func licenseChanged() {
        let allowed = License.shared.canUse(.useAI)
        guard allowed != licenseWasAllowed else { return }
        licenseWasAllowed = allowed
        // Stop an already running CLI when access expires; don't wait for another button click.
        // Detach before terminate so its exit callback cannot close a replacement tab.
        let previous = view
        view = nil
        previous?.terminate()
        activityID = UUID()
        generation += 1
    }

    nonisolated func sizeChanged(source: LocalProcessTerminalView, newCols: Int, newRows: Int) {}
    nonisolated func setTerminalTitle(source: LocalProcessTerminalView, title: String) {}
    nonisolated func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    nonisolated func processTerminated(source: TerminalView, exitCode: Int32?) {
        Task { @MainActor in
            guard source === self.view else { return }
            // Claude Code or Codex that failed to start (not installed, not logged in): closing the tab would
            // hide the reason. Keep it open with what to do; a normal exit (code 0) still closes it.
            if let cli = self.runningCLI, let code = exitCode, code != 0, code < 128 {  // 128+: Ctrl-C or a signal, on purpose
                self.runningCLI = nil
                self.view?.feed(text: "\r\n\r\n" + Self.startFailure(cli, code: code).replacingOccurrences(of: "\n", with: "\r\n") + "\r\n")
                return
            }
            self.onExit?(self)
        }
    }

    nonisolated static func startFailure(_ cli: AgentCLI, code: Int32) -> String {
        let name = cli == .claude ? "Claude Code" : "Codex"
        let install = cli == .claude ? "npm install -g @anthropic-ai/claude-code   (depois rode: claude)"
            : "npm install -g @openai/codex   (depois rode: codex)"
        let reason = code == 127 ? "não está instalado neste Mac" : "fechou com erro (código \(code))"
        return """
        O \(name) \(reason).
        Pra instalar, abra uma aba zsh com o + e rode:
          \(install)
        Entre com a sua conta quando ele pedir e abra o \(name) de novo pelo +.
        Pode fechar esta aba.
        """
    }
}

/// Chrome-style tabs: each tab owns its own shell, and closing the last one opens a fresh zsh.
@MainActor
final class TerminalTabs: ObservableObject {
    @Published private(set) var sessions: [TerminalSession] = []
    @Published var selectedID: UUID?

    init() { open() }

    var selected: TerminalSession {
        sessions.first { $0.id == selectedID } ?? sessions[0]
    }

    func open(_ cli: AgentCLI? = nil, prompt: String = "") {
        if cli != nil, !License.shared.require(.useAI) { return }
        let session = TerminalSession(cli: cli, prompt: prompt)
        session.onExit = { [weak self] in self?.close($0) }
        sessions.append(session)
        selectedID = session.id
    }

    func close(_ session: TerminalSession) {
        guard let index = sessions.firstIndex(where: { $0.id == session.id }) else { return }
        session.onExit = nil
        session.restart()
        sessions.remove(at: index)
        if sessions.isEmpty { open(); return }
        if selectedID == session.id { selectedID = sessions[min(index, sessions.count - 1)].id }
    }
}

struct EmbeddedTerminal: NSViewRepresentable {
    @ObservedObject var session: TerminalSession

    func makeNSView(context: Context) -> NSView {
        let container = NSView()
        attach(to: container)
        return container
    }

    func updateNSView(_ container: NSView, context: Context) {
        if container.subviews.first !== session.view || session.view == nil { attach(to: container) }
    }

    private func attach(to container: NSView) {
        container.subviews.forEach { $0.removeFromSuperview() }
        let terminal = session.terminalView()
        terminal.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(terminal)
        NSLayoutConstraint.activate([
            terminal.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 10),
            terminal.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -4),
            terminal.topAnchor.constraint(equalTo: container.topAnchor, constant: 8),
            terminal.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -8)
        ])
        DispatchQueue.main.async { terminal.window?.makeFirstResponder(terminal) }
    }
}

/// Routes wheel gestures to the terminal or its running full-screen application.
class ScrollableTerminalView: LocalProcessTerminalView {
    private var pendingWheelLines: CGFloat = 0
    private var wheelMonitor: Any?

    override init(frame: NSRect) {
        super.init(frame: frame)
        installWheelMonitor()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        installWheelMonitor()
    }

    deinit {
        if let wheelMonitor { NSEvent.removeMonitor(wheelMonitor) }
    }

    private func installWheelMonitor() {
        // SwiftTerm's macOS wheel handler is not open to overrides. Route the native event
        // before it reaches that handler; hidden/detached tabs cannot intercept another tab.
        wheelMonitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
            guard let self, let window = self.window, event.window === window,
                  !self.isHiddenOrHasHiddenAncestor,
                  self.bounds.contains(self.convert(event.locationInWindow, from: nil)),
                  let content = window.contentView,
                  let hit = content.hitTest(content.convert(event.locationInWindow, from: nil)),
                  hit === self || hit.isDescendant(of: self) else { return event }
            self.handleScrollWheel(event)
            return nil
        }
    }

    func handleScrollWheel(_ event: NSEvent) {
        let terminal = getTerminal()
        let reportsWheel = allowMouseReporting && terminal.mouseMode != .off && terminal.mouseMode != .x10
        // Shift explicitly requests local scrollback, including when a CLI captures the mouse.
        guard !event.modifierFlags.contains(.shift), reportsWheel || terminal.isCurrentBufferAlternate else {
            pendingWheelLines = 0
            super.scrollWheel(with: event)
            return
        }
        if event.phase == .began { pendingWheelLines = 0 }
        let cellHeight = max(1, getOptimalFrameSize().height / CGFloat(max(1, terminal.rows)))
        let delta = event.scrollingDeltaY
        guard delta != 0 else { return }
        if pendingWheelLines * delta < 0 { pendingWheelLines = 0 }
        pendingWheelLines += event.hasPreciseScrollingDeltas ? delta / cellHeight : delta
        let lines = min(20, Int(abs(pendingWheelLines)))
        guard lines > 0 else { return }
        let upward = pendingWheelLines > 0
        pendingWheelLines -= CGFloat(lines) * (upward ? 1 : -1)
        if reportsWheel {
            let point = convert(event.locationInWindow, from: nil)
            let cellWidth = max(1, ("W" as NSString).size(withAttributes: [.font: font]).width)
            let x = min(max(0, Int(point.x / cellWidth)), terminal.cols - 1)
            let pixelY = max(0, bounds.height - point.y)
            let y = min(max(0, Int(pixelY / cellHeight)), terminal.rows - 1)
            let flags = terminal.encodeButton(button: upward ? 4 : 5, release: false,
                shift: false, meta: event.modifierFlags.contains(.option), control: event.modifierFlags.contains(.control))
            for _ in 0..<lines {
                terminal.sendEvent(buttonFlags: flags, x: x, y: y,
                                   pixelX: max(0, Int(point.x)), pixelY: Int(pixelY))
            }
        } else {
            // Alternate buffers have no scrollback: let the application navigate its own pages.
            if upward { pageUp() } else { pageDown() }
        }
    }
}
