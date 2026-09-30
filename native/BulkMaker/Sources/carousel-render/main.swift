import CarouselEngine
import Foundation

// carousel-render <plano.json>... --saida <pasta> [--lote] [--estilo <estilo.json>] [--revisao <pasta>] [--json]
// carousel-render --folha <pasta de fotos> --saida <pasta>
// carousel-render --agendar <pasta da variação>... --agenda <agenda.json>
// carousel-render --mover <pasta> --para "yyyy-MM-dd HH:mm" | --desagendar <pasta>... | --listar  (+ --agenda)
// The AI writes the plan (photos, words, highlights); this draws every slide the same way, in milliseconds.
// Output is terse on purpose: every character printed here is read (and paid for) by the AI.
let arguments = Array(CommandLine.arguments.dropFirst())
let valueFlags: Set<String> = ["--saida", "--estilo", "--revisao", "--folha", "--agenda", "--para"]

func value(of flag: String) -> String? {
    guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let usage = """
uso:
  carousel-render --folha <pasta de fotos> --saida <pasta>
      folhas de miniaturas numeradas (21 fotos por imagem) pra escolher fotos lendo poucas imagens.
  carousel-render <plano.json>... --saida <pasta> [--lote] [--estilo <estilo.json>] [--revisao <pasta>]
      um plano: os slides vão direto em <pasta>. Vários planos (ou --lote): cada um vai em <pasta>/<nome do plano>.
      --estilo troca o "style" dos planos pelo arquivo. --revisao grava <pasta>/<nome do plano>.jpg
      com todos os slides lado a lado. --json imprime o relatório completo em JSON.
  carousel-render --agendar <pasta da variação>... --agenda <agenda.json>
      coloca cada variação no próximo horário livre da agenda (regras em "rules"), com a legenda.txt dela.
  carousel-render --mover <pasta da variação> --para "yyyy-MM-dd HH:mm" --agenda <agenda.json>
  carousel-render --desagendar <pasta da variação>... --agenda <agenda.json>
  carousel-render --listar --agenda <agenda.json>
      move, tira da agenda (os arquivos ficam) ou lista os próximos posts.

Cada render grava <pasta da variação>/.plano.json com o estilo aplicado. Para refazer um post:
edite esse arquivo e rode  carousel-render "<pasta>/.plano.json" --saida "<pasta>"

plano.json:
{
  "format": "tiktok" | "feed",
  "slides": [ { "photo": "/caminho/foto.jpg", "text": "frase do slide", "highlight": ["palavra"],
                "position": "top" | "middle" | "bottom" (opcional) } ]
}
"""

let positional = arguments.indices.filter { index in
    !arguments[index].hasPrefix("--") && !(index > 0 && valueFlags.contains(arguments[index - 1]))
}.map { arguments[$0] }

let agendaModes = ["--agendar", "--mover", "--desagendar", "--listar"]
if let mode = agendaModes.first(where: arguments.contains), mode != "--agendar" {
    guard let agendaPath = value(of: "--agenda") else { fail(usage) }
    do {
        let agendaURL = URL(fileURLWithPath: agendaPath)
        var agenda = try PostAgenda.load(from: agendaURL)
        switch mode {
        case "--mover":
            guard let folder = positional.first, let target = value(of: "--para") else { fail(usage) }
            let parts = target.split(separator: " ").map(String.init)
            guard parts.count == 2 else { fail("use --para \"yyyy-MM-dd HH:mm\"") }
            let post = try agenda.move(folder: URL(fileURLWithPath: folder, isDirectory: true), date: parts[0], time: parts[1])
            print("\(URL(fileURLWithPath: folder).lastPathComponent) → \(PostAgenda.describe(date: post.date, time: post.time))")
        case "--desagendar":
            guard !positional.isEmpty else { fail(usage) }
            for folder in positional {
                try agenda.unschedule(folder: URL(fileURLWithPath: folder, isDirectory: true))
                print("\(URL(fileURLWithPath: folder).lastPathComponent) saiu da agenda")
            }
        default:
            print(agenda.summary())
        }
        if mode != "--listar" { try agenda.save(to: agendaURL) }
        if let next = agenda.nextFreeSlot() {
            print("próximo horário livre: \(PostAgenda.describe(date: next.date, time: next.time))")
        }
    } catch { fail(error.localizedDescription) }
    exit(0)
}

if arguments.contains("--agendar") {
    guard let agendaPath = value(of: "--agenda"), !positional.isEmpty else { fail(usage) }
    do {
        let agendaURL = URL(fileURLWithPath: agendaPath)
        var agenda = try PostAgenda.load(from: agendaURL)
        for folder in positional {
            let post = try agenda.schedule(folder: URL(fileURLWithPath: folder, isDirectory: true))
            print("\(URL(fileURLWithPath: folder).lastPathComponent) → \(PostAgenda.describe(date: post.date, time: post.time))")
        }
        try agenda.save(to: agendaURL)
        if let next = agenda.nextFreeSlot() {
            print("próximo horário livre: \(PostAgenda.describe(date: next.date, time: next.time))")
        }
    } catch { fail(error.localizedDescription) }
    exit(0)
}

guard let outputPath = value(of: "--saida") else { fail(usage) }
let output = URL(fileURLWithPath: outputPath)

if arguments.contains("--folha") {
    guard let folder = value(of: "--folha") else { fail(usage) }
    do {
        let sheets = try ContactSheet.photoSheets(folder: URL(fileURLWithPath: folder), to: output)
        guard !sheets.isEmpty else { fail("nenhuma imagem em \(folder)") }
        let total = sheets.reduce(0) { $0 + $1.1.count }
        print("\(total) fotos em \(sheets.count) folhas (cada miniatura mostra o nome do arquivo):")
        for (url, names) in sheets { print("\(url.path): \(names.first!) … \(names.last!)") }
    } catch { fail(error.localizedDescription) }
    exit(0)
}

let planPaths = positional
guard !planPaths.isEmpty else { fail(usage) }

func describe(_ style: SlideStyle) -> String {
    var parts: [String] = []
    if let font = style.font { parts.append("fonte \(font)" + (style.weight.map { " \($0)" } ?? "")) }
    if let size = style.size { parts.append("\(Int(size))px") }
    if let color = style.color { parts.append("texto \(color)") }
    if let width = style.strokeWidth { parts.append(width == 0 ? "sem contorno" : "contorno \(Int(width))px \(style.strokeColor ?? "auto")") }
    if let highlight = style.highlightColor { parts.append("destaque \(highlight)") }
    if let position = style.position { parts.append("posição \(position.rawValue)") }
    if let textCase = style.textCase { parts.append(textCase == .upper ? "caixa alta" : "caixa normal") }
    return parts.isEmpty ? "automático (o renderizador decide)" : parts.joined(separator: " · ")
}

do {
    let started = Date()
    let override = try value(of: "--estilo").map {
        try JSONDecoder().decode(SlideStyle.self, from: Data(contentsOf: URL(fileURLWithPath: $0)))
    }
    if arguments.contains("--estilo"), override == nil { fail("faltou o arquivo depois de --estilo") }
    var everything: [String: [RenderReport]] = [:]
    var slideCount = 0
    for path in planPaths {
        var plan = try JSONDecoder().decode(CarouselPlan.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        if let override { plan.style = override }
        let name = URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
        let folder = planPaths.count == 1 && !arguments.contains("--lote") ? output : output.appendingPathComponent(name, isDirectory: true)
        let reports = try SlideRenderer.renderPlan(plan, to: folder)
        // A redo with fewer slides must not leave the old last slides behind.
        let keep = Set(reports.map { URL(fileURLWithPath: $0.file).lastPathComponent })
        for stale in (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        where stale.hasPrefix("slide-") && stale.hasSuffix(".jpg") && !keep.contains(stale) {
            try? FileManager.default.removeItem(at: folder.appendingPathComponent(stale))
        }
        // The exact plan (style included) travels with the variation, so it can be redone later.
        let planEncoder = JSONEncoder()
        planEncoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try planEncoder.encode(plan).write(to: folder.appendingPathComponent(".plano.json"), options: .atomic)
        everything[name] = reports
        slideCount += reports.count
        if path == planPaths.first { print("estilo aplicado: \(describe(plan.style))") }
        // Redoing from a variation's own .plano.json: name it after its folder.
        var header = "\(name == ".plano" ? folder.lastPathComponent : name) → \(folder.path)"
        if let review = value(of: "--revisao") {
            let sheet = URL(fileURLWithPath: review).appendingPathComponent(name + ".jpg")
            try ContactSheet.reviewSheet(slides: reports.map { URL(fileURLWithPath: $0.file) }, to: sheet)
            header += " · revisão: \(sheet.path)"
        }
        print(header)
        for (index, report) in reports.enumerated() {
            var line = String(format: "  %02d · %dpx · %d linhas · %@", index + 1, Int(report.fontSize), report.lines, report.position)
            let notes = report.notes.filter { !$0.hasPrefix("posição automática") }
            if !notes.isEmpty { line += " · " + notes.joined(separator: "; ") }
            if let own = plan.slides[index].style { line += " · estilo do slide: \(describe(own))" }
            print(line)
        }
    }
    if arguments.contains("--json") {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        print(String(decoding: try encoder.encode(everything), as: UTF8.self))
    }
    FileHandle.standardError.write(Data(String(format: "%d slides em %.2fs\n", slideCount,
                                               Date().timeIntervalSince(started)).utf8))
} catch {
    fail(error.localizedDescription)
}
