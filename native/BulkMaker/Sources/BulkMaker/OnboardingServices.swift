import AppKit
import Foundation
import ImageIO

/// What onboarding learns about the product: read from its site by the person's own AI (the same fields
/// ScrollShow extracts), plus who they are and what they want. Saved with the project and as
/// `perfil-produto.md` in its folder, so every AI session can read it.
struct ProductProfile: Codable, Equatable {
    var site = ""
    var name = ""
    var tagline: String?
    var category = ""
    var whatItDoes = ""
    var features: [String] = []
    var audience = ""
    var valueProps: [String] = []
    var monetization: String?
    var emotionalAngles: [String] = []
    var umbrellaNiche = ""
    var subNiches: [String] = []
    var keywords: [String] = []
    /// Apps that already sell the same thing, by name: the onboarding hunts their carousels.
    var competitors: [String] = []
    /// TikTok searches written the way app sellers write ("o app que me ajudou a…"), to find their carousels.
    var sellerSearches: [String] = []
    var role: String?
    var goal: String?

    enum CodingKeys: String, CodingKey {
        case site, name, tagline, category, features, audience, monetization, keywords, role, goal, competitors
        case sellerSearches = "seller_searches"
        case whatItDoes = "what_it_does", valueProps = "value_props", emotionalAngles = "emotional_angles"
        case umbrellaNiche = "umbrella_niche", subNiches = "sub_niches"
    }

    init() {}

    /// Lenient: the AI may leave fields out or send null.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func text(_ key: CodingKeys) -> String { (try? c.decodeIfPresent(String.self, forKey: key)) ?? nil ?? "" }
        func list(_ key: CodingKeys) -> [String] { (try? c.decodeIfPresent([String].self, forKey: key)) ?? nil ?? [] }
        site = text(.site); name = text(.name); category = text(.category); whatItDoes = text(.whatItDoes)
        audience = text(.audience); umbrellaNiche = text(.umbrellaNiche)
        tagline = (try? c.decodeIfPresent(String.self, forKey: .tagline)) ?? nil
        monetization = (try? c.decodeIfPresent(String.self, forKey: .monetization)) ?? nil
        role = (try? c.decodeIfPresent(String.self, forKey: .role)) ?? nil
        goal = (try? c.decodeIfPresent(String.self, forKey: .goal)) ?? nil
        features = list(.features); valueProps = list(.valueProps); emotionalAngles = list(.emotionalAngles)
        subNiches = list(.subNiches); keywords = list(.keywords)
        competitors = list(.competitors); sellerSearches = list(.sellerSearches)
    }

    var markdown: String {
        func bullets(_ items: [String]) -> String { items.map { "- \($0)" }.joined(separator: "\n") }
        var lines = ["# \(name.isEmpty ? site : name)", "", "Site: \(site)"]
        if let tagline, !tagline.isEmpty { lines.append("Slogan: \(tagline)") }
        if !category.isEmpty { lines.append("Categoria: \(category)") }
        if !whatItDoes.isEmpty { lines += ["", "## O que faz", whatItDoes] }
        if !audience.isEmpty { lines += ["", "## Pra quem", audience] }
        if !features.isEmpty { lines += ["", "## Recursos", bullets(features)] }
        if !valueProps.isEmpty { lines += ["", "## Por que escolhem", bullets(valueProps)] }
        if let monetization, !monetization.isEmpty { lines += ["", "## Como cobra", monetization] }
        if !emotionalAngles.isEmpty { lines += ["", "## Ângulos emocionais", bullets(emotionalAngles)] }
        if !umbrellaNiche.isEmpty { lines += ["", "## Nicho", umbrellaNiche] }
        if !subNiches.isEmpty { lines += ["", "## Subnichos", bullets(subNiches)] }
        if !keywords.isEmpty { lines += ["", "## Buscas no TikTok", bullets(keywords)] }
        if !competitors.isEmpty { lines += ["", "## Concorrentes", bullets(competitors)] }
        if !sellerSearches.isEmpty { lines += ["", "## Buscas de quem vende app parecido", bullets(sellerSearches)] }
        if let role { lines += ["", "Quem usa o app: \(role)"] }
        if let goal { lines.append("Objetivo: \(goal)") }
        return lines.joined(separator: "\n") + "\n"
    }
}

