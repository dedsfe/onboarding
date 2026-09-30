import CarouselEngine
import Foundation

/// Everything a Claude/Codex session opened by the app needs to already understand the batch:
/// fixed instructions (`sessao.md`), the live batch state the app rewrites on every change (`estado.md`)
/// and a hook that tells the AI when that state changed since it last looked.
enum AgentSession {
    /// Sent as the first message so the AI greets with a one-line status instead of waiting in silence.
    static let openingPrompt = "Abri pelo app."

    /// Sent when the user presses "Gerar" in the batch card: that click is the go-ahead, and it names the
    /// free folders so a new run never touches earlier ones.
    static func generatePrompt(variations: Int, firstIndex: Int = 1) -> String {
        let first = String(format: "variacao-%02d", firstIndex)
        let last = String(format: "variacao-%02d", firstIndex + variations - 1)
        return variations == 1 ? "Gera a variação agora, em \(first)."
            : "Gera as \(variations) variações agora, de \(first) a \(last)."
    }

    static func drawingGuide(output: URL?) -> String {
        let outputPath = output?.path ?? "<saída>"
        return """
        ## Como desenhar os slides
        Os slides são desenhados pelo renderizador nativo `.bulk-maker/bin/carousel-render`. Ele faz o corte da foto, ajusta o tamanho do texto sem quebrar palavra, equilibra as linhas, respeita as áreas da interface do TikTok, escolhe a posição do texto pela foto e corrige contraste. Seu trabalho é o conteúdo; o desenho é dele.
        É proibido desenhar slides com HTML, Playwright, navegador, Python ou qualquer outro meio. Se o renderizador falhar, mostre o erro ao usuário em vez de trocar de ferramenta.

        1. Referências: rode `.bulk-maker/bin/carousel-render --folha "<resultados desejados>" --saida .bulk-maker/folhas/referencias` e leia só a folha gerada. Leia também o `legenda.txt` das referências, se existir. Descubra tom, estrutura, quantidade de slides e formato (`tiktok` = 1080×1920; `feed` = 1080×1350).
        2. Fotos: rode `.bulk-maker/bin/carousel-render --folha "<fotos>" --saida .bulk-maker/folhas/fotos` e leia as folhas (21 fotos por imagem, cada miniatura com o nome do arquivo). Escolha as fotos pelos nomes. Abra uma foto sozinha só se a miniatura não bastar para decidir.
        3. Escreva as copys de cada variação (ou use o CSV). Uma ideia curta por slide; o texto precisa caber sem ficar miúdo. Escolha 1–2 palavras de destaque por slide quando fizer sentido.
        4. Grave todos os planos de uma vez, um por variação, com o mesmo nome da pasta de destino: `.bulk-maker/planos/variacao-NN.json` (o app limpa essa pasta a cada Gerar):
           ```json
           { "format": "tiktok",
             "slides": [ { "photo": "/caminho/absoluto/foto.jpg", "text": "frase do slide", "highlight": ["palavra"] } ] }
           ```
           Não coloque `style` no plano: o visual vem de `.bulk-maker/estilo.json`, gerado pelo app com as preferências do usuário (vazio = o renderizador decide). Use `"position": "top" | "middle" | "bottom"` num slide só se as referências pedirem.
        5. Renderize tudo num comando só: `.bulk-maker/bin/carousel-render .bulk-maker/planos/variacao-*.json --lote --estilo .bulk-maker/estilo.json --saida "\(outputPath)" --revisao .bulk-maker/revisao`. Cada plano vira `<saída>/variacao-NN`.
        6. O relatório impresso já diz o estilo aplicado e, por slide, tamanho da fonte, linhas, posição e avisos. Confie nele para estilo e cores; não tente conferir cor olhando a imagem. Avisos: "fonte reduzida" = frase longa, encurte; "escureci/clareei" = pouco contraste, prefira foto com área mais limpa.
        7. Revise lendo só `.bulk-maker/revisao/variacao-NN.jpg` (todos os slides da variação numa imagem): texto cobrindo rosto, foto errada, sequência. Não abra os slides um a um. Se precisar corrigir, edite os planos e renderize de novo; no máximo uma rodada de ajuste.
        8. Em cada pasta de variação, grave `legenda.txt` com a legenda do post (2–4 linhas + 3–5 hashtags do nicho).
        9. Agende todas as variações prontas num comando só: `.bulk-maker/bin/carousel-render --agendar "<saída>/variacao-NN" ... --agenda .bulk-maker/agenda.json`. Ele encaixa cada uma no próximo horário livre pelas regras da agenda e leva a legenda junto; não calcule datas você mesmo. Diga ao usuário em 1 linha quando cada uma vai ao ar.

        ## Economia (obrigatório)
        Cada imagem que você abre é reenviada em todas as mensagens seguintes e custa caro. Abra o mínimo: folhas em vez de fotos soltas, a folha de revisão em vez dos slides. Não explore pastas fora do estado do lote, não leia arquivos que não sejam do lote, não crie miniaturas, montagens ou scripts próprios. Junte ações: grave todos os planos e renderize tudo de uma vez. Respostas curtas.
        """
    }

