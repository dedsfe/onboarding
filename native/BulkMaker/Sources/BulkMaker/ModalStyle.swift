import SwiftUI

// One look for every modal, taken from the visual-direction editor:
// dimmed blurred app behind, a dark Liquid Glass panel, white type and the white ✓ to finish.

/// The app behind a modal: dimmed and blurred; a click outside closes it.
struct ModalBackdrop: View {
    let close: () -> Void

    var body: some View {
        Rectangle().fill(.black.opacity(0.45))
            .background(.ultraThinMaterial)
            .onTapGesture(perform: close)
    }
}

/// Title on the left, the white ✓ that closes the modal on the right; an optional line below the title
/// and optional controls (like a search field) just before the ✓.
struct ModalHeader<Accessory: View>: View {
    let title: String
    var subtitle: String? = nil
    var subtitleIsError = false
    let done: () -> Void
    @ViewBuilder var accessory: Accessory

    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 17, weight: .semibold))
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(subtitleIsError ? Color.red : .white.opacity(0.55))
                        .lineLimit(1)
                        .contentTransition(.opacity)
                }
            }
            .animation(.easeOut(duration: 0.2), value: subtitle)
            Spacer(minLength: 16)
            accessory
            Button(action: done) {
                Image(systemName: "checkmark").font(.system(size: 13, weight: .bold))
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(.white))
                    .foregroundStyle(.black)
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.defaultAction)
            .help("Concluído")
        }
        .padding(.horizontal, 18).padding(.top, 18).padding(.bottom, 14)
    }
}

extension ModalHeader where Accessory == EmptyView {
    init(title: String, subtitle: String? = nil, subtitleIsError: Bool = false, done: @escaping () -> Void) {
        self.init(title: title, subtitle: subtitle, subtitleIsError: subtitleIsError, done: done) { EmptyView() }
    }
}

extension View {
    /// The dark Liquid Glass panel every modal sits on.
    func modalPanel() -> some View {
        glassEffect(.regular.tint(.black.opacity(0.3)), in: .rect(cornerRadius: 26))
            .environment(\.colorScheme, .dark)
            .foregroundStyle(.white)
    }

    /// Entry motion shared by every modal: a small scale-up with a fade.
    func modalAppearance(_ appeared: Bool) -> some View {
        scaleEffect(appeared ? 1 : 0.97).opacity(appeared ? 1 : 0)
    }

    /// Text-field look inside a modal panel.
    func modalField() -> some View {
        font(.system(size: 14, weight: .medium))
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: 12).fill(.white.opacity(0.08)))
    }
}

extension Animation {
    /// How modals come in.
    static let modalAppear = Animation.spring(response: 0.45, dampingFraction: 0.85)
}
