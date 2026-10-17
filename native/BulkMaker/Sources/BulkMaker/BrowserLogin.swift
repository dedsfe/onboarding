import AppKit
import SwiftUI
import WebKit

/// The Mac's default browser, the one links open in. Signing in there means Google, Apple, Facebook, passkeys
/// and saved passwords all work as the person is used to.
struct DefaultBrowser: Equatable {
    enum Kind { case chromium, safari, unsupported }

    let app: URL
    let name: String
    let kind: Kind

    /// Chrome and its relatives all speak the same debugging protocol, so the app can watch their cookies.
    static let chromiumIDs: Set<String> = [
        "com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.dev", "com.google.Chrome.canary",
        "org.chromium.Chromium", "com.brave.Browser", "com.brave.Browser.beta", "com.microsoft.edgemac",
        "company.thebrowser.Browser", "company.thebrowser.dia", "com.vivaldi.Vivaldi",
        "com.operasoftware.Opera", "ai.perplexity.comet"
    ]

    static var current: DefaultBrowser? {
        guard let app = NSWorkspace.shared.urlForApplication(toOpen: URL(string: "https://www.tiktok.com")!),
              let bundle = Bundle(url: app), let id = bundle.bundleIdentifier else { return nil }
        let name = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            ?? bundle.object(forInfoDictionaryKey: "CFBundleName") as? String
            ?? app.deletingPathExtension().lastPathComponent
        let kind: Kind = id == "com.apple.Safari" ? .safari : chromiumIDs.contains(id) ? .chromium : .unsupported
        return DefaultBrowser(app: app, name: name, kind: kind)
    }

    var executable: URL? { Bundle(url: app)?.executableURL }

    /// How Safari presents itself, so the hidden pages using a session brought from it look like that same Safari.
    var safariUserAgent: String {
        let version = Bundle(url: app)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "26.0"
        return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/\(version) Safari/605.1.15"
    }
}

/// Signs in to TikTok or Instagram in the person's default browser, then brings the session into the project.
/// - Chrome-like browsers run on a profile of their own (one per project, under Application Support) with a local
///   debugging port; the app watches the cookies over that port and closes that window once the session appears.
///   The person's everyday profile is never read or touched.
/// - Safari opens as it is, with the person's own logins. The app reads the site's cookies from Safari's cookie
///   file, which macOS only allows with Full Disk Access, and leaves Safari open.
@MainActor
final class BrowserLogin: ObservableObject {
    enum Phase: Equatable { case starting, needsAccess, waiting, importing, done(String?), failed(String) }

    @Published private(set) var phase: Phase = .starting
    let network: SocialNetwork
    let browser: DefaultBrowser
    private var process: Process?
    private var task: Task<Void, Never>?
    private let port = Int.random(in: 39_200...39_900)

    init(network: SocialNetwork, browser: DefaultBrowser) {
        self.network = network
        self.browser = browser
    }

    func start() {
        guard task == nil else { return }
        let project = SocialSessions.shared.projectID
        switch browser.kind {
        case .chromium: startChromium(project: project)
        case .safari: task = Task { await watchSafari(project: project) }
        case .unsupported: phase = .failed("O \(browser.name) não deixa o app trazer o login.")
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
        if let process, process.isRunning { process.terminate() }
        process = nil
    }

    /// Privacy & Security › Full Disk Access.
    func openAccessSettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")!)
    }

    // MARK: Chrome-like

    private func startChromium(project: UUID) {
        guard let executable = browser.executable else {
            phase = .failed("Não deu pra abrir o \(browser.name).")
            return
        }
        let profile = TerminalHandoff.projectDirectory
            .appendingPathComponent("Chrome", isDirectory: true)
            .appendingPathComponent(project.uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: profile, withIntermediateDirectories: true)
        let chrome = Process()
        chrome.executableURL = executable
        chrome.arguments = [
            "--user-data-dir=\(profile.path)", "--remote-debugging-port=\(port)",
            "--remote-allow-origins=http://127.0.0.1:\(port)",
            "--no-first-run", "--no-default-browser-check", "--new-window",
            network.browserLoginURL.absoluteString
        ]
        do { try chrome.run() } catch {
            phase = .failed("Não deu pra abrir o \(browser.name).")
            return
        }
        process = chrome
        task = Task { await watchChromium(project: project) }
    }

