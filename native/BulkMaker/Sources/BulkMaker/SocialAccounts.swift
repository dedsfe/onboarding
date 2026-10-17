import AppKit
import SwiftUI
import WebKit

/// TikTok and Instagram logins, one pair per project: each project keeps its own WebKit data store, so a
/// project can post as one Instagram and research as one TikTok while another project uses other accounts.
/// The login is just the site's own session cookie in that store; the handle shown is cached per project.
enum SocialNetwork: String, CaseIterable, Identifiable {
    case tiktok, instagram

    var id: String { rawValue }
    var title: String { self == .tiktok ? "TikTok" : "Instagram" }
    var domain: String { self == .tiktok ? "tiktok.com" : "instagram.com" }
    var loginURL: URL {
        URL(string: self == .tiktok ? "https://www.tiktok.com/login/qrcode?lang=pt-BR" : "https://www.instagram.com/accounts/login/?hl=pt-br")!
    }
    /// Under the sheet's title. Passkeys can't work in an app's embedded browser (Apple keeps WebAuthn for
    /// real browsers), so TikTok opens on its QR code: scan it with the phone app, no password at all.
    var loginHint: String {
        self == .tiktok ? "Abra o TikTok no celular e escaneie o código. Sem senha."
            : "Seu login fica salvo só neste projeto."
    }

    /// What the login unlocks, in one line.
    var purpose: String {
        self == .tiktok ? "Pesquisa sem limite e contas do nicho avaliadas por inteiro."
            : "Organiza os carrosséis na agenda do projeto."
    }
}

@MainActor
final class SocialSessions: ObservableObject {
    static let shared = SocialSessions()

    /// "@handle" per network for the open project; "" = connected but the handle wasn't read yet.
    @Published private(set) var handles: [SocialNetwork: String] = [:]
    /// The login sheet on screen, if any.
    @Published var signingIn: SocialNetwork?
    /// Bumped when the open project changes, so web views rebuild on the new project's store.
    @Published private(set) var projectID: UUID

    private var stores: [UUID: WKWebsiteDataStore] = [:]