/// The apps already selling in the niche, from the App Store's public search: real names, the most rated
/// first. They're what the onboarding hunts on TikTok.
enum Competitors {
    static func appStore(_ terms: [String], excluding own: String, country: String = "br") async -> [String] {
        var scored: [String: Int] = [:]
        for term in terms.prefix(3) where !term.isEmpty {
            var components = URLComponents(string: "https://itunes.apple.com/search")!
            components.queryItems = [.init(name: "term", value: term), .init(name: "entity", value: "software"),
                                     .init(name: "country", value: country), .init(name: "limit", value: "15")]
            guard let (data, _) = try? await URLSession.shared.data(from: components.url!),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let results = json["results"] as? [[String: Any]] else { continue }
            for app in results {
                guard let full = app["trackName"] as? String else { continue }
                let name = short(full)
                guard name.count >= 3, name.count <= 28, name.lowercased() != own.lowercased() else { continue }
                scored[name] = max(scored[name] ?? 0, app["userRatingCount"] as? Int ?? 0)
            }
        }
        // A few ratings only: nobody's selling it yet, so nobody's making carousels about it.
        return scored.filter { $0.value >= 200 }.sorted { $0.value > $1.value }.map(\.key)
    }

    /// "Hallow: Prayer & Meditation" is "Hallow" on TikTok.
    static func short(_ name: String) -> String {
        let cut = name.components(separatedBy: CharacterSet(charactersIn: ":|–—-(")).first ?? name
        return cut.trimmingCharacters(in: .whitespaces)
    }
}

/// The first look at a site, straight from its HTML: name, icon, color and readable text. Fast, so the
/// person sees their brand while the AI is still reading.
struct SiteSnapshot {
    var url: URL
    var name: String
    var description: String?
    var themeColor: NSColor?
    var icon: NSImage?
    var iconData: Data?
    var text: String

    var domain: String { url.host()?.replacingOccurrences(of: "www.", with: "") ?? url.absoluteString }

    /// The color the stage glows in: the site's theme color when it has some life in it, else the icon's
    /// most colorful tone. Near-black, near-white and grey give nothing, so the default glow stays.
    var brandColor: NSColor? {
        if let themeColor, Self.lively(themeColor) { return themeColor }
        return icon.flatMap(Self.dominantColor)
    }

    private static func lively(_ color: NSColor) -> Bool {
        guard let rgb = color.usingColorSpace(.sRGB) else { return false }
        return rgb.saturationComponent > 0.28 && rgb.brightnessComponent > 0.25
    }