    private func watchChromium(project: UUID) async {
        guard let socket = await connect() else {
            phase = .failed("O \(browser.name) abriu, mas não respondeu. Feche a janela desse login e tente de novo.")
            return
        }
        phase = .waiting
        defer { socket.cancel(with: .goingAway, reason: nil) }
        var id = 0
        while !Task.isCancelled {
            id += 1
            guard let cookies = await call(socket, id: id, method: "Storage.getCookies")?["cookies"] as? [[String: Any]] else {
                // Closed by the person before finishing.
                if process?.isRunning != true { phase = .failed("O \(browser.name) foi fechado antes de terminar o login.") ; return }
                try? await Task.sleep(for: .seconds(1)); continue
            }
            let mine = cookies.compactMap(Self.cookie(from:)).filter { $0.domain.contains(network.domain) }
            if SocialSessions.hasSession(mine, network) {
                phase = .importing
                // The site keeps writing cookies right after login; let it settle, then take them all.
                try? await Task.sleep(for: .seconds(2))
                id += 1
                let settled = (await call(socket, id: id, method: "Storage.getCookies")?["cookies"] as? [[String: Any]])?
                    .compactMap(Self.cookie(from:)).filter { $0.domain.contains(network.domain) } ?? mine
                id += 1
                let agent = (await call(socket, id: id, method: "Browser.getVersion")?["userAgent"] as? String)?
                    .replacingOccurrences(of: "HeadlessChrome", with: "Chrome")
                await finish(project: project, cookies: settled, agent: agent)
                id += 1
                _ = await call(socket, id: id, method: "Browser.close")
                return
            }
            try? await Task.sleep(for: .seconds(1))
        }
    }

    /// The browser takes a moment to open its port; the browser-wide socket is listed at /json/version.
    private func connect() async -> URLSessionWebSocketTask? {
        let version = URL(string: "http://127.0.0.1:\(port)/json/version")!
        for _ in 0..<40 {
            if let (data, _) = try? await URLSession.shared.data(from: version),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let address = (json["webSocketDebuggerUrl"] as? String).flatMap(URL.init(string:)) {
                let socket = URLSession.shared.webSocketTask(with: address)
                socket.maximumMessageSize = 64 * 1024 * 1024
                socket.resume()
                return socket
            }
            try? await Task.sleep(for: .milliseconds(500))
        }
        return nil
    }

    private func call(_ socket: URLSessionWebSocketTask, id: Int, method: String) async -> [String: Any]? {
        let message = #"{"id":\#(id),"method":"\#(method)"}"#
        guard (try? await socket.send(.string(message))) != nil else { return nil }
        // Events can arrive first; skip to the answer with this id.
        for _ in 0..<50 {
            guard let reply = try? await socket.receive() else { return nil }
            let text: String
            switch reply {
            case .string(let value): text = value
            case .data(let value): text = String(decoding: value, as: UTF8.self)
            @unknown default: continue
            }
            guard let json = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                  json["id"] as? Int == id else { continue }
            return json["result"] as? [String: Any]
        }
        return nil
    }