    /// Stable instructions for an interactive session; nothing here goes stale when the user edits the batch.
    static var instructions: String {
        """
        # Você está dentro do The Carousel Maker

        Esta sessão foi aberta pelo app Mac The Carousel Maker, no painel de terminal ao lado da tela do lote. O usuário escolhe pastas, CSV, variações e estilo no app; você transforma isso em carrosséis prontos. Não é uma sessão de programação: não altere o código do produto a menos que o usuário peça.

        ## Como falar
        - Português do Brasil, direto e informal. Respostas curtas: 1 frase + no máximo 3 bullets + 1 pergunta ou próximo passo. Nada de listas longas, menus de opções ou narrar o que você está pensando.
        - Na primeira mensagem da sessão, responda com UMA linha de situação tirada do estado do lote (fotos, referências, variações, estilo, o que falta) e UMA pergunta, por exemplo: "12 fotos, 4 referências, 3 variações, estilo com a IA. Mando gerar?". Se faltar algo obrigatório, pergunte só por isso.
        - Não comece a gerar sem o ok do usuário, a menos que ele já tenha pedido.
        - Durante a geração, avise só marcos curtos ("variação 1 pronta") e, no fim, onde estão os arquivos.

        ## Estado do lote: sempre o atual
        O app reescreve `.bulk-maker/estado.md` a cada mudança (pastas, CSV, variações, estilo) e ele chega junto das mensagens do usuário. Ele é a verdade: nunca use caminhos, números ou estilo de uma leitura anterior. Se um aviso disser que o lote mudou no meio do trabalho, pare, diga em 1 linha o que mudou e pergunte se refaz o que já foi feito com a versão nova.
        Mais detalhes quando precisar: `.bulk-maker/trabalho.json` (estado estruturado), `.bulk-maker/estilo.json` (visual escolhido no app) e `.bulk-maker/design-kit.md` (direção de arte; leia antes de gerar). `<saída>` abaixo é a pasta de saída do estado.

        \(drawingGuide(output: nil))

        ## Agenda de posts
        `.bulk-maker/agenda.json` guarda as regras (`rules`: `maxPerDay`, `times` em "HH:mm", `weekdays` 1 = domingo … 7 = sábado, `startDate` "yyyy-MM-dd") e os posts agendados (`posts`). Se o usuário pedir outro limite, horário ou dia ("quero 3 por dia", "não posta domingo"), edite só `rules` e confirme em 1 linha. Para tirar ou mover um post, edite o item dele em `posts`. Nunca apague posts que o usuário não mencionou.

        ## Regras
        - Gere exatamente o número de variações pedido. Cada variação é o carrossel inteiro, na pasta `<saída>/variacao-NN` que a mensagem de gerar indicar (sem indicação, use a próxima livre).
        - Nunca mexa em variações que já existem na saída: são rodadas anteriores que o usuário quer comparar. Se ele pedir para refazer uma específica, aí sim substitua só ela.
        - Mantenha fotos e referências originais intactas.
        - Se o usuário informar uma pasta ou um CSV na conversa, atualize `.bulk-maker/selecao.json` (preserve `version: 1` e os campos que não mudaram; caminhos absolutos; `null` para o que não foi escolhido). O app mostra a seleção sozinho e o estado se atualiza.
        """
    }

