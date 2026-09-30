import Foundation

@MainActor
final class BackgroundBatchRunner: ObservableObject {
    enum Status: Equatable {
        case idle
        case running
        case completed
        case failed(String)
        case cancelled
    }

    @Published private(set) var status: Status = .idle
    @Published private(set) var recentOutput = ""
    private var process: Process?
    private var outputPipe: Pipe?
    private var outputCheck: (directory: URL, variations: Int, before: BatchOutputValidator.Snapshot)?

    func start(cli: AgentCLI, prompt: String, photos: URL, desired: URL, output: URL,
               variations: Int) throws {
        guard let executable = cli.executableURL else {
            throw RunnerError.cliMissing(cli.rawValue)
        }
        let before = try BatchOutputValidator.capture(in: output, variations: variations)
        try launch(executable: executable, arguments: cli.backgroundArguments(
            prompt: prompt, photos: photos, desired: desired, output: output
        ), outputCheck: (output, variations, before))
    }

    func launch(executable: URL, arguments: [String],
                outputCheck: (directory: URL, variations: Int, before: BatchOutputValidator.Snapshot)? = nil) throws {
        guard status != .running else { return }

        let process = Process()
        process.executableURL = executable
        process.currentDirectoryURL = TerminalHandoff.projectDirectory
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            let text = String(decoding: data, as: UTF8.self)
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.recentOutput = String((self.recentOutput + text).suffix(3000))
            }
        }
        process.terminationHandler = { [weak self] finished in
            Task { @MainActor [weak self] in
                guard let self, self.process === finished else { return }
                let check = self.outputCheck
                self.outputPipe?.fileHandleForReading.readabilityHandler = nil
                self.outputPipe = nil
                self.process = nil
                self.outputCheck = nil
                if self.status == .cancelled { return }
                guard finished.terminationStatus == 0 else {
                    self.status = .failed(self.failureMessage)
                    return
                }
                if let check {
                    let result = await Task.detached(priority: .utility) {
                        Result { try BatchOutputValidator.validate(in: check.directory,
                                                                    variations: check.variations,
                                                                    after: check.before) }
                    }.value
                    guard self.status != .cancelled else { return }
                    switch result {
                    case .success: self.status = .completed
                    case .failure(let error): self.status = .failed(error.localizedDescription)
                    }
                } else {
                    self.status = .completed
                }
            }
        }

        recentOutput = ""
        status = .running
        self.process = process
        self.outputCheck = outputCheck
        outputPipe = pipe
        do {
            try process.run()
        } catch {
            pipe.fileHandleForReading.readabilityHandler = nil
            self.process = nil
            self.outputCheck = nil
            outputPipe = nil
            status = .failed(error.localizedDescription)
            throw error
        }
    }

    func cancel() {
        guard status == .running else { return }
        status = .cancelled
        process?.terminate()
    }

    private var failureMessage: String {
        guard let lastLine = recentOutput.split(whereSeparator: \.isNewline).last,
              !lastLine.isEmpty else { return "A IA encerrou com erro." }
        return String(lastLine)
    }

    enum RunnerError: LocalizedError {
        case cliMissing(String)

        var errorDescription: String? {
            switch self {
            case .cliMissing(let name): return "\(name.capitalized) não está instalado neste Mac."
            }
        }
    }
}

extension AgentCLI {
    var executableURL: URL? {
        let fileManager = FileManager.default
        let home = fileManager.homeDirectoryForCurrentUser
        let candidates = [home.appendingPathComponent(".local/bin/\(rawValue)"),
                          URL(fileURLWithPath: "/opt/homebrew/bin/\(rawValue)"),
                          URL(fileURLWithPath: "/usr/local/bin/\(rawValue)")]
        let pathCandidates = (ProcessInfo.processInfo.environment["PATH"] ?? "")
            .split(separator: ":")
            .map { URL(fileURLWithPath: String($0)).appendingPathComponent(rawValue) }
        return (candidates + pathCandidates).first { fileManager.isExecutableFile(atPath: $0.path) }
    }

    func backgroundArguments(prompt: String, photos: URL, desired: URL, output: URL) -> [String] {
        switch self {
        case .claude:
            // Without prompts only edits are accepted; the renderer is the one command the batch must run.
            let renderer = TerminalHandoff.projectDirectory.appendingPathComponent(".bulk-maker/bin/carousel-render").path
            return ["-p", prompt] + AgentSession.claudeCostFlags + ["--strict-mcp-config", "--permission-mode", "acceptEdits", "--permission-prompts", "none",
                    "--allowedTools", "Bash(.bulk-maker/bin/carousel-render:*)", "Bash(\(renderer):*)",
                    "--add-dir", photos.path, desired.path, output.path]
        case .codex:
            return ["--ask-for-approval", "never"] + AgentSession.codexCostFlags + ["exec", "--sandbox", "workspace-write",
                    "--cd", TerminalHandoff.projectDirectory.path,
                    "--add-dir", output.path, "--skip-git-repo-check", prompt]
        }
    }
}
