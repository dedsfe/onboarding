import SwiftUI

struct DesignPreferences: Equatable {
    static let titleFontKey = "designTitleFont"
    static let bodyFontKey = "designBodyFont"
    static let titleWeightKey = "designTitleWeight"
    static let borderKey = "designBorders"
    static let backgroundKey = "designBackgrounds"

    var titleFont = ""
    var bodyFont = ""
    var titleWeight = "auto"
    var borders = "auto"
    var backgrounds = "auto"

    static var current: Self {
        let defaults = UserDefaults.standard
        return Self(
            titleFont: defaults.string(forKey: titleFontKey) ?? "",
            bodyFont: defaults.string(forKey: bodyFontKey) ?? "",
            titleWeight: defaults.string(forKey: titleWeightKey) ?? "auto",
            borders: defaults.string(forKey: borderKey) ?? "auto",
            backgrounds: defaults.string(forKey: backgroundKey) ?? "auto"
        )
    }

    var instructions: String {
        let title = titleFont.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = bodyFont.trimmingCharacters(in: .whitespacesAndNewlines)
        let weightInstruction: String
        switch titleWeight {
        case "light": weightInstruction = "títulos leves (400–500), se a leitura permitir"
        case "balanced": weightInstruction = "títulos com peso médio (600–700)"
        case "strong": weightInstruction = "títulos fortes (700–800), sem colocar o corpo todo em negrito"
        default: weightInstruction = "peso dos títulos derivado das referências"
        }
        let borderInstruction: String
        switch borders {
        case "none": borderInstruction = "sem bordas decorativas; use espaço e contraste"
        case "subtle": borderInstruction = "bordas discretas, em geral 1–2 px, apenas onde organizarem o conteúdo"
        case "defined": borderInstruction = "bordas definidas, em geral 2–3 px, coerentes entre slides"
        default: borderInstruction = "bordas somente se a direção visual pedir"
        }
        let backgroundInstruction: String
        switch backgrounds {
        case "photos": backgroundInstruction = "priorize as fotos de origem; não use a biblioteca local sem necessidade"
        case "library": backgroundInstruction = "considere a biblioteca local quando uma imagem complementar fizer sentido; confirme o conteúdo da pasta"
        case "plain": backgroundInstruction = "prefira superfícies simples; fotos apenas quando essenciais à narrativa"
        default: backgroundInstruction = "escolha fundos conforme as referências e o assunto"
        }
        return """
        - Fonte dos títulos: \(title.isEmpty ? "escolha pela referência" : title). Confirme disponibilidade antes de renderizar.
        - Fonte do corpo: \(body.isEmpty ? "escolha pela referência" : body). Confirme disponibilidade antes de renderizar.
        - Peso: \(weightInstruction).
        - Acabamento: \(borderInstruction).
        - Fundos: \(backgroundInstruction).
        Essas são preferências do usuário para este lote. Se alguma prejudicar a legibilidade ou não puder ser renderizada, adapte com critério e explique a adaptação.
        """
    }
}

struct DesignSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage(DesignPreferences.titleFontKey) private var titleFont = ""
    @AppStorage(DesignPreferences.bodyFontKey) private var bodyFont = ""
    @AppStorage(DesignPreferences.titleWeightKey) private var titleWeight = "auto"
    @AppStorage(DesignPreferences.borderKey) private var borders = "auto"
    @AppStorage(DesignPreferences.backgroundKey) private var backgrounds = "auto"
    let openBackgroundLibrary: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Direção visual").font(.system(size: 24, weight: .semibold))
                Spacer()
                Button("Concluído") { dismiss() }.buttonStyle(.glassProminent)
            }
            Text("Deixe um campo em branco para a IA seguir suas referências.")
                .font(.system(size: 13)).foregroundStyle(.secondary)
            Form {
                Section("Tipografia") {
                    TextField("Fonte dos títulos", text: $titleFont, prompt: Text("Escolher pelas referências"))
                    TextField("Fonte do corpo", text: $bodyFont, prompt: Text("Escolher pelas referências"))
                    Picker("Peso dos títulos", selection: $titleWeight) {
                        Text("Pelas referências").tag("auto")
                        Text("Leve").tag("light")
                        Text("Equilibrado").tag("balanced")
                        Text("Forte").tag("strong")
                    }
                }
                Section("Acabamento") {
                    Picker("Bordas", selection: $borders) {
                        Text("Pelas referências").tag("auto")
                        Text("Sem bordas").tag("none")
                        Text("Discretas").tag("subtle")
                        Text("Definidas").tag("defined")
                    }
                    Picker("Fundos", selection: $backgrounds) {
                        Text("Pelas referências").tag("auto")
                        Text("Minhas fotos").tag("photos")
                        Text("Biblioteca local").tag("library")
                        Text("Superfície simples").tag("plain")
                    }
                    Button("Abrir biblioteca de fundos", action: openBackgroundLibrary)
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
        }
        .padding(24)
        .frame(width: 460, height: 480)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}