    /// A CDP cookie as an HTTPCookie WebKit accepts.
    nonisolated static func cookie(from raw: [String: Any]) -> HTTPCookie? {
        guard let name = raw["name"] as? String, let value = raw["value"] as? String,
              let domain = raw["domain"] as? String else { return nil }
        var properties: [HTTPCookiePropertyKey: Any] = [
            .name: name, .value: value, .domain: domain, .path: raw["path"] as? String ?? "/"
        ]
        if raw["secure"] as? Bool == true { properties[.secure] = "TRUE" }
        if raw["session"] as? Bool != true, let expires = raw["expires"] as? Double, expires > 0 {
            properties[.expires] = Date(timeIntervalSince1970: expires)
        }
        if raw["httpOnly"] as? Bool == true { properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
        if let sameSite = raw["sameSite"] as? String { properties[.sameSitePolicy] = sameSite.lowercased() }
        return HTTPCookie(properties: properties)
    }

    // MARK: Safari

    private func watchSafari(project: UUID) async {
        if !SafariCookies.isReadable {
            phase = .needsAccess
            while !SafariCookies.isReadable {
                guard !Task.isCancelled else { return }
                try? await Task.sleep(for: .seconds(1))
            }
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        do {
            try await NSWorkspace.shared.open([network.browserLoginURL], withApplicationAt: browser.app, configuration: configuration)
        } catch {
            phase = .failed("Não deu pra abrir o \(browser.name).")
            return
        }
        phase = .waiting
        while !Task.isCancelled {
            // Safari writes its cookie file a moment after the site sets them; already signed in there counts too.
            let mine = SafariCookies.session(for: network)
            if SocialSessions.hasSession(mine, network) {
                phase = .importing
                try? await Task.sleep(for: .seconds(2))
                let settled = SafariCookies.session(for: network)
                await finish(project: project, cookies: SocialSessions.hasSession(settled, network) ? settled : mine,
                             agent: browser.safariUserAgent)
                return
            }
            try? await Task.sleep(for: .seconds(1))
        }
    }

    // MARK: Both

    private func finish(project: UUID, cookies: [HTTPCookie], agent: String?) async {
        let store = SocialSessions.shared.store(for: project).httpCookieStore
        for cookie in cookies { await store.setCookie(cookie) }
        if let agent { SocialSessions.shared.rememberUserAgent(agent, for: network, project: project) }
        let handle = await SocialSessions.fetchHandle(network, cookies: cookies)
        SocialSessions.shared.didSignIn(network, handle: handle)
        if network == .instagram {
            NotificationCenter.default.post(name: .instagramSessionRestored, object: project)
        }
        phase = .done(handle)
    }
}

/// Safari's cookies, read from its `Cookies.binarycookies` files: the default profile's and one per Safari profile.
enum SafariCookies {
    static var files: [URL] {
        let data = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Containers/com.apple.Safari/Data/Library", isDirectory: true)
        var files = [data.appendingPathComponent("Cookies/Cookies.binarycookies")]
        let stores = data.appendingPathComponent("WebKit/WebsiteDataStore", isDirectory: true)
        for store in (try? FileManager.default.contentsOfDirectory(at: stores, includingPropertiesForKeys: nil)) ?? [] {
            files.append(store.appendingPathComponent("Cookies/Cookies.binarycookies"))
        }
        return files.filter { FileManager.default.fileExists(atPath: $0.path) }
    }

    /// Without Full Disk Access macOS refuses to open the file, even though it can see it.
    static var isReadable: Bool {
        let file = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies")
        return (try? FileHandle(forReadingFrom: file))?.readData(ofLength: 4) == Data("cook".utf8)
    }

    /// The site's live cookies from the most recently used Safari profile that is signed in to it.
    static func session(for network: SocialNetwork) -> [HTTPCookie] {
        let byRecency = files.sorted {
            let a = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let b = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return a > b
        }
        for file in byRecency {
            guard let data = try? Data(contentsOf: file) else { continue }
            let mine = parse(data).filter { $0.domain.contains(network.domain) && ($0.expiresDate ?? .distantFuture) > Date() }
            if SocialSessions.hasSession(mine, network) { return mine }
        }
        return []
    }

    /// The binarycookies layout: "cook", a big-endian page count and page sizes, then pages of little-endian
    /// cookie records whose strings are NUL-terminated at offsets from the record's start.
    static func parse(_ data: Data) -> [HTTPCookie] {
        let bytes = [UInt8](data)
        func u32(_ at: Int, big: Bool = false) -> Int? {
            guard at >= 0, at + 4 <= bytes.count else { return nil }
            let b = bytes[at..<at + 4].map(UInt32.init)
            return Int(big ? b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3] : b[3] << 24 | b[2] << 16 | b[1] << 8 | b[0])
        }
        func f64(_ at: Int) -> Double? {
            guard at >= 0, at + 8 <= bytes.count else { return nil }
            var raw: UInt64 = 0
            for i in (0..<8).reversed() { raw = raw << 8 | UInt64(bytes[at + i]) }
            return Double(bitPattern: raw)
        }
        func string(_ at: Int, end: Int) -> String? {
            guard at >= 0, at < end, end <= bytes.count, let nul = bytes[at..<end].firstIndex(of: 0) else { return nil }
            return String(decoding: bytes[at..<nul], as: UTF8.self)
        }
        guard bytes.starts(with: Array("cook".utf8)), let pageCount = u32(4, big: true), pageCount < 100_000 else { return [] }
        var cookies: [HTTPCookie] = []
        var page = 8 + pageCount * 4
        for index in 0..<pageCount {
            guard let size = u32(8 + index * 4, big: true), page + size <= bytes.count else { break }
            defer { page += size }
            guard let count = u32(page + 4), count < 100_000 else { continue }
            for slot in 0..<count {
                guard let offset = u32(page + 8 + slot * 4), let length = u32(page + offset), length >= 56 else { continue }
                let start = page + offset, end = start + length
                guard end <= page + size, let flags = u32(start + 8),
                      let domainAt = u32(start + 16), let nameAt = u32(start + 20),
                      let pathAt = u32(start + 24), let valueAt = u32(start + 28),
                      let domain = string(start + domainAt, end: end), let name = string(start + nameAt, end: end),
                      let path = string(start + pathAt, end: end), let value = string(start + valueAt, end: end),
                      let expires = f64(start + 40) else { continue }
                var properties: [HTTPCookiePropertyKey: Any] = [
                    .name: name, .value: value, .domain: domain, .path: path.isEmpty ? "/" : path,
                    .expires: Date(timeIntervalSinceReferenceDate: expires)
                ]
                if flags & 1 != 0 { properties[.secure] = "TRUE" }
                if flags & 4 != 0 { properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
                if let cookie = HTTPCookie(properties: properties) { cookies.append(cookie) }
            }
        }
        return cookies
    }
}

extension SocialNetwork {
    /// In a real browser every way in works, so TikTok opens on its full login page, not the QR code.
    var browserLoginURL: URL {
        URL(string: self == .tiktok ? "https://www.tiktok.com/login?lang=pt-BR" : "https://www.instagram.com/accounts/login/?hl=pt-br")!
    }
}

/// While the person signs in over in their browser: what's happening, and a way out.
struct BrowserLoginSheet: View {
    let network: SocialNetwork
    let close: () -> Void
    @StateObject private var login: BrowserLogin

    init(network: SocialNetwork, browser: DefaultBrowser, close: @escaping () -> Void) {
        self.network = network
        self.close = close
        _login = StateObject(wrappedValue: BrowserLogin(network: network, browser: browser))
    }

    private var browserName: String { login.browser.name }
    private var appName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "este app"
    }

    var body: some View {
        VStack(spacing: 22) {
            ZStack(alignment: .bottomTrailing) {
                SocialMark(network: network, size: 76)
                badge.offset(x: 10, y: 10)
            }
            .padding(.top, 8)
            VStack(spacing: 8) {
                Text(title).font(.system(size: 22, weight: .semibold))
                Text(detail)
                    .font(.system(size: 14))
                    .foregroundStyle(.white.opacity(0.6))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 10) {
                switch login.phase {
                case .failed:
                    Button("Cancelar") { login.cancel(); close() }.buttonStyle(.appSecondary)
                    Button("Tentar de novo") { login.cancel(); SocialSessions.shared.signingIn = nil
                        DispatchQueue.main.async { SocialSessions.shared.signingIn = network } }
                        .buttonStyle(.appPrimary)
                case .needsAccess:
                    Button("Cancelar") { login.cancel(); close() }.buttonStyle(.appSecondary)
                    Button("Abrir Ajustes") { login.openAccessSettings() }.buttonStyle(.appPrimary)
                case .done:
                    EmptyView()
                default:
                    Button("Cancelar") { login.cancel(); close() }.buttonStyle(.appSecondary)
                }
            }
        }
        .padding(32)
        .frame(width: 420)
        .modalPanel()
        .onAppear { login.start() }
        .onDisappear { if case .done = login.phase {} else { login.cancel() } }
        .onChange(of: login.phase) { _, phase in
            guard case .done = phase else { return }
            NSApp.activate()
            Task { try? await Task.sleep(for: .seconds(1.4)); close() }
        }
        .animation(.snappy(duration: 0.25), value: login.phase)
    }

    @ViewBuilder private var badge: some View {
        switch login.phase {
        case .done:
            Image(systemName: "checkmark.circle.fill").font(.system(size: 28)).foregroundStyle(.white, .green)
                .transition(.scale.combined(with: .opacity))
        case .failed:
            Image(systemName: "exclamationmark.circle.fill").font(.system(size: 28)).foregroundStyle(.white, .orange)
        case .needsAccess:
            Image(systemName: "lock.circle.fill").font(.system(size: 28)).foregroundStyle(.white, .blue)
        default:
            ProgressView().controlSize(.small)
                .padding(7).background(Circle().fill(.black.opacity(0.6)))
        }
    }

    private var title: String {
        switch login.phase {
        case .starting: return "Abrindo o \(browserName)…"
        case .needsAccess: return "Libere o acesso ao \(browserName)"
        case .waiting: return "Entre no \(network.title) pelo \(browserName)"
        case .importing: return "Trazendo seu login…"
        case .done(let handle): return handle.map { "Conectado como \($0)" } ?? "Conectado"
        case .failed: return "Não deu certo"
        }
    }

    private var detail: String {
        switch login.phase {
        case .failed(let message): return message
        case .needsAccess:
            return "Pra trazer seu login do \(browserName), ative o \(appName) em Privacidade e Segurança › Acesso Total ao Disco. Só os cookies do \(network.title) são lidos."
        case .done: return "Fica salvo só neste projeto."
        default:
            let already = login.browser.kind == .safari ? " Se já estiver logado lá, é só esperar." : ""
            return "Use Google, passkey, QR code ou senha, como preferir.\(already) Assim que você entrar, o app volta sozinho."
        }
    }
}