    private init() {
        projectID = ProjectStore.shared.current.id
        Task { await migrateDefaultLoginOnce(); await refresh() }
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.followProject() }
        }
    }

    func store(for project: UUID) -> WKWebsiteDataStore {
        if let store = stores[project] { return store }
        let store = WKWebsiteDataStore(forIdentifier: project)
        stores[project] = store
        return store
    }

    var currentStore: WKWebsiteDataStore { store(for: projectID) }

    func isConnected(_ network: SocialNetwork) -> Bool { handles[network] != nil }

    private func followProject() {
        let id = ProjectStore.shared.current.id
        guard id != projectID else { return }
        projectID = id
        handles = [:]
        Task { await refresh() }
    }

    /// Reads which sites have a session in the open project's store, and the cached handles.
    func refresh() async {
        let project = projectID
        let cookies = await currentStore.httpCookieStore.allCookies()
        var found: [SocialNetwork: String] = [:]
        for network in SocialNetwork.allCases where Self.hasSession(cookies, network) {
            found[network] = UserDefaults.standard.string(forKey: Self.handleKey(network, project)) ?? ""
        }
        guard project == projectID else { return }
        handles = found
        // A session without a known handle (one carried over, or read before the page was ready): ask the site.
        for (network, handle) in found where handle.isEmpty {
            guard let read = await Self.fetchHandle(network, cookies: cookies), project == projectID else { continue }
            didSignIn(network, handle: read)
        }
    }

    /// The same question `readHandle` asks inside the page, sent with the project's cookies.
    nonisolated static func fetchHandle(_ network: SocialNetwork, cookies: [HTTPCookie]) async -> String? {
        let mine = cookies.filter { $0.domain.contains(network.domain) }
        var request: URLRequest
        switch network {
        case .tiktok:
            request = URLRequest(url: URL(string: "https://www.tiktok.com/passport/web/account/info/?aid=1988")!)
        case .instagram:
            guard let id = mine.first(where: { $0.name == "ds_user_id" })?.value else { return nil }
            request = URLRequest(url: URL(string: "https://www.instagram.com/api/v1/users/\(id)/info/")!)
            request.setValue("936619743392459", forHTTPHeaderField: "X-IG-App-ID")
        }
        request.setValue(mine.map { "\($0.name)=\($0.value)" }.joined(separator: "; "), forHTTPHeaderField: "Cookie")
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
                         forHTTPHeaderField: "User-Agent")
        request.httpShouldHandleCookies = false
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        let name = network == .tiktok ? (json["data"] as? [String: Any])?["username"] as? String
            : (json["user"] as? [String: Any])?["username"] as? String
        return name.flatMap { $0.isEmpty ? nil : "@" + $0 }
    }

    func didSignIn(_ network: SocialNetwork, handle: String?) {
        if let handle, !handle.isEmpty {
            UserDefaults.standard.set(handle, forKey: Self.handleKey(network, projectID))
        }
        handles[network] = handle ?? handles[network] ?? ""
    }

    /// The browser the session was made in. TikTok ties a session to its browser, so the hidden pages that use a
    /// session brought from Chrome present themselves as that same Chrome.
    func rememberUserAgent(_ agent: String, for network: SocialNetwork, project: UUID) {
        UserDefaults.standard.set(agent, forKey: Self.handleKey(network, project) + ".agent")
    }

    func userAgent(for network: SocialNetwork) -> String? {
        UserDefaults.standard.string(forKey: Self.handleKey(network, projectID) + ".agent")
    }

    /// Forgets the site's session in this project only; other projects keep theirs.
    func signOut(_ network: SocialNetwork) async {
        let store = currentStore
        let records = await store.dataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes())
        let site = records.filter { $0.displayName.contains(network.domain.components(separatedBy: ".")[0]) }
        await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: site)
        for cookie in await store.httpCookieStore.allCookies() where cookie.domain.contains(network.domain) {
            await store.httpCookieStore.deleteCookie(cookie)
        }
        UserDefaults.standard.removeObject(forKey: Self.handleKey(network, projectID))
        UserDefaults.standard.removeObject(forKey: Self.handleKey(network, projectID) + ".agent")
        handles[network] = nil
    }

    nonisolated static func hasSession(_ cookies: [HTTPCookie], _ network: SocialNetwork) -> Bool {
        cookies.contains { $0.domain.contains(network.domain) && $0.name == "sessionid" && !$0.value.isEmpty }
    }

    /// The "@handle" last seen for any project, open or not; nil when it never signed in to the site.
    nonisolated static func cachedHandle(_ network: SocialNetwork, project: UUID) -> String? {
        UserDefaults.standard.string(forKey: handleKey(network, project))
    }

    nonisolated private static func handleKey(_ network: SocialNetwork, _ project: UUID) -> String {
        "social.\(project.uuidString).\(network.rawValue)"
    }

    /// Before projects had their own logins, Instagram lived in WebKit's shared store. The project open at
    /// the first launch of this version inherits that login, so nobody is signed out by the update.
    private func migrateDefaultLoginOnce() async {
        let key = "social.migratedDefaultStore"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        UserDefaults.standard.set(true, forKey: key)
        let target = currentStore.httpCookieStore
        for cookie in await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        where SocialNetwork.allCases.contains(where: { cookie.domain.contains($0.domain) }) {
            await target.setCookie(cookie)
        }
    }

    /// Reads "@handle" from inside the logged-in page, on the site's own origin.
    static func readHandle(_ network: SocialNetwork, in webView: WKWebView) async -> String? {
        let script: String
        switch network {
        case .tiktok:
            script = """
            const r = await fetch('/passport/web/account/info/?aid=1988', { credentials: 'include' });
            const j = await r.json(); return (j && j.data && j.data.username) || null;
            """
        case .instagram:
            script = """
            const id = (document.cookie.match(/ds_user_id=(\\d+)/) || [])[1]; if (!id) return null;
            const r = await fetch('/api/v1/users/' + id + '/info/', { credentials: 'include', headers: { 'X-IG-App-ID': '936619743392459' } });
            const j = await r.json(); return (j && j.user && j.user.username) || null;
            """
        }
        let value = try? await webView.callAsyncJavaScript(script, arguments: [:], contentWorld: .page)
        return (value as? String).map { "@" + $0 }
    }
}

// MARK: - Settings section

/// "Contas conectadas": one card per network, for the open project.
struct ConnectedAccountsView: View {
    @ObservedObject private var sessions = SocialSessions.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Cada projeto tem as próprias contas. Estas são as do projeto \(ProjectStore.shared.current.name).")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
            ForEach(SocialNetwork.allCases) { network in
                AccountCard(network: network, handle: sessions.handles[network],
                            connect: { sessions.signingIn = network },
                            signOut: { Task { await sessions.signOut(network) } })
            }
        }
        .task(id: sessions.projectID) { await sessions.refresh() }
    }
}

