import SwiftUI

// One set of buttons for the whole app, in the modals' look: pills on dark glass, white type,
// and a single white pill for the main action (like the white ✓ that closes a modal).
//
//   Button("Pesquisar") { … }.buttonStyle(.appPrimary)   // the one main action of a screen or modal
//   Button("Cancelar") { … }.buttonStyle(.appSecondary)   // everything else with a word
//   Button { … } label: { Image(systemName: "xmark") }.buttonStyle(.appIcon)   // icon only
//
// Same height everywhere (32 pt, 26 pt with `.controlSize(.small)`), so rows of buttons line up.

struct AppButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, icon }
    var kind: Kind

    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.controlSize) private var controlSize

    private var height: CGFloat { controlSize == .small || controlSize == .mini ? 26 : 32 }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: controlSize == .small ? 12 : 13, weight: kind == .primary ? .semibold : .medium))
            .lineLimit(1)
            .padding(.horizontal, kind == .icon ? 0 : (controlSize == .small ? 10 : 14))
            .frame(minWidth: kind == .icon ? height : nil, minHeight: height, maxHeight: height)
            .foregroundStyle(kind == .primary ? Color.black : Color.white)
            .background {
                switch kind {
                case .primary: Capsule().fill(.white)
                case .secondary, .icon: Capsule().fill(.white.opacity(configuration.isPressed ? 0.22 : 0.12))
                }
            }
            .overlay {
                if kind != .primary { Capsule().strokeBorder(.white.opacity(0.10)) }
            }
            .contentShape(Capsule())
            .opacity(isEnabled ? (configuration.isPressed && kind == .primary ? 0.85 : 1) : 0.4)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == AppButtonStyle {
    static var appPrimary: AppButtonStyle { AppButtonStyle(kind: .primary) }
    static var appSecondary: AppButtonStyle { AppButtonStyle(kind: .secondary) }
    static var appIcon: AppButtonStyle { AppButtonStyle(kind: .icon) }
}