    /// Human summary of the batch as the app sees it right now. No timestamps, so it only changes
    /// when something the AI must know about changes.
    static func state(photos: URL?, desired: URL?, csv: URL?, output: URL?, variations: Int,
                      design: DesignPreferences, custom: Bool, agenda: PostAgenda.Rules = .init()) -> String {
        let fileManager = FileManager.default
        func visibleFiles(_ folder: URL) -> [URL] {
            ((try? fileManager.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.isRegularFileKey],
                                                   options: [.skipsHiddenFiles])) ?? [])
                .filter { (try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true }
        }
        let images = Set(["jpg", "jpeg", "png", "heic", "webp"])
        var missing: [String] = []

        let photoLine: String
        if let photos {
            let count = visibleFiles(photos).filter { images.contains($0.pathExtension.lowercased()) }.count
            photoLine = "\(photos.path) — \(count) \(count == 1 ? "imagem" : "imagens")"
        } else { photoLine = "não escolhida"; missing.append("pasta de fotos") }

        let desiredLine: String
        if let desired {
            let count = visibleFiles(desired).count
            desiredLine = "\(desired.path) — \(count) \(count == 1 ? "arquivo" : "arquivos")"
        } else { desiredLine = "não escolhida"; missing.append("resultados desejados") }

        let csvLine: String
        if let csv {
            let rows = ((try? String(contentsOf: csv, encoding: .utf8)) ?? "")
                .split(whereSeparator: \.isNewline).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.count
            csvLine = "\(csv.path) — \(max(rows - 1, 0)) linhas de copy"
        } else { csvLine = "nenhum (crie as copys a partir das referências)" }

        let outputLine: String
        if let output {
            let existing = ((try? fileManager.contentsOfDirectory(atPath: output.path)) ?? [])
                .filter { $0.hasPrefix("variacao-") }.sorted()
            outputLine = output.path + (existing.isEmpty ? " — vazia" : " — já tem \(existing.joined(separator: ", ")) de rodadas anteriores (não mexa; a próxima livre é \(String(format: "variacao-%02d", BatchOutputValidator.nextFreeIndex(in: output))))")
        } else { outputLine = "não escolhida"; missing.append("pasta de saída") }

        let style = design.slideStyle
        var choices: [String] = []
        if let font = style.font { choices.append("fonte \(font)") }
        if let weight = style.weight { choices.append("peso \(weight)") }
        if let size = style.size { choices.append("tamanho \(Int(size))px") }
        if let color = style.color { choices.append("texto \(color)") }
        if let width = style.strokeWidth { choices.append(width == 0 ? "sem contorno" : "contorno \(Int(width))px \(style.strokeColor ?? "")") }
        if let highlight = style.highlightColor { choices.append("destaque \(highlight)") }
        if let position = style.position { choices.append("texto \(["top": "no topo", "middle": "no meio", "bottom": "embaixo"][position.rawValue] ?? position.rawValue)") }
        if let align = style.align { choices.append("alinhado \(["leading": "à esquerda", "center": "no centro", "trailing": "à direita"][align.rawValue] ?? align.rawValue)") }
        if let textCase = style.textCase { choices.append(textCase == .upper ? "CAIXA ALTA" : "caixa normal") }
        let styleLine = !custom ? "com a IA (o renderizador decide; você escolhe fotos, texto e destaques)"
            : "personalizado — " + (choices.isEmpty ? "tudo em automático" : choices.joined(separator: ", "))
            + " (já aplicado via `.bulk-maker/estilo.json`; não sobrescreva)"