    /// Averages the icon's saturated pixels on a 16×16 copy: cheap, and blind to white backgrounds.
    private static func dominantColor(_ image: NSImage) -> NSColor? {
        let side = 16
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
              let context = CGContext(data: &pixels, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.draw(cg, in: CGRect(x: 0, y: 0, width: side, height: side))
        var red = 0.0, green = 0.0, blue = 0.0, weight = 0.0
        for index in stride(from: 0, to: pixels.count, by: 4) where pixels[index + 3] > 128 {
            let color = NSColor(srgbRed: CGFloat(pixels[index]) / 255, green: CGFloat(pixels[index + 1]) / 255,
                                blue: CGFloat(pixels[index + 2]) / 255, alpha: 1)
            let w = Double(color.saturationComponent * color.brightnessComponent)
            guard w > 0.12 else { continue }
            red += Double(color.redComponent) * w; green += Double(color.greenComponent) * w
            blue += Double(color.blueComponent) * w; weight += w
        }
        guard weight > 0.5 else { return nil }
        let result = NSColor(srgbRed: red / weight, green: green / weight, blue: blue / weight, alpha: 1)
        return lively(result) ? result : nil
    }

    static func normalize(_ raw: String) -> URL? {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.contains(" ") else { return nil }
        if !value.lowercased().hasPrefix("http") { value = "https://" + value }
        guard let url = URL(string: value), let host = url.host(), host.contains("."), host.count >= 4 else { return nil }
        return url
    }

    static func read(_ url: URL) async throws -> SiteSnapshot {
        var request = URLRequest(url: url, timeoutInterval: 12)
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
                         forHTTPHeaderField: "User-Agent")
        request.setValue("pt-BR,pt;q=0.9,en;q=0.8", forHTTPHeaderField: "Accept-Language")
        let (data, response) = try await URLSession.shared.data(for: request)
        let final = response.url ?? url
        let html = String(decoding: data.prefix(1_500_000), as: UTF8.self)

        let meta = metaTags(html)
        let title = firstMatch(#"<title[^>]*>([\s\S]*?)</title>"#, in: html).map(decodeEntities)
        let rawName = meta["og:site_name"] ?? meta["application-name"] ?? title ?? final.host() ?? url.absoluteString
        let name = cleanName(rawName, host: final.host())
        let description = meta["og:description"] ?? meta["description"] ?? meta["twitter:description"]
        let theme = meta["theme-color"].flatMap(color(hex:))

        var snapshot = SiteSnapshot(url: final, name: name, description: description.map(decodeEntities),
                                    themeColor: theme, icon: nil, iconData: nil, text: readableText(html))
        if let (image, bytes) = await icon(html: html, base: final) {
            snapshot.icon = image
            snapshot.iconData = bytes
        }
        return snapshot
    }

    // MARK: HTML bits

    private static func metaTags(_ html: String) -> [String: String] {
        var tags: [String: String] = [:]
        let tag = try! NSRegularExpression(pattern: #"<meta\s[^>]*>"#, options: .caseInsensitive)
        for match in tag.matches(in: html, range: NSRange(html.startIndex..., in: html)).prefix(300) {
            guard let range = Range(match.range, in: html) else { continue }
            let element = String(html[range])
            guard let content = attribute("content", in: element) else { continue }
            if let key = attribute("property", in: element) ?? attribute("name", in: element) {
                tags[key.lowercased()] = tags[key.lowercased()] ?? content
            }
        }
        return tags
    }

    private static func attribute(_ name: String, in element: String) -> String? {
        firstMatch(#"\b\#(name)\s*=\s*["']([^"']*)["']"#, in: element)
    }

    private static func firstMatch(_ pattern: String, in text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              match.numberOfRanges > 1, let range = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[range]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// "Acme — Ship faster | Home" → "Acme": the part before the first separator, when it is the brand.
    private static func cleanName(_ raw: String, host: String?) -> String {
        let decoded = decodeEntities(raw)
        let parts = decoded.components(separatedBy: CharacterSet(charactersIn: "|–—-·:")).map {
            $0.trimmingCharacters(in: .whitespaces)
        }.filter { !$0.isEmpty }
        let base = host?.replacingOccurrences(of: "www.", with: "").components(separatedBy: ".").first?.lowercased() ?? ""
        if let brand = parts.first(where: { $0.lowercased().replacingOccurrences(of: " ", with: "").contains(base) && !base.isEmpty }) {
            return brand
        }
        return parts.first.map { $0.count <= 32 ? $0 : String($0.prefix(32)) } ?? decoded
    }

    private static func decodeEntities(_ text: String) -> String {
        var value = text
        for (entity, char) in ["&amp;": "&", "&quot;": "\"", "&#39;": "'", "&#x27;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " "] {
            value = value.replacingOccurrences(of: entity, with: char)
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The page's words without scripts, styles and tags, capped like ScrollShow (12k characters).
    private static func readableText(_ html: String) -> String {
        var text = html
        for pattern in [#"<script[\s\S]*?</script>"#, #"<style[\s\S]*?</style>"#, #"<noscript[\s\S]*?</noscript>"#, #"<svg[\s\S]*?</svg>"#, #"<[^>]+>"#] {
            text = text.replacingOccurrences(of: pattern, with: " ", options: [.regularExpression, .caseInsensitive])
        }
        text = decodeEntities(text).replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        return String(text.prefix(12_000))
    }

    private static func color(hex: String) -> NSColor? {
        var value = hex.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        if value.count == 3 { value = value.map { "\($0)\($0)" }.joined() }
        guard value.count == 6, let number = Int(value, radix: 16) else { return nil }
        return NSColor(srgbRed: CGFloat((number >> 16) & 0xff) / 255, green: CGFloat((number >> 8) & 0xff) / 255,
                       blue: CGFloat(number & 0xff) / 255, alpha: 1)
    }

    /// The best icon the site declares (apple-touch-icon first, it is the biggest), else /favicon.ico.
    private static func icon(html: String, base: URL) async -> (NSImage, Data)? {
        var candidates: [(URL, Int)] = []
        let link = try! NSRegularExpression(pattern: #"<link\s[^>]*>"#, options: .caseInsensitive)
        for match in link.matches(in: html, range: NSRange(html.startIndex..., in: html)).prefix(200) {
            guard let range = Range(match.range, in: html) else { continue }
            let element = String(html[range])
            guard let rel = attribute("rel", in: element)?.lowercased(), rel.contains("icon"),
                  let href = attribute("href", in: element), let url = URL(string: href, relativeTo: base) else { continue }
            let size = attribute("sizes", in: element).flatMap { Int($0.components(separatedBy: "x").first ?? "") } ?? 0
            let score = (rel.contains("apple-touch") ? 1000 : 0) + size + (href.hasSuffix(".svg") ? -500 : 0)
            candidates.append((url.absoluteURL, score))
        }
        candidates.sort { $0.1 > $1.1 }
        candidates.append((URL(string: "/favicon.ico", relativeTo: base)!.absoluteURL, -1000))
        for (url, _) in candidates.prefix(4) {
            guard let (data, response) = try? await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 8)),
                  (response as? HTTPURLResponse)?.statusCode ?? 200 < 400, data.count > 100,
                  let image = NSImage(data: data), image.size.width >= 16 else { continue }
            return (image, data)
        }
        return nil
    }
}

/// Reads the site with the person's own AI (Claude Code or Codex) and returns the profile. The app adds
/// no AI cost of its own: it is the same CLI the batch uses.
enum ProductUnderstanding {
    struct Failure: Error { let message: String }

    static func understand(_ snapshot: SiteSnapshot) async throws -> ProductProfile {
        let output = try await answer(prompt(snapshot))
        guard let start = output.firstIndex(of: "{"), let end = output.lastIndex(of: "}"), start < end,
              var profile = try? JSONDecoder().decode(ProductProfile.self, from: Data(output[start...end].utf8)) else {
            throw Failure(message: "A IA não devolveu um resumo que eu consiga ler.")
        }
        profile.site = snapshot.url.absoluteString
        if profile.name.isEmpty { profile.name = snapshot.name }
        return profile
    }

    /// Shared structured research calls use the same installed and authenticated CLI.
    static func answer(_ prompt: String) async throws -> String {
        let preferred = AgentCLI(rawValue: UserDefaults.standard.string(forKey: "batchAgent") ?? "") ?? .claude
        let order: [AgentCLI] = preferred == .claude ? [.claude, .codex] : [.codex, .claude]
        guard let cli = await firstInstalled(order) else {
            throw Failure(message: "Não achei o Claude Code nem o Codex neste Mac.")
        }
        return try await run(cli, prompt: prompt)
    }

    private static func prompt(_ snapshot: SiteSnapshot) -> String {
        """
        Você é um profissional de marketing afiado ajudando o The Carousel Maker, uma ferramenta de carrosséis \
        pro TikTok e Instagram, a entender um produto bem o bastante pra achar as contas certas pra estudar.

        Trabalhe só com o que está abaixo. Entenda o produto de forma honesta e concreta, depois derive o nicho \
        como um marqueteiro: o nicho amplo NÃO é a categoria exata do produto (estreita demais pra ter volume de \
        carrossel), e sim o mundo mais amplo que o público dele já rola no feed.

        Responda SÓ com um objeto JSON, sem texto antes ou depois, com estas chaves:
        "name" (nome do produto como ele se apresenta), "tagline" (slogan dele ou null), "category" (que tipo de \
        produto é), "what_it_does" (a função principal numa frase honesta), "features" (capacidades concretas, sem \
        adjetivos de marketing), "audience" (pra quem é, específico), "value_props" (por que escolhem), \
        "monetization" (como ganha dinheiro, se souber, ou null), "emotional_angles" (sentimentos que ele vende, \
        tirados da linguagem da página), "umbrella_niche" (o nicho amplo), "sub_niches" (cantos específicos desse \
        nicho que o produto toca), "keywords" (12 a 20 buscas que pessoas reais digitam no TikTok pra descobrir \
        esse conteúdo: algumas amplas e muitas específicas e humanas, com intenções variadas; nada de hashtag), \
        "competitors" (até 6 apps concorrentes reais que você conhece e que vendem algo parecido pro mesmo público, \
        só o nome do app como aparece na loja; lista vazia se não souber), "seller_searches" (4 a 6 buscas no \
        TikTok que achariam carrosséis de quem VENDE um app parecido. Esses posts seguem o formato "parte 1 ensina \
        ou mostra a dor, parte 2 indica o app que ajudou", então escreva como esses criadores escrevem: a dor que o \
        app resolve e o "app que me ajudou a…", "aplicativo pra…", não o tema solto. Ex.: pra um app que bloqueia \
        redes sociais até a pessoa orar, "app que me fez parar de rolar o feed de manhã", não "oração da manhã").

        Escreva tudo no idioma do público do site (se o site é em português, em português).

        Site: \(snapshot.url.absoluteString)
        Nome na página: \(snapshot.name)
        Descrição: \(snapshot.description ?? "-")
        Texto da página:
        \(snapshot.text)
        """
    }

    private static func firstInstalled(_ order: [AgentCLI]) async -> AgentCLI? {
        for cli in order {
            if let path = try? await shell("command -v \(cli.rawValue)", input: nil, timeout: 10),
               !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return cli }
        }
        return nil
    }

    private static func run(_ cli: AgentCLI, prompt: String) async throws -> String {
        let command: String
        switch cli {
        case .claude:
            command = "claude -p --model sonnet --strict-mcp-config --output-format text"
        case .codex:
            // The app's clean Codex home: no global instructions or MCP servers re-sent on the call.
            command = "CODEX_HOME=\(TerminalHandoff.shellQuote(AgentSession.codexHome().path)) codex exec --skip-git-repo-check -"
        }
        return try await shell(command, input: prompt, timeout: 180)
    }

    /// Runs in a login shell, so the PATH has what the person installed (Homebrew, npm).
    private static func shell(_ command: String, input: String?, timeout: TimeInterval) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/zsh")
            process.arguments = ["-lc", command]
            process.currentDirectoryURL = FileManager.default.temporaryDirectory
            let output = Pipe(), errors = Pipe(), stdin = Pipe()
            process.standardOutput = output
            process.standardError = errors
            process.standardInput = stdin
            let collected = OutputBox()
            output.fileHandleForReading.readabilityHandler = { handle in collected.append(handle.availableData) }
            errors.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
            process.terminationHandler = { finished in
                output.fileHandleForReading.readabilityHandler = nil
                errors.fileHandleForReading.readabilityHandler = nil
                collected.append(output.fileHandleForReading.readDataToEndOfFile())
                if finished.terminationReason == .uncaughtSignal {
                    continuation.resume(throwing: Failure(message: "A IA demorou demais pra responder."))
                } else if finished.terminationStatus == 0 {
                    continuation.resume(returning: collected.text)
                } else {
                    continuation.resume(throwing: Failure(message: "A IA não conseguiu ler o site agora."))
                }
            }
            do { try process.run() } catch {
                continuation.resume(throwing: Failure(message: "Não deu pra abrir a IA."))
                return
            }
            if let input { stdin.fileHandleForWriting.write(Data(input.utf8)) }
            try? stdin.fileHandleForWriting.close()
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                if process.isRunning { process.terminate() }
            }
        }
    }

    private final class OutputBox: @unchecked Sendable {
        private var data = Data()
        private let lock = NSLock()
        func append(_ chunk: Data) { lock.lock(); data.append(chunk); lock.unlock() }
        var text: String { lock.lock(); defer { lock.unlock() }; return String(decoding: data, as: UTF8.self) }
    }
}

/// One account the research found, with its best carousel's first slide for the card.
struct ResearchedAccount: Identifiable {
    var id: String { handle }
    var handle: String
    var followers: Int
    var typicalViews: Int
    var cover: URL?
    var postFolder: URL?
    /// Its best carousels (up to 3), slides on disk, views and all.
    var posts: [ResearchedPost] = []

