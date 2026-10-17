import SwiftUI

/// Shared empty-state copy. Status belongs to the task, with no decorative character.
struct AppStatusMessage: View {
    let title: String
    var detail: String? = nil
    var stacked = false

    var body: some View {
        VStack(alignment: stacked ? .center : .leading, spacing: 6) {
            Text(title).font(.system(size: stacked ? 18 : 14, weight: .semibold))
            if let detail {
                Text(detail).font(.system(size: stacked ? 14 : 12))
                    .foregroundStyle(.secondary)
            }
        }
        .multilineTextAlignment(stacked ? .center : .leading)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
        .allowsHitTesting(false)
    }
}

/// Native progress keeps image generation visible after removing the character.
struct ImageGenerationStatus: View {
    let compact: Bool

    var body: some View {
        HStack(spacing: 12) {
            ProgressView().controlSize(.small)
            Text("Criando suas imagens")
                .font(.system(size: compact ? 14 : 16, weight: .medium))
        }
        .padding(.horizontal, 20).padding(.vertical, 16)
        .glassEffect(.regular, in: .rect(cornerRadius: 18))
        .foregroundStyle(.white)
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("IA gerando imagens")
    }
}
