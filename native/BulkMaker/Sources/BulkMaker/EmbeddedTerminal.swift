import AppKit
import SwiftTerm
import SwiftUI

enum AgentCLI: String {
    case claude
    case codex

    func shellCommand(prompt: String) -> String {
        "exec \(rawValue) \(TerminalHandoff.shellQuote(prompt))"
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
    private var pendingCLI: AgentCLI?
    private var pendingPrompt = ""

    init(cli: AgentCLI? = nil, prompt: String = "") {
        title = cli.map { $0.rawValue.capitalized } ?? "zsh"
        pendingCLI = cli
        pendingPrompt = prompt
    }

    func terminalView() -> LocalProcessTerminalView {
        if let view { return view }
        let view = LocalProcessTerminalView(frame: .zero)
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
        let cli = pendingCLI
        let prompt = pendingPrompt
        pendingCLI = nil
        pendingPrompt = ""
        self.view = view
        view.startProcess(executable: "/bin/zsh",
                          args: cli.map { ["-ilc", $0.shellCommand(prompt: prompt)] } ?? ["-il"],
                          environment: environment.map { "\($0.key)=\($0.value)" },
                          execName: "-zsh",
                          currentDirectory: TerminalHandoff.projectDirectory.path)
        if cli == nil {
            view.feed(text: "The Carousel Maker · contexto: .bulk-maker/contexto.md\r\nUse o + para abrir Claude ou Codex já com o contexto do lote.\r\n\r\n")
        }
        return view
    }

    func launch(_ cli: AgentCLI, prompt: String) {
        pendingCLI = cli
        pendingPrompt = prompt
        restart()
    }

    func restart() {
        view?.terminate()
        view = nil
        generation += 1
    }

    nonisolated func sizeChanged(source: LocalProcessTerminalView, newCols: Int, newRows: Int) {}
    nonisolated func setTerminalTitle(source: LocalProcessTerminalView, title: String) {}
    nonisolated func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    nonisolated func processTerminated(source: TerminalView, exitCode: Int32?) {
        Task { @MainActor in
            if source === self.view { self.onExit?(self) }
        }
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
