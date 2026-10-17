import AppKit
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision
import WebKit

/// Finds the TikTok accounts whose carousels go viral again and again, for the AI, with nothing on screen
/// and no browser extension. The AI runs `.bulk-maker/bin/pesquisar-tiktok "<termo>" [quantidade]`, which
/// drops a request in `.bulk-maker/pesquisa/pedidos`. The app runs TikTok's photo search for the term and
/// the related searches TikTok itself suggests, in a hidden web view, and reads the results the page loads.
/// One lucky post proves little, so it judges accounts, not posts: typical (median) views of the account's
/// carousels, views per follower (a small account with big views means the format works, not the fame)
/// and how recent they are. The best accounts and their top carousels are saved under
/// `.bulk-maker/pesquisa/<termo>-<data>`. No login: TikTok blocks hidden profile pages without one, so the
/// account numbers come from the account's posts that show up across the searches.
@MainActor
final class TikTokResearcher: NSObject, WKScriptMessageHandler {
    static let shared = TikTokResearcher()

    struct Post {
        var id: String
        var author: String
        var caption: String
        var created: Date
        var views: Int
        var likes: Int
        var comments: Int
        var shares: Int
        var saves: Int
        var images: [URL]
        var followers: Int
        /// Missing counts must never be presented as measured zeroes.
        var unavailableMetrics: Set<String> = []
        var url: String { "https://www.tiktok.com/@\(author)/photo/\(id)" }
        var mentionsApp: Bool { TikTokResearcher.mentionsApp(caption) }
        /// Sells an app: said in the caption, or found in the slides' text (the "part 2: download this app" slide).
        var sellsApp = false
        var assessment: ResearchAssessment?
        var inspectedSlides: [ResearchCanvas.Slide] = []
        var authorBio = ""
        var inspectionText: String { ([caption] + inspectedSlides.map(\.text)).joined(separator: "\n") }
        /// Product recommendations lead at any qualifying reach; views break ties within that group.
        var priority: Int { (sellsApp || mentionsApp) ? (views >= TikTokResearcher.millionViews ? 1 : 2) : 3 }
    }

    private static var workspace: URL { TerminalHandoff.projectDirectory.appendingPathComponent(".bulk-maker/pesquisa") }
    private static var requests: URL { workspace.appendingPathComponent("pedidos") }

    private var timer: Timer?
    private var busy = false
    private var found: [String: Post] = [:]
    private var hasMore = true
    /// Related searches TikTok offers for the current one, in its order.
    private var suggestions: [String] = []
    private var webView: WKWebView?
    private var window: NSWindow?

    /// Copies every search answer TikTok's page receives to the app; the page itself is never shown.
    private static let hook = """
    (function(){
      // Never a sound: the posts' music would play out of nowhere.
      const play0 = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function() { this.muted = true; this.volume = 0; return play0.apply(this, arguments); };
      const quiet = () => document.querySelectorAll('audio,video').forEach(m => { m.muted = true; m.volume = 0; });
      new MutationObserver(quiet).observe(document, { childList: true, subtree: true });
      if (window.AudioContext) window.AudioContext = function() { throw new Error('muted'); };
      if (window.webkitAudioContext) window.webkitAudioContext = function() { throw new Error('muted'); };
      const send = (u, t) => { try { window.webkit.messageHandlers.tiktok.postMessage(t); } catch (e) {} };
      const wanted = u => String(u).indexOf('/api/search/') >= 0;
      const fetch0 = window.fetch;
      window.fetch = async function(...args) {
        const response = await fetch0.apply(this, args);
        try { const u = (args[0] && args[0].url) || String(args[0]); if (wanted(u)) response.clone().text().then(t => send(u, t)); } catch (e) {}
        return response;
      };
      const open0 = XMLHttpRequest.prototype.open, send0 = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(m, u) { this.__u = u; return open0.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', () => { if (wanted(this.__u)) send(this.__u, this.responseText); });
        return send0.apply(this, arguments);
      };
    })();
    """

