import CarouselEngine
import Foundation

// carousel-render <plano.json>... --saida <pasta> [--lote] [--estilo <estilo.json>] [--revisao <pasta>] [--json]
// carousel-render --folha <pasta de fotos> --saida <pasta>
// The AI writes the plan (photos, words, highlights); this draws every slide the same way, in milliseconds.
// Output is terse on purpose: every character printed here is read (and paid for) by the AI.
let arguments = Array(CommandLine.arguments.dropFirst())
let valueFlags: Set<String> = ["--saida", "--estilo", "--revisao", "--folha"]

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

plano.json:
{
  "format": "tiktok" | "feed",
  "slides": [ { "photo": "/caminho/foto.jpg", "text": "frase do slide", "highlight": ["palavra"],
                "position": "top" | "middle" | "bottom" (opcional) } ]
}
"""

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

let planPaths = arguments.indices.filter { index in
    !arguments[index].hasPrefix("--") && !(index > 0 && valueFlags.contains(arguments[index - 1]))
}.map { arguments[$0] }
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
        everything[name] = reports
        slideCount += reports.count
        if path == planPaths.first { print("estilo aplicado: \(describe(plan.style))") }
        var header = "\(name) → \(folder.path)"
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