private struct AccountCard: View {
    let network: SocialNetwork
    let handle: String?
    let connect: () -> Void
    let signOut: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 14) {
            SocialMark(network: network, size: 44)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 7) {
                    Text(network.title).font(.system(size: 15, weight: .semibold))
                    if handle != nil {
                        HStack(spacing: 4) {
                            Circle().fill(Color.green).frame(width: 6, height: 6)
                            Text("Conectado").font(.system(size: 11, weight: .semibold))
                        }
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Capsule().fill(Color.green.opacity(0.14)))
                        .foregroundStyle(Color.green)
                    }
                }
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 12)
            if handle != nil {
                Menu {
                    Button("Trocar de conta", action: connect)
                    Divider()
                    Button("Sair", role: .destructive, action: signOut)
                } label: {
                    Image(systemName: "ellipsis")
                }
                .menuStyle(.button)
                .buttonStyle(.appIcon)
                .menuIndicator(.hidden)
                .fixedSize()
            } else {
                Button(action: connect) {
                    HStack(spacing: 6) {
                        Text("Conectar")
                        Image(systemName: "arrow.up.right")
                            .offset(x: hovering ? 2 : 0, y: hovering ? -2 : 0)
                    }
                }
                .buttonStyle(.appPrimary)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.primary.opacity(hovering ? 0.06 : 0.035)))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.primary.opacity(0.06)))
        .onHover { over in withAnimation(.snappy(duration: 0.18)) { hovering = over } }
    }

    private var subtitle: String {
        guard let handle else { return network.purpose }
        return handle.isEmpty ? "Sessão ativa neste projeto" : "Conectado como \(handle)"
    }
}

/// The networks' official app icons (from the App Store, in Resources), in the same rounded square.
struct SocialMark: View {
    let network: SocialNetwork
    var size: CGFloat = 40

    private static let icons: [SocialNetwork: NSImage] = Dictionary(uniqueKeysWithValues: SocialNetwork.allCases.compactMap { network in
        Bundle.module.url(forResource: "logo-\(network.rawValue)", withExtension: "png")
            .flatMap(NSImage.init(contentsOf:)).map { (network, $0) }
    })

    var body: some View {
        Group {
            if let icon = Self.icons[network] {
                Image(nsImage: icon).resizable().interpolation(.high)
            } else {
                Color.secondary.opacity(0.2)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.225, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: size * 0.08, y: size * 0.04)
        .accessibilityLabel(network.title)
    }
}

// MARK: - Login sheet

/// Put once over the app: shows the login sheet whenever something asks for one.
struct SocialLoginHost: View {
    @ObservedObject private var sessions = SocialSessions.shared

    var body: some View {
        ZStack {
            if let network = sessions.signingIn {
                // A stray click outside (coming back from the Google window) must not throw the login away.
                ModalBackdrop {}.transition(.opacity)
                Group {
                    // The Mac's default browser when the app can bring a login back from it: Google, Apple and
                    // passkeys only work in a real browser.
                    if let browser = DefaultBrowser.current, browser.kind != .unsupported {
                        BrowserLoginSheet(network: network, browser: browser) { sessions.signingIn = nil }
                    } else {
                        SocialLoginSheet(network: network) { sessions.signingIn = nil }
                    }
                }
                .id(network)
                .transition(.scale(scale: 0.97).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.25), value: sessions.signingIn)
    }
}

/// The site's own login page inside the app, on the open project's store. It closes by itself as soon as
/// the site sets its session, and reads the handle to show "Conectado como @…".
struct SocialLoginSheet: View {
    let network: SocialNetwork
    let close: () -> Void
    @StateObject private var model: SocialLoginModel