    /// Reads the `resultado.json` the researcher saves.
    static func load(from folder: URL) -> [ResearchedAccount] {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent("resultado.json")),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["versao_validacao"] as? Int == 2,
              let accounts = json["contas"] as? [[String: Any]] else { return [] }
        return accounts.compactMap { row in
            guard let handle = row["conta"] as? String else { return nil }
            let posts = (row["carrosseis"] as? [[String: Any]] ?? []).compactMap { post -> ResearchedPost? in
                guard post["nicho_validado"] as? Bool == true,
                      post["fala_de_app"] as? Bool == true
                        || (post["relato_pessoal"] as? Bool == true && post["criador_pessoal"] as? Bool == true),
                      let path = post["pasta"] as? String else { return nil }
                let folder = URL(fileURLWithPath: path, isDirectory: true)
                let slides = ((try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [])
                    .filter { ["jpg", "jpeg", "png", "webp", "heic"].contains($0.pathExtension.lowercased()) }
                    .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
                guard slides.count >= 2 else { return nil }
                let views = post["views"] as? Int ?? 0
                let aboutApp = post["fala_de_app"] as? Bool ?? false
                return ResearchedPost(handle: handle, views: views, likes: post["curtidas"] as? Int ?? 0,
                                      saves: post["salvos"] as? Int ?? 0, slides: slides, folder: folder, aboutApp: aboutApp,
                                      priority: post["prioridade"] as? Int
                                        ?? (aboutApp ? (views >= TikTokResearcher.millionViews ? 1 : 2) : 3), validated: true)
            }
            guard !posts.isEmpty else { return nil }
            return ResearchedAccount(handle: handle, followers: row["seguidores"] as? Int ?? 0,
                                     typicalViews: row["views_tipicas"] as? Int ?? 0, cover: posts.first?.slides.first,
                                     postFolder: posts.first?.folder, posts: posts)
        }
    }