    func start() {
        guard timer == nil else { return }
        try? FileManager.default.createDirectory(at: Self.requests, withIntermediateDirectories: true)
        // Also installed with every session update; here so the command exists from the first launch.
        let command = Self.workspace.deletingLastPathComponent().appendingPathComponent("bin/pesquisar-tiktok")
        try? FileManager.default.createDirectory(at: command.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? Self.script.write(to: command, atomically: true, encoding: .utf8)
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: command.path)
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.pickUpRequest() }
        }
    }

    // MARK: Requests from the AI

    /// `<id>.pedido`: line 1 how many carousels, line 2 the search. Answered in `<id>.resultado`:
    /// "OK <pasta>" or "ERRO <motivo>".
    private func pickUpRequest() {
        guard !busy,
              let names = try? FileManager.default.contentsOfDirectory(atPath: Self.requests.path),
              let name = names.filter({ $0.hasSuffix(".pedido") }).sorted().first else { return }
        let file = Self.requests.appendingPathComponent(name)
        let taken = file.deletingPathExtension().appendingPathExtension("processando")
        guard (try? FileManager.default.moveItem(at: file, to: taken)) != nil,
              let text = try? String(contentsOf: taken, encoding: .utf8) else { return }
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        let count = min(30, max(1, Int(lines.first?.trimmingCharacters(in: .whitespaces) ?? "") ?? 10))
        let query = lines.dropFirst().joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        let answer = taken.deletingPathExtension().appendingPathExtension("resultado")
        busy = true
        Task {
            let reply: String
            do {
                guard !query.isEmpty else { throw Failure("faltou o termo da pesquisa") }
                reply = "OK " + (try await research(query, count: count)).path
            } catch {
                reply = "ERRO " + ((error as? Failure)?.message ?? error.localizedDescription)
            }
            try? reply.write(to: answer, atomically: true, encoding: .utf8)
            try? FileManager.default.removeItem(at: taken)
            busy = false
        }
    }

    struct Failure: Error { let message: String; init(_ message: String) { self.message = message } }

    /// The onboarding's hunt for those already selling an app in the niche: its own searches (the competitors'
    /// names and how app sellers write), the competitors' names to recognize them. Waits behind an AI request.
    func runHunt(_ queries: [String], appNames: [String], count: Int) async throws -> URL {
        while busy { try await Task.sleep(for: .seconds(1)) }
        busy = true
        defer { busy = false }
        return try await hunt(queries, appNames: appNames, count: count)
    }

    // MARK: Search

    /// Where a carousel starts to count as viral, and the floor under which an account isn't worth showing.
    nonisolated static let viralViews = 50_000
    nonisolated static let floorViews = 10_000
    /// The bar of the fixed rule: what we want first is carousels with millions of views.
    nonisolated static let millionViews = 1_000_000

    /// Whether a text (caption or a slide) is about an app (the kind of product the people using this sell):
    /// app words, or one of the competitors' names.
    nonisolated static func mentionsApp(_ caption: String, names: [String] = []) -> Bool {
        let fold = { (text: String) in text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil) }
        let text = fold(caption)
        let named = names.map(fold).contains { name in
            name.count >= 4 && text.range(of: "\\b\(NSRegularExpression.escapedPattern(for: name))\\b", options: .regularExpression) != nil
        }
        if named { return true }
        // An app used to post or scroll is not a product recommendation.
        let app = text.range(of: #"(\bapps?\b|\baplicativos?\b|#app\w*|#aplicativo\w*|app ?store|play ?store|google play)"#,
                             options: .regularExpression) != nil
        let recommendation = text.range(of: #"(baix[aeir]|download|descarg|experimenta|recomend|conheca|me ajud|mudou minh|minhas manhas|precisa conhecer|apps? (de|para|pra) (or|foc|estud|trein)|#app\w+|#aplicativo\w+)"#,
                                         options: .regularExpression) != nil
        return app && recommendation
    }

    struct Account {
        var handle: String
        var followers: Int
        var posts: [Post]
        var medianViews: Int
        var viewsPerFollower: Double?
        var lastPost: Date
        var standout = false
        /// 2+ carousels past the viral bar: a pattern, not luck.
        var proven: Bool { posts.filter { $0.views >= TikTokResearcher.viralViews }.count >= 2 }
        /// Its best carousel under the fixed rule.
        var priority: Int { posts.map(\.priority).min() ?? 3 }
    }

    /// The AI's research: the term, the same term about apps (carousels selling an app come first and a plain
    /// search rarely shows them) and 2 related searches TikTok suggests, the niche as TikTok sees it.
    private func research(_ query: String, count: Int) async throws -> URL {
        let profile = ProjectStore.shared.current.project.profile
        return try await hunt(Self.researchQueries(query, profile: profile), appNames: profile?.competitors ?? [],
                              count: count)
    }

    /// Even a short request such as "referências" is grounded in the product from onboarding.
    static func researchQueries(_ query: String, profile: ProductProfile?) -> [String] {
        var terms = Array((profile?.sellerSearches ?? []).prefix(3))
        let topic = profile?.keywords.first ?? profile?.subNiches.first ?? profile?.name ?? ""
        terms += Array((profile?.keywords ?? []).prefix(2)).map { "app \($0)" }
        terms += Array((profile?.competitors ?? []).prefix(3)).map { "app \($0)" }
        let generic = ["referencias", "referência", "referências", "carrossel", "carrosseis", "carrosséis"]
        let requested = generic.contains(query.lowercased()) ? topic : query
        if !requested.isEmpty { terms.append(mentionsApp(requested) ? requested : "app \(requested)") }
        return shortQueries(terms)
    }

    static func shortQueries(_ queries: [String]) -> [String] {
        var seen = Set<String>()
        return queries.compactMap { raw in
            let words = raw.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
            let term = words.prefix(9).joined(separator: " ")
            guard !term.isEmpty, seen.insert(term.lowercased()).inserted else { return nil }
            return term
        }
    }

    private func hunt(_ queries: [String], appNames: [String], count: Int) async throws -> URL {
        // Capture before the first await: a project switch cannot redirect the downloaded references.
        let project = ProjectStore.shared.current
        guard let context = project.project.productContext else {
            throw Failure("preencha o contexto do produto no onboarding antes de pesquisar referências")
        }
        var posts: [String: Post] = [:]
        var searched: [String] = []
        for (index, term) in Self.shortQueries(queries).enumerated() where !searched.contains(where: { $0.lowercased() == term.lowercased() }) {
            searched.append(term)
            for post in (try? await search(term, want: index == 0 ? 60 : 40)) ?? [] { posts[post.id] = post }
            #if DEBUG
            print("[hunt] searched \"\(term)\": \(posts.count) posts so far")
            #endif
        }
        guard !posts.isEmpty else {
            throw Failure("o TikTok não devolveu carrosséis pra \"\(queries.first ?? "")\" (sem resultado ou pediu verificação). Tente outro termo daqui a pouco.")
        }
        let staged = FileManager.default.temporaryDirectory.appendingPathComponent("reference-review-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: staged, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: staged) }
        let candidates = posts.values.filter { $0.images.count >= 2 && $0.views >= Self.viralViews && !$0.unavailableMetrics.contains("playCount") }
            .sorted {
                let left = Self.mentionsApp($0.caption, names: appNames)
                let right = Self.mentionsApp($1.caption, names: appNames)
                if left != right { return left }
                return $0.views != $1.views ? $0.views > $1.views : $0.id < $1.id
            }.prefix(30)
        var inspected: [Post] = []
        for var post in candidates {
            let folder = staged.appendingPathComponent(post.id)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            post.inspectedSlides = await Self.download(post.images, into: folder)
            guard post.inspectedSlides.allSatisfy({ $0.file != nil }), !post.inspectionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            inspected.append(post)
        }
        guard !inspected.isEmpty else {
            throw Failure("não encontrei carrosséis completos com 2+ slides e 50 mil visualizações; não importei imagens únicas nem completei com posts genéricos")
        }
        let assessments: [String: ResearchAssessment]
        do {
            assessments = try await ResearchRelevance.assess(context: context, candidates: inspected.map {
                ["id": $0.id, "legenda": $0.caption, "bio": $0.authorBio,
                 "slides": $0.inspectedSlides.map { ["numero": $0.number, "texto": $0.text] }]
            })
        } catch {
            throw Failure("não consegui validar o nicho e a recomendação pessoal dos carrosséis. Nenhuma referência sem verificação foi importada. \((error as? ProductUnderstanding.Failure)?.message ?? error.localizedDescription)")
        }
        for index in inspected.indices {
            guard let assessment = assessments[inspected[index].id], assessment.isSupported(by: inspected[index].inspectionText) else { continue }
            inspected[index].assessment = assessment
            inspected[index].sellsApp = assessment.productPromotion
        }
        Self.logReview(inspected, assessments: assessments, searched: searched, seen: posts.count)
        let accounts = Self.judge(inspected)
        guard !accounts.isEmpty else {
            throw Failure("os resultados não passaram na validação: preciso de carrossel viral do seu nicho com produto recomendado ou relato pessoal concreto. Não importei os posts fora do critério")
        }
        return try await save(Array(accounts.prefix(count)), query: queries.first ?? "", searched: searched,
                              seenPosts: posts.count, seenAccounts: accounts.count, competitors: appNames,
                              project: project, productContext: context)
    }

    /// `ultima-avaliacao.json`: every candidate of the last research and why it got in or out, so an empty
    /// result can be explained instead of guessed.
    private static func logReview(_ posts: [Post], assessments: [String: ResearchAssessment], searched: [String], seen: Int) {
        let rows: [[String: Any]] = posts.map { post in
            let assessment = assessments[post.id]
            return ["url": post.url, "views": post.views, "slides": post.images.count,
                    "legenda": String(post.caption.prefix(200)), "aprovado": post.assessment != nil,
                    "nicho": assessment?.nicheMatch ?? false, "produto": assessment?.productPromotion ?? false,
                    "relato": assessment?.personalStory ?? false, "pessoa": assessment?.creatorLed ?? false,
                    "evidencias_conferem": assessment.map { $0.isSupported(by: post.inspectionText) } ?? false,
                    "motivo": assessment?.reason ?? "a IA não avaliou este post"]
        }
        let log: [String: Any] = ["buscas": searched, "posts_vistos": seen, "candidatos": rows]
        guard let data = try? JSONSerialization.data(withJSONObject: log, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? data.write(to: workspace.appendingPathComponent("ultima-avaliacao.json"), options: .atomic)
    }

    /// The words on a slide.
    nonisolated private static func slideText(_ url: URL) async -> String {
        guard !Task.isCancelled else { return "" }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.setValue("https://www.tiktok.com/", forHTTPHeaderField: "Referer")
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return "" }
        guard !Task.isCancelled else { return "" }
        return recognizedText(in: image)
    }

    nonisolated static func recognizedText(in image: CGImage) -> String {
        let reading = VNRecognizeTextRequest()
        reading.recognitionLevel = .fast
        reading.usesLanguageCorrection = false
        reading.recognitionLanguages = ["pt-BR", "en-US"]
        try? VNImageRequestHandler(cgImage: image).perform([reading])
        return (reading.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }

    /// Accounts ranked by a fixed rule, the best carousel of each deciding: an app in the niche with 1M+ views
    /// first, then any 1M+ views, then the rest. Within each, like a person scouting the niche would: 2+
    /// carousels past 50K views (a pattern, not luck) first, then typical views. Top 10% in views per follower get ★.
    static func judge(_ posts: [Post], profile: ProductProfile? = nil) -> [Account] {
        let monthsAgo = Date().addingTimeInterval(-120 * 86400)
        let eligible = posts.filter {
            $0.images.count >= 2 && $0.views >= viralViews && !$0.unavailableMetrics.contains("playCount")
                && ($0.assessment?.isSupported(by: $0.inspectionText) == true)
        }
        var accounts = Dictionary(grouping: eligible, by: \.author).map { handle, list -> Account in
            let sorted = list.sorted { $0.priority != $1.priority ? $0.priority < $1.priority : $0.views > $1.views }
            let views = sorted.map(\.views).sorted()
            let median = views.count % 2 == 1 ? views[views.count / 2]
                : (views[views.count / 2 - 1] + views[views.count / 2]) / 2
            let followers = list.map(\.followers).max() ?? 0
            return Account(handle: handle, followers: followers, posts: sorted, medianViews: median,
                           viewsPerFollower: followers > 0 ? Double(median) / Double(followers) : nil,
                           lastPost: list.map(\.created).max() ?? .distantPast)
        }
        // Gone quiet for 4 months: the format may have stopped working; kept only if nothing else.
        // Millions of views always stay: the rule puts them first.
        let active = accounts.filter { $0.lastPost >= monthsAgo || $0.priority < 3 }
        if active.count >= 3 { accounts = active }
        // Nothing past 10K: not a reference, unless the niche is that small.
        let reaching = accounts.filter { ($0.posts.first?.views ?? 0) >= floorViews }
        if reaching.count >= 3 { accounts = reaching }
        let ratios = accounts.compactMap(\.viewsPerFollower).sorted()
        if ratios.count >= 5 {
            let cut = ratios[Int(0.9 * Double(ratios.count - 1))]
            for index in accounts.indices where (accounts[index].viewsPerFollower ?? 0) >= cut { accounts[index].standout = true }
        }
        return accounts.sorted {
            if $0.priority != $1.priority { return $0.priority < $1.priority }
            if $0.proven != $1.proven { return $0.proven }
            return $0.medianViews > $1.medianViews
        }
    }

    /// Opens the photo tab of TikTok's search, scrolls to load more, and stops once it has `want`
    /// carousels, TikTok has no more, or 45 s passed.
    private func search(_ query: String, want: Int) async throws -> [Post] {
        found = [:]
        hasMore = true
        suggestions = []
        let view = makeWebView()
        var components = URLComponents(string: "https://www.tiktok.com/search/photo")!
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        view.load(URLRequest(url: components.url!))
        let deadline = Date().addingTimeInterval(45)
        var lastCount = -1, still = 0
        while Date() < deadline {
            try await Task.sleep(for: .seconds(2.5))
            if found.count >= want || (!hasMore && !found.isEmpty) { break }
            _ = try? await view.evaluateJavaScript("window.scrollTo(0, document.body.scrollHeight)")
            // Nothing new for a while: TikTok is done or is asking for a check we don't do.
            if found.count == lastCount { still += 1 } else { still = 0 }
            if still >= 6 { break }
            lastCount = found.count
        }
        tearDown()
        return Array(found.values)
    }

    private func makeWebView() -> WKWebView {
        tearDown()
        let configuration = WKWebViewConfiguration()
        // The open project's store: with its TikTok login, searches go further and hit no limits.
        configuration.websiteDataStore = SocialSessions.shared.currentStore
        configuration.applicationNameForUserAgent = "Version/26.0 Safari/605.1.15"
        // Silent: nothing plays on its own in the hidden page.
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.hook, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        configuration.userContentController.add(self, name: "tiktok")
        // A page needs a window to keep running its scripts; this one sits far off every screen.
        let window = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: 1280, height: 900),
                              styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.ignoresMouseEvents = true
        window.collectionBehavior = [.transient, .ignoresCycle, .stationary]
        let view = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
        if let agent = SocialSessions.shared.userAgent(for: .tiktok) { view.customUserAgent = agent }
        view.setAllMediaPlaybackSuspended(true)
        window.contentView!.addSubview(view)
        window.orderBack(nil)
        self.window = window
        self.webView = view
        return view
    }

    private func tearDown() {
        webView?.stopLoading()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "tiktok")
        webView?.removeFromSuperview()
        window?.orderOut(nil)
        webView = nil
        window = nil
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let text = message.body as? String,
              let json = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] else { return }
        if let list = json["sug_list"] as? [[String: Any]] {
            for item in list { if let term = item["content"] as? String, !suggestions.contains(term) { suggestions.append(term) } }
        }
        if let more = json["has_more"] as? Int { hasMore = more != 0 } else if let more = json["has_more"] as? Bool { hasMore = more }
        let items = (json["item_list"] as? [[String: Any]])
            ?? (json["data"] as? [[String: Any]])?.compactMap { $0["item"] as? [String: Any] } ?? []
        for item in items { if let post = Self.post(from: item) { found[post.id] = post } }
    }

    /// Only photo posts count; videos in the answer are skipped.
    static func post(from item: [String: Any]) -> Post? {
        guard let id = item["id"] as? String,
              let imagePost = item["imagePost"] as? [String: Any],
              let images = imagePost["images"] as? [[String: Any]] else { return nil }
        let urls = images.compactMap { image -> URL? in
            let list = (image["imageURL"] as? [String: Any])?["urlList"] as? [String]
            return list?.first.flatMap(URL.init(string:))
        }
        guard urls.count >= 2 else { return nil }
        let stats = item["stats"] as? [String: Any] ?? [:]
        let statsV2 = item["statsV2"] as? [String: Any] ?? [:]
        func number(_ key: String) -> Int? {
            for source in [stats, statsV2] {
                if let value = source[key] as? Int { return value }
                if let value = source[key] as? String, let parsed = Int(value) { return parsed }
            }
            return nil
        }
        let author = (item["author"] as? [String: Any])?["uniqueId"] as? String ?? ""
        let authorStats = item["authorStats"] as? [String: Any] ?? [:]
        let followers = authorStats["followerCount"] as? Int ?? 0
        let created = Date(timeIntervalSince1970: TimeInterval(item["createTime"] as? Int ?? 0))
        var post = Post(id: id, author: author, caption: item["desc"] as? String ?? "", created: created,
                    views: number("playCount") ?? 0, likes: number("diggCount") ?? 0, comments: number("commentCount") ?? 0,
                    shares: number("shareCount") ?? 0, saves: number("collectCount") ?? 0, images: urls, followers: followers,
                    unavailableMetrics: Set(["playCount", "diggCount", "commentCount", "shareCount", "collectCount"].filter { number($0) == nil }))
        post.authorBio = (item["author"] as? [String: Any])?["signature"] as? String ?? ""
        return post
    }

    // MARK: Saving

    /// One folder per account (`01-@conta`), with its best carousels inside (`01-1.2M-views`: slides as JPEGs
    /// and `legenda.txt`); `resumo.md` and `resultado.json` list it all.
    private func save(_ accounts: [Account], query: String, searched: [String],
                      seenPosts: Int, seenAccounts: Int, competitors: [String],
                      project: ProjectFolder, productContext: String) async throws -> URL {
        let stamp = DateFormatter()
        stamp.locale = Locale(identifier: "en_US_POSIX")
        stamp.dateFormat = "yyyyMMdd-HHmm"
        let folder = Self.workspace.appendingPathComponent("\(Self.slug(query))-\(stamp.string(from: Date()))-\(UUID().uuidString.prefix(8))", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        var rows: [[String: Any]] = []
        var summary = "# Contas que viralizam com carrossel: \(query)\n\n"
            + "Projeto: \(project.name). Contexto obrigatório usado na busca:\n\(productContext)\n"
            + "Canvas de destino: \(project.canvasDirectory.path)\n"
            + "Buscas: \(searched.map { "\"\($0)\"" }.joined(separator: ", ")). "
            + "\(seenPosts) carrosséis de \(seenAccounts) contas avaliados.\n"
            + "Critério: 2+ slides completos, 50 mil+ views e relevância verificada com trechos dos próprios slides/legenda. "
            + "Recomendações de produto no nicho vêm antes de relatos pessoais no nicho; não há preenchimento com conteúdo genérico.\n"
            + "Views típicas = mediana das views dos carrosséis da conta. ★ = top 10% em views por seguidor "
            + "(o formato puxa mais do que a fama da conta).\n\n"
        for (index, account) in accounts.enumerated() {
            let accountFolder = folder.appendingPathComponent(String(format: "%02d-@%@", index + 1, account.handle), isDirectory: true)
            // The fixed rule first, then carousels with 2+ slides, then views; 3 per account show the pattern.
            let best = account.posts.sorted {
                if $0.priority != $1.priority { return $0.priority < $1.priority }
                if ($0.images.count > 1) != ($1.images.count > 1) { return $0.images.count > 1 }
                return $0.views > $1.views
            }.prefix(3)
            var postRows: [[String: Any]] = []
            var postLines = ""
            for (position, post) in best.enumerated() {
                let name = String(format: "%02d-%@-views", position + 1, Self.short(post.views))
                let postFolder = accountFolder.appendingPathComponent(name, isDirectory: true)
                try FileManager.default.createDirectory(at: postFolder, withIntermediateDirectories: true)
                try post.caption.write(to: postFolder.appendingPathComponent("legenda.txt"), atomically: true, encoding: .utf8)
                let slides = try post.inspectedSlides.map { slide -> ResearchCanvas.Slide in
                    guard let source = slide.file else { return slide }
                    let target = postFolder.appendingPathComponent(source.lastPathComponent)
                    try FileManager.default.copyItem(at: source, to: target)
                    return ResearchCanvas.Slide(number: slide.number, file: target, text: slide.text)
                }
                let saved = slides.filter { $0.file != nil }.count
                let failed = slides.filter { $0.file == nil }.map(\.number)
                let transcript = slides.map { "Slide \($0.number)\n\($0.text.isEmpty ? "Texto não reconhecido automaticamente." : $0.text)" }.joined(separator: "\n\n")
                try transcript.write(to: postFolder.appendingPathComponent("textos-slides.txt"), atomically: true, encoding: .utf8)
                let details = Self.referenceDetails(post, downloaded: saved, failed: failed)
                try details.write(to: postFolder.appendingPathComponent("publicacao.txt"), atomically: true, encoding: .utf8)
                // Trashed/deleted projects must not be recreated by a research that finished late.
                guard ProjectStore.shared.projects.contains(where: { $0.id == project.id }) else {
                    throw Failure("o projeto da pesquisa foi removido; os arquivos baixados estão em \(folder.path)")
                }
                try ResearchCanvas.add(title: Self.referenceTitle(post), details: details,
                                       slides: slides, to: project.canvasDirectory)
                postRows.append(Self.referenceRecord(post, folder: postFolder, slides: slides, canvas: project.canvasDirectory))
                postLines += "   - \(post.priority == 1 ? "📱 app · " : "")\(Self.referenceTitle(post)) · "
                    + "\(saved == 1 ? "1 slide" : "\(saved) slides") · \(post.caption.replacingOccurrences(of: "\n", with: " ").prefix(90))\n"
                    + "     \(post.url) (pasta \(accountFolder.lastPathComponent)/\(name))\n"
                    + "     Importado no canvas com legenda, métricas e textos de todos os slides.\(failed.isEmpty ? "" : " Falha ao baixar slides: \(failed).")\n"
            }
            let ratio = account.viewsPerFollower.map { String(format: "%.1f", $0) } ?? "?"
            let days = max(0, Int(Date().timeIntervalSince(account.lastPost) / 86400))
            rows.append([
                "posicao": index + 1, "conta": "@" + account.handle, "url": "https://www.tiktok.com/@\(account.handle)",
                "seguidores": account.followers, "views_tipicas": account.medianViews,
                "views_por_seguidor": account.viewsPerFollower ?? NSNull(), "destaque": account.standout,
                "carrosseis_virais_achados": account.posts.count, "ultimo_post_dias": days,
                "pasta": accountFolder.path, "carrosseis": postRows
            ])
            summary += "\(index + 1). @\(account.handle)\(account.standout ? " ★" : "") · \(Self.short(account.followers)) seguidores · "
                + "views típicas \(Self.short(account.medianViews)) · \(ratio)× views por seguidor · "
                + "\(account.posts.count) carrossel(éis) na busca · último há \(days) dias\n"
                + "   https://www.tiktok.com/@\(account.handle)\n" + postLines + "\n"
        }
        let data = try JSONSerialization.data(withJSONObject: ["versao_validacao": 2, "termo": query, "buscas": searched, "concorrentes": competitors,
                                                               "projeto": project.id.uuidString, "contexto_produto": productContext,
                                                               "contas": rows],
                                              options: [.prettyPrinted, .sortedKeys])
        try data.write(to: folder.appendingPathComponent("resultado.json"), options: .atomic)
        try summary.write(to: folder.appendingPathComponent("resumo.md"), atomically: true, encoding: .utf8)
        return folder
    }

    /// Slides as `01.jpg`, `02.jpg`…; TikTok serves webp/heic, re-encoded so every tool can read them.
    private static func download(_ urls: [URL], into folder: URL) async -> [ResearchCanvas.Slide] {
        await withTaskGroup(of: ResearchCanvas.Slide.self) { group in
            var slides: [ResearchCanvas.Slide] = []
            for (index, url) in urls.enumerated() {
                if index >= 4, let slide = await group.next() { slides.append(slide) }
                group.addTask {
                    let missing = ResearchCanvas.Slide(number: index + 1, file: nil, text: "Slide não baixado; texto indisponível.")
                    var request = URLRequest(url: url, timeoutInterval: 30)
                    request.setValue("https://www.tiktok.com/", forHTTPHeaderField: "Referer")
                    guard let (data, response) = try? await URLSession.shared.data(for: request),
                          (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true,
                          let source = CGImageSourceCreateWithData(data as CFData, nil),
                          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return missing }
                    let target = folder.appendingPathComponent(String(format: "%02d.jpg", index + 1))
                    guard let output = CGImageDestinationCreateWithURL(target as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
                    else { return missing }
                    CGImageDestinationAddImage(output, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
                    guard CGImageDestinationFinalize(output) else { return missing }
                    let text = recognizedText(in: image)
                    return ResearchCanvas.Slide(number: index + 1, file: target, text: text)
                }
            }
            for await slide in group { slides.append(slide) }
            return slides.sorted { $0.number < $1.number }
        }
    }

    static func referenceTitle(_ post: Post) -> String {
        let account = post.author.isEmpty ? "Conta não informada" : "@" + post.author
        let views = post.unavailableMetrics.contains("playCount") ? "Visualizações não informadas" : "\(post.views.formatted()) visualizações"
        return "\(account) · \(views)"
    }

    /// JSON keeps missing measurements as null, including when the terminal reads results directly.
    static func referenceRecord(_ post: Post, folder: URL, slides: [ResearchCanvas.Slide], canvas: URL) -> [String: Any] {
        var record: [String: Any] = [
            "pasta": folder.path, "url": post.author.isEmpty ? NSNull() : post.url,
            "slides": slides.filter { $0.file != nil }.count, "legenda": post.caption,
            "data": post.created.timeIntervalSince1970 > 0 ? ISO8601DateFormatter().string(from: post.created) : NSNull(),
            "prioridade": post.priority, "fala_de_app": post.assessment?.productPromotion ?? false,
            "nicho_validado": post.assessment?.nicheMatch ?? false,
            "criador_pessoal": post.assessment?.creatorLed ?? false,
            "relato_pessoal": post.assessment?.personalStory ?? false,
            "motivo_selecao": post.assessment?.reason ?? "Não validado",
            "evidencia_nicho": post.assessment?.nicheEvidence ?? "",
            "evidencia_formato": post.assessment?.angleEvidence ?? "",
            "conta": post.author.isEmpty ? NSNull() : "@" + post.author,
            "metricas_indisponiveis": Array(post.unavailableMetrics).sorted(),
            "slides_esperados": post.images.count, "slides_nao_baixados": slides.filter { $0.file == nil }.map(\.number),
            "textos_slides": slides.map { ["slide": $0.number, "texto": $0.text, "arquivo": $0.file?.path as Any? ?? NSNull()] },
            "canvas": canvas.path, "importado_no_canvas": true
        ]
        for (field, key, value) in [("views", "playCount", post.views), ("curtidas", "diggCount", post.likes),
                                    ("comentarios", "commentCount", post.comments), ("salvos", "collectCount", post.saves),
                                    ("compartilhamentos", "shareCount", post.shares)] {
            record[field] = post.unavailableMetrics.contains(key) ? NSNull() : value
        }
        return record
    }

    static func referenceDetails(_ post: Post, downloaded: Int, failed: [Int]) -> String {
        func metric(_ key: String, _ value: Int, _ label: String) -> String {
            "\(post.unavailableMetrics.contains(key) ? "não informado" : value.formatted()) \(label)"
        }
        let date = post.created.timeIntervalSince1970 > 0 ? ISO8601DateFormatter().string(from: post.created) : "não informada"
        return [metric("diggCount", post.likes, "curtidas"), metric("collectCount", post.saves, "salvos"),
                metric("commentCount", post.comments, "comentários"), metric("shareCount", post.shares, "compartilhamentos")]
            .joined(separator: " · ")
            + "\n\(post.images.count) slides · \(downloaded) baixados · Data: \(date)"
            + (failed.isEmpty ? "" : "\nSlides não baixados: \(failed.map(String.init).joined(separator: ", "))")
            + "\n\(post.author.isEmpty ? "URL da conta não informada" : post.url)\n"
            + (post.caption.isEmpty ? "Legenda não informada." : post.caption)
            + (post.assessment.map { "\n\nPor que entrou: \($0.reason)\nNicho: \($0.nicheEvidence)\nProduto/relato: \($0.angleEvidence)" } ?? "")
    }

    private static func short(_ value: Int) -> String {
        switch value {
        case 1_000_000...: return String(format: "%.1fM", Double(value) / 1_000_000)
        case 1_000...: return String(format: "%.1fK", Double(value) / 1_000)
        default: return String(value)
        }
    }

    private static func slug(_ text: String) -> String {
        let plain = text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased()
        let slug = plain.map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined()
            .split(separator: "-").joined(separator: "-")
        return String(slug.prefix(40)).isEmpty ? "pesquisa" : String(slug.prefix(40))
    }

    /// What the AI runs. Waits for the app's answer and prints `resumo.md`.
    nonisolated static let script = """
    #!/bin/zsh
    # pesquisar-tiktok "<termo>" [quantidade]: as contas que mais viralizam com carrossel no nicho, salvas em .bulk-maker/pesquisa
    termo="$1"; quantidade="${2:-10}"
    [[ -n "$termo" ]] || { print -u2 'Uso: pesquisar-tiktok "<termo>" [quantidade]'; exit 2; }
    pedidos="${0:A:h:h}/pesquisa/pedidos"
    mkdir -p "$pedidos"
    id="$(date +%s)-$$"
    print -r -- "$quantidade"$'\\n'"$termo" > "$pedidos/$id.tmp" && mv "$pedidos/$id.tmp" "$pedidos/$id.pedido"
    for i in {1..1800}; do
      if [[ -f "$pedidos/$id.resultado" ]]; then
        resposta="$(cat "$pedidos/$id.resultado")"; rm -f "$pedidos/$id.resultado"
        if [[ "$resposta" == OK\\ * ]]; then
          pasta="${resposta#OK }"; cat "$pasta/resumo.md"; print "Pasta da pesquisa: $pasta"; exit 0
        fi
        print -u2 -- "${resposta#ERRO }"; exit 1
      fi
      # Still waiting after 15 s with nothing in progress: the app is closed.
      if (( i == 30 )) && [[ -f "$pedidos/$id.pedido" ]] && ! ls "$pedidos"/*.processando(N) | grep -q .; then
        rm -f "$pedidos/$id.pedido"; print -u2 'O app The Carousel Maker precisa estar aberto pra pesquisar.'; exit 1
      fi
      sleep 0.5
    done
    print -u2 'A pesquisa passou de 15 minutos sem resposta. Confira o canvas: as publicações concluídas já foram importadas.'; exit 1
    """
}

private actor SellerList {
    private(set) var ids: [String] = []
    func add(_ id: String) { ids.append(id) }
}