    init(network: SocialNetwork, close: @escaping () -> Void) {
        self.network = network
        self.close = close
        _model = StateObject(wrappedValue: SocialLoginModel(network: network))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Not ModalHeader: its ✓ answers Return, and Return is how people submit the site's login form.
            HStack(spacing: 12) {
                SocialMark(network: network, size: 30)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Entrar no \(network.title)").font(.system(size: 17, weight: .semibold))
                    Text(model.status).font(.system(size: 12)).foregroundStyle(.white.opacity(0.55)).lineLimit(1)
                }
                Spacer(minLength: 16)
                Button(action: close) {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.appIcon)
                .help("Fechar")
            }
            .padding(.horizontal, 18).padding(.top, 18).padding(.bottom, 14)
            ZStack {
                LoginWebView(webView: model.webView)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .opacity(model.done ? 0.25 : 1)
                if model.done {
                    VStack(spacing: 10) {
                        Image(systemName: "checkmark.circle.fill").font(.system(size: 44)).foregroundStyle(.green)
                        Text(model.handle.map { "Conectado como \($0)" } ?? "Conectado")
                            .font(.system(size: 17, weight: .semibold))
                    }
                    .transition(.scale.combined(with: .opacity))
                }
            }
            .padding(.horizontal, 14).padding(.bottom, 14)
        }
        .frame(width: 480, height: 640)
        .modalPanel()
        .onDisappear { model.closePopups() }
        .onChange(of: model.done) { _, done in
            guard done else { return }
            Task { try? await Task.sleep(for: .seconds(1.1)); close() }
        }
    }
}

@MainActor
final class SocialLoginModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    let network: SocialNetwork
    let webView: WKWebView
    @Published var done = false
    @Published var handle: String?
    @Published var status: String
    private var timer: Timer?
    private var popups: [(view: WKWebView, window: NSWindow)] = []

    init(network: SocialNetwork) {
        self.network = network
        status = network.loginHint
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = SocialSessions.shared.currentStore
        configuration.applicationNameForUserAgent = "Version/26.0 Safari/605.1.15"
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        // Google, Apple and Facebook refuse to sign in inside an app's browser (Google answers 400, passkeys
        // never prompt). Their buttons only lead to dead ends, so they're hidden: QR code, phone, e-mail stay.
        configuration.userContentController.addUserScript(WKUserScript(source: Self.hideThirdParty,
                                                                       injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.load(URLRequest(url: network.loginURL))
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.check() }
        }
    }

    private func check() {
        guard !done else { return }
        let store = webView.configuration.websiteDataStore.httpCookieStore
        Task {
            let cookies = await store.allCookies()
            guard !done, SocialSessions.hasSession(cookies, network) else { return }
            NSLog("SocialLogin: %@ session cookie found", network.rawValue)
            timer?.invalidate()
            closePopups()
            status = "Conectando…"
            // The page sets the cookie before it finishes signing in; give it a beat before asking who it is.
            try? await Task.sleep(for: .seconds(1.5))
            handle = await SocialSessions.readHandle(network, in: webView)
            SocialSessions.shared.didSignIn(network, handle: handle)
            if network == .instagram {
                NotificationCenter.default.post(name: .instagramSessionRestored, object: SocialSessions.shared.projectID)
            }
            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) { done = true }
        }
    }

    private static let hideThirdParty = """
    (function(){
      const names = /^(continu(e|ar) (with|com) |entrar com |log in with |sign in with )?(google|facebook|apple|line|kakaotalk|twitter|x)$/i;
      const hide = () => document.querySelectorAll('a, button, div[role="button"], div[role="link"]').forEach(el => {
        const text = (el.innerText || '').trim();
        if (text && text.length < 40 && names.test(text)) el.style.display = 'none';
      });
      hide(); new MutationObserver(hide).observe(document.documentElement, { childList: true, subtree: true });
    })();
    """

    /// "Continuar com Google", Facebook, Apple: the site opens a real popup and waits for it to report back
    /// (window.opener), so it gets its own window, built from the configuration WebKit hands over.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        let popup = WKWebView(frame: NSRect(x: 0, y: 0, width: 520, height: 680), configuration: configuration)
        popup.uiDelegate = self
        popup.customUserAgent = webView.customUserAgent
        let window = NSWindow(contentRect: popup.frame, styleMask: [.titled, .closable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "Entrar no \(network.title)"
        window.isReleasedWhenClosed = false
        window.contentView = popup
        window.center()
        window.makeKeyAndOrderFront(nil)
        popups.append((popup, window))
        return popup
    }

    /// The popup calls window.close() when it's done; the login sheet stays.
    func webViewDidClose(_ webView: WKWebView) {
        guard let index = popups.firstIndex(where: { $0.view === webView }) else { return }
        popups[index].window.orderOut(nil)
        popups.remove(at: index)
    }

    func closePopups() {
        popups.forEach { $0.window.orderOut(nil) }
        popups.removeAll()
    }

    deinit { timer?.invalidate() }
}

private struct LoginWebView: NSViewRepresentable {
    let webView: WKWebView
    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