    /// A small thumbnail, decoded off the main thread: the grid never holds full-size slides.
    static func thumbnail(_ url: URL, maxPixels: Int = 420) async -> NSImage? {
        await Task.detached(priority: .utility) { () -> NSImage? in
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                  let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                      kCGImageSourceCreateThumbnailFromImageAlways: true,
                      kCGImageSourceCreateThumbnailWithTransform: true,
                      kCGImageSourceThumbnailMaxPixelSize: maxPixels
                  ] as CFDictionary) else { return nil }
            return NSImage(cgImage: image, size: .zero)
        }.value
    }
}

/// One viral carousel found by the research: what the onboarding shows off, and what can become the reference.
struct ResearchedPost: Identifiable {
    var id: URL { folder }
    var handle: String
    var views: Int
    var likes: Int
    var saves: Int
    var slides: [URL]
    var folder: URL
    var aboutApp = false
    /// Product recommendations rank ahead of personal stories, after relevance is verified.
    var priority = 3
    var validated = false

    /// Best first, by the fixed rule and then views.
    static func ranked(_ posts: [ResearchedPost]) -> [ResearchedPost] {
        posts.filter { $0.validated && $0.slides.count >= 2 && $0.views >= TikTokResearcher.viralViews }
            .sorted { $0.priority != $1.priority ? $0.priority < $1.priority : $0.views > $1.views }
    }
}
