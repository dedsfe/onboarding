import SwiftUI

/// "Pesquisar no TikTok" right on the canvas: a term, one click, and the niche's viral carousels land here.
/// The same research the terminal's `pesquisar-tiktok` runs, for someone who never opens the terminal.
struct CanvasResearchButton: View {
    private enum Phase: Equatable { case idle, typing, running(String), done(String), failed(String) }

    /// A narrow canvas (terminal open) gets the icon alone, so the bar's other controls keep their room.
    var compact = false
    @State private var phase: Phase = .idle
    @State private var term = ""
    @FocusState private var focused: Bool

    /// The product's first search from onboarding, so the field is never a blank guess.
    private var suggestion: String {
        let profile = ProjectStore.shared.current.project.profile
        return profile?.keywords.first ?? profile?.subNiches.first ?? "seu nicho"
    }

    var body: some View {
        HStack(spacing: 8) {
            switch phase {
            case .idle:
                Button { phase = .typing; focused = true } label: {
                    if compact { Image(systemName: "sparkle.magnifyingglass") }
                    else { Label("Pesquisar no TikTok", systemImage: "sparkle.magnifyingglass") }
                }
                .buttonStyle(AppButtonStyle(kind: compact ? .icon : .secondary))
                .help("Acha os carrosséis que viralizam no seu nicho mostrando um produto e traz pro canvas")
            case .typing:
                TextField(suggestion, text: $term)
                    .textFieldStyle(.plain).font(.system(size: 13))
                    .frame(width: compact ? 130 : 200)
                    .focused($focused)
                    .onSubmit(start)
                    .onExitCommand { phase = .idle }
                Button("Buscar", action: start).buttonStyle(.appPrimary).controlSize(.small)
                Button { phase = .idle } label: { Image(systemName: "xmark") }
                    .buttonStyle(.appIcon).controlSize(.small).help("Fechar")
            case .running(let query):
                ProgressView().controlSize(.small)
                Text(compact ? "Pesquisando…" : "Pesquisando \"\(query)\"… leva uns 3 minutos").font(.system(size: 13)).lineLimit(1)
            case .done(let message), .failed(let message):
                Image(systemName: phase == .done(message) ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                    .foregroundStyle(phase == .done(message) ? .green : .orange)
                Text(message).font(.system(size: 13)).lineLimit(2).frame(maxWidth: compact ? 180 : 420, alignment: .leading)
                Button { phase = .idle } label: { Image(systemName: "xmark") }
                    .buttonStyle(.appIcon).controlSize(.small).help("Fechar")
            }
        }
        .padding(.leading, phase == .idle ? 0 : 14).padding(.trailing, phase == .idle ? 0 : 6)
        .padding(.vertical, phase == .idle ? 0 : 4)
        .background { if phase != .idle { Capsule().fill(.black.opacity(0.35)) } }
        .glassEffect(phase == .idle ? .identity : .regular, in: .capsule)
        .animation(.snappy(duration: 0.25), value: phase)
    }

    private func start() {
        let query = term.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? suggestion : term.trimmingCharacters(in: .whitespacesAndNewlines)
        phase = .running(query)
        Task {
            do {
                let found = try await TikTokResearcher.shared.researchFromCanvas(query)
                phase = .done(found == 1 ? "1 referência nova no canvas." : "\(found) referências novas no canvas.")
            } catch {
                let message = (error as? TikTokResearcher.Failure)?.message ?? error.localizedDescription
                phase = .failed(message.prefix(1).uppercased() + message.dropFirst())
            }
            term = ""
        }
    }
}