        return """
        # Estado do lote (escrito pelo app)
        - Fotos: \(photoLine)
        - Resultados desejados: \(desiredLine)
        - CSV: \(csvLine)
        - Saída: \(outputLine)
        - Variações pedidas: \(variations)
        - Estilo: \(styleLine)
        - Agenda: \(agendaLine(agenda))
        - Falta escolher: \(missing.isEmpty ? "nada, pronto pra gerar" : missing.joined(separator: ", "))
        """
    }

    /// Only the rules: posts change while the AI works, and the hook would report them as the user's edits.
    private static func agendaLine(_ rules: PostAgenda.Rules) -> String {
        let names = [1: "dom", 2: "seg", 3: "ter", 4: "qua", 5: "qui", 6: "sex", 7: "sáb"]
        let days = Set(rules.weekdays).count == 7 ? "todos os dias"
            : rules.weekdays.sorted().compactMap { names[$0] }.joined(separator: ", ")
        let times = rules.times.prefix(max(rules.maxPerDay, 0)).sorted().joined(separator: " e ")
        return "até \(rules.maxPerDay) por dia, às \(times), \(days) (regras em `.bulk-maker/agenda.json`)"
    }

    /// Writes the session files next to the batch. Called on every app change through TerminalHandoff.
    static func install(in workspace: URL, state: String) throws {
        try instructions.write(to: workspace.appendingPathComponent("sessao.md"), atomically: true, encoding: .utf8)
        let stateFile = workspace.appendingPathComponent("estado.md")
        if (try? String(contentsOf: stateFile, encoding: .utf8)) != state {
            try state.write(to: stateFile, atomically: true, encoding: .utf8)
        }
        // Pre-escaped PostToolUse payload, so the hook script never has to build JSON in the shell.
        let notice = "O usuário mudou o lote no app enquanto você trabalhava. Use este estado, não o anterior; pare, diga em 1 linha o que mudou e pergunte se refaz o que já foi feito.\n\n" + state
        let payload: [String: Any] = ["hookSpecificOutput": ["hookEventName": "PostToolUse", "additionalContext": notice]]
        try JSONSerialization.data(withJSONObject: payload)
            .write(to: workspace.appendingPathComponent("estado-aviso.json"), options: .atomic)

        let bin = workspace.appendingPathComponent("bin", isDirectory: true)
        try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
        let hook = bin.appendingPathComponent("estado-hook")
        try hookScript.write(to: hook, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: hook.path)
    }

    /// `prompt`: every user message gets the state (full when it changed, one line when not).
    /// `tool`: after each tool call, speaks up only if the user changed something in the app meanwhile.
    static let hookScript = """
    #!/bin/zsh
    workspace="${0:A:h:h}"
    state="$workspace/estado.md"
    seen="$workspace/.estado-visto.md"
    [[ -f "$state" ]] || exit 0
    if cmp -s "$state" "$seen"; then
      [[ "$1" == prompt ]] && print "Lote sem mudanças no app desde sua última leitura."
      exit 0
    fi
    cp "$state" "$seen"
    if [[ "$1" == tool ]]; then
      cat "$workspace/estado-aviso.json"
    else
      print "Estado atual do lote no app (use este):\\n"
      cat "$state"
    fi
    """

    /// The model the user picked in the batch card (Sonnet by default), at medium effort and with only the
    /// four tools the batch uses, so the system prompt skips web/agent/skill definitions.
    static var claudeCostFlags: [String] {
        ["--model", ClaudeModel.current.rawValue, "--effort", "medium", "--tools", "Bash,Read,Write,Edit"]
    }
    static let codexCostFlags = ["-c", "model_reasoning_effort=\"medium\""]

    static let codexInstructions = "Esta sessão foi aberta pelo app The Carousel Maker. Leia agora e siga `.bulk-maker/sessao.md`. Antes de cada resposta e antes de rodar o renderizador, releia `.bulk-maker/estado.md`: o usuário muda o lote no app a qualquer momento e esse arquivo é sempre a verdade."

    static func claudeSettings(workspace: URL) -> String {
        let hook = workspace.appendingPathComponent("bin/estado-hook").path
        func entry(_ mode: String) -> [[String: Any]] {
            [["hooks": [["type": "command", "command": "\(TerminalHandoff.shellQuote(hook)) \(mode)"]]]]
        }
        let settings: [String: Any] = ["hooks": ["UserPromptSubmit": entry("prompt"), "PostToolUse": entry("tool")]]
        let data = (try? JSONSerialization.data(withJSONObject: settings, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }
}

/// Claude model for batch sessions, picked in the batch card so the user can compare quality against cost.
enum ClaudeModel: String, CaseIterable {
    case haiku, sonnet, opus

    static let storageKey = "batchClaudeModel"

    static var current: Self {
        Self(rawValue: UserDefaults.standard.string(forKey: storageKey) ?? "") ?? .sonnet
    }

    var label: String {
        switch self {
        case .haiku: return "Haiku"
        case .sonnet: return "Sonnet"
        case .opus: return "Opus"
        }
    }
}
