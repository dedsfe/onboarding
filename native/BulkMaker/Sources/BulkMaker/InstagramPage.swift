import AppKit
import CarouselEngine
import ImageIO
import SwiftUI
import UniformTypeIdentifiers
import WebKit

/// The "Postar" tab: the scheduled posts on the left, Instagram running inside the app on the right.
/// Picking a post opens Instagram's new post with that carousel's slides already in it.
struct InstagramPage: View {
    @State private var agenda = PostAgenda()
    @State private var agendaStamp: Date?
    @State private var sendingID: String?
    @State private var sentIDs: Set<String> = []
    @State private var hoveredID: String?
    @State private var status: String?
    @State private var statusIsError = false
    @ObservedObject private var poster = InstagramAutoPoster.shared
    @ObservedObject private var browser = InstagramBrowser.shared
    @ObservedObject private var pageHealth = InstagramBrowser.shared.health
    @ObservedObject private var sessions = SocialSessions.shared

    private static var agendaFile: URL {
        TerminalHandoff.projectDirectory.appendingPathComponent(".bulk-maker/agenda.json")
    }

    var body: some View {
        HStack(spacing: 12) {
            postColumn.frame(width: 260)
            VStack(alignment: .leading, spacing: 0) {
                if let issue = pageHealth.issue {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(issue.message)
                            .font(.system(size: 13, weight: .medium))
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 12) {
                            Button("Recarregar página") { browser.reload() }
                                .buttonStyle(.appSecondary)
                            Button("Reconectar conta") { sessions.signingIn = .instagram }
                                .buttonStyle(.appSecondary)
                        }
                        .disabled(browser.isBusy)
                    }
                    .foregroundStyle(.black)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                InstagramWebView().clipShape(.rect(cornerRadius: 12))
            }
            .background(.white, in: .rect(cornerRadius: 12))
        }
        .padding(.horizontal, 16).padding(.bottom, 16)
        .onAppear(perform: reloadAgenda)
        // The AI schedules from the terminal while this page is open.
        .onReceive(Timer.publish(every: 2, on: .main, in: .common).autoconnect()) { _ in reloadAgenda() }
    }

    private var upcoming: [PostAgenda.Post] {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        let now = formatter.string(from: Date())
        return agenda.posts.filter { $0.date + " " + $0.time >= now }
    }

    private var postColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("PRÓXIMOS POSTS").font(.system(size: 11, weight: .bold)).tracking(1.3)
                Spacer()
                Text("\(upcoming.count)").font(.system(size: 11, weight: .semibold)).monospacedDigit()
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 10)

            if upcoming.isEmpty {
                Text("Nada agendado ainda. Os posts do Calendário aparecem aqui.")
                    .font(.system(size: 13)).foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(upcoming) { post in row(post) }
                    }
                    .padding(.horizontal, 8).padding(.bottom, 8)
                }
                .scrollIndicators(.never)
            }

            if let message = status ?? poster.lastMessage {
                Text(message)
                    .font(.system(size: 12))
                    .foregroundStyle((status != nil ? statusIsError : poster.lastMessageIsError) ? Color.red : .secondary)
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .glassEffect(.regular, in: .rect(cornerRadius: 12))
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: status ?? poster.lastMessage)
    }

    private func row(_ post: PostAgenda.Post) -> some View {
        let isSending = sendingID == post.id || poster.postingID == post.id
        let isHovered = hoveredID == post.id
        let failure = poster.state.failed[post.id]
        let cover = CalendarPreview.slides(in: URL(fileURLWithPath: post.folder)).first
        return Button { send(post) } label: {
            HStack(spacing: 10) {
                Group {
                    if let cover {
                        SlideImage(url: cover, maxPixel: 160) { $0.resizable().scaledToFill() }
                    } else {
                        Color.primary.opacity(0.08)
                    }
                }
                .frame(width: 36, height: 64)
                .clipShape(.rect(cornerRadius: 6))

                VStack(alignment: .leading, spacing: 3) {
                    Text(PostAgenda.describe(date: post.date, time: post.time))
                        .font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    Text(post.caption.split(separator: "\n").first.map(String.init) ?? "Sem legenda")
                        .font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer(minLength: 4)

                Group {
                    if isSending {
                        ProgressView().controlSize(.small)
                    } else if failure != nil {
                        Image(systemName: "exclamationmark.triangle").foregroundStyle(.red)
                    } else if poster.state.posted[post.id] != nil {
                        Image(systemName: "checkmark").foregroundStyle(.primary)
                    } else if sentIDs.contains(post.id) {
                        Image(systemName: "checkmark").foregroundStyle(.secondary)
                    } else if isHovered {
                        Image(systemName: "paperplane").foregroundStyle(.secondary)
                    }
                }
                .font(.system(size: 12, weight: .semibold))
                .frame(width: 18)
                .transition(.opacity)
            }
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 10).fill(.primary.opacity(isHovered || isSending ? 0.07 : 0)))
            .contentShape(.rect(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .disabled(sendingID != nil || poster.postingID != nil || pageHealth.issue != nil)
        .onHover { inside in
            withAnimation(.snappy(duration: 0.18)) { hoveredID = inside ? post.id : (hoveredID == post.id ? nil : hoveredID) }
        }
        .help(failure.map { "Não postou: \($0)" } ?? "Abrir este carrossel no Instagram")
    }

    private func send(_ post: PostAgenda.Post) {
        let slides = CalendarPreview.slides(in: URL(fileURLWithPath: post.folder))
        guard !slides.isEmpty else { return show("Os slides desse post não estão mais na pasta.", error: true) }
        guard slides.count <= 20 else { return show("O Instagram aceita até 20 imagens por carrossel.", error: true) }
        withAnimation(.snappy(duration: 0.2)) { sendingID = post.id }
        show("Mandando \(slides.count) slides pro Instagram…", error: false)
        Task {
            do {
                let step = try await InstagramBrowser.shared.startPost(slides: slides)
                sentIDs.insert(post.id)
                show(step == "legenda" ? "Pronto. Confira o post e escreva a legenda."
                                       : "Imagens no Instagram. Continue por lá.", error: false)
            } catch {
                show(error.localizedDescription, error: true)
            }
            withAnimation(.snappy(duration: 0.2)) { sendingID = nil }
        }
    }

    private func show(_ text: String, error: Bool) {
        statusIsError = error
        status = text
    }

    private func reloadAgenda() {
        let stamp = (try? Self.agendaFile.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        guard stamp != agendaStamp else { return }
        agendaStamp = stamp
        if let loaded = try? PostAgenda.load(from: Self.agendaFile) { agenda = loaded }
    }
}

/// Hosts the browser's current web view; swaps it when the open project (and so the login) changes.
private struct InstagramWebView: NSViewRepresentable {
    @ObservedObject private var sessions = SocialSessions.shared

    func makeNSView(context: Context) -> NSView { NSView() }
    func updateNSView(_ container: NSView, context: Context) {
        let webView = InstagramBrowser.shared.webView(for: sessions.projectID)
        guard webView.superview !== container else { return }
        container.subviews.forEach { $0.removeFromSuperview() }
        webView.frame = container.bounds
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)
    }
}

/// One web view per open project: leaving the tab and coming back keeps the page where it was.
/// The login lives in the project's own WebKit data store (see `SocialSessions`), which persists on disk:
/// sign in once per project and it stays.
@MainActor
final class InstagramBrowser: NSObject, ObservableObject, WKUIDelegate, WKNavigationDelegate {
    static let shared = InstagramBrowser()
    let health = InstagramPageHealth()

    private(set) var webView: WKWebView
    private var projectID: UUID
    /// True while a post is being put together; the manual and the automatic flow never overlap.
    @Published private(set) var isBusy = false
    private var pageLoaded: CheckedContinuation<Void, Error>?
    private var loadTimeout: Task<Void, Never>?
    private var healthTimer: Timer?
    private var inspecting = false
    private static let home = URL(string: "https://www.instagram.com/")!
    /// Deterministic manual QA of the recovery controls without touching an Instagram account.
    private static var recoveryPreview: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--instagram-recovery-preview")
        #else
        false
        #endif
    }

    override private init() {
        projectID = SocialSessions.shared.projectID
        webView = Self.makeWebView(store: SocialSessions.shared.currentStore)
        super.init()
        attach()
        healthTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.inspectPage() }
        }
        NotificationCenter.default.addObserver(self, selector: #selector(sessionRestored(_:)),
            name: .instagramSessionRestored, object: nil)
    }

    /// The open project's web view, rebuilt on its store when the project changed (never mid-post).
    func webView(for project: UUID) -> WKWebView {
        if project != projectID, !isBusy {
            finishLoad(error: PostError(message: "O projeto foi alterado."))
            webView.stopLoading()
            projectID = project
            health.reset()
            webView = Self.makeWebView(store: SocialSessions.shared.store(for: project))
            attach()
        }
        return webView
    }

    private static func makeWebView(store: WKWebsiteDataStore) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = recoveryPreview ? .nonPersistent() : store
        // Without a Safari token Instagram treats WebKit as an unsupported browser.
        configuration.applicationNameForUserAgent = "Version/26.0 Safari/605.1.15"
        return WKWebView(frame: .zero, configuration: configuration)
    }

    private func attach() {
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        if Self.recoveryPreview { loadRecoveryPreview() }
        else { webView.load(URLRequest(url: Self.home)) }
    }

    private func loadRecoveryPreview() {
        health.verificationRequired()
        webView.loadHTMLString("""
            <html><head><meta name="viewport" content="width=device-width"></head>
            <body style="font: 18px -apple-system; padding: 48px; background: white; color: black">
            <h1>Confirm you're human</h1>
            <img style="width:100%;max-width:600px;height:150px" src="data:image/webp;base64,bm90LWFuLWltYWdl">
            <p>Enter the code from the image</p><input aria-label="Enter the code"><button disabled>Next</button>
            </body></html>
            """, baseURL: Self.home)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard webView === self.webView else { return }
        health.beginNavigation()
        if InstagramPageHealth.isVerificationURL(webView.url) { health.verificationRequired() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === self.webView else { return }
        Task { @MainActor in
            await inspectPage()
            finishLoad()
        }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        navigationFailed(webView, error: error)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        navigationFailed(webView, error: error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webView === self.webView else { return }
        health.loadingFailed()
        finishLoad(error: PostError(message: "O Instagram parou de responder. Recarregue a página na aba Postar."))
    }

    private func navigationFailed(_ webView: WKWebView, error: Error) {
        guard webView === self.webView, (error as NSError).code != NSURLErrorCancelled else { return }
        health.loadingFailed()
        finishLoad(error: error)
    }

    private func inspectPage() async {
        guard !inspecting else { return }
        inspecting = true
        defer { inspecting = false }
        await health.inspect(webView)
    }

    private func finishLoad(error: Error? = nil) {
        loadTimeout?.cancel()
        loadTimeout = nil
        if let error { pageLoaded?.resume(throwing: error) }
        else { pageLoaded?.resume() }
        pageLoaded = nil
    }

    /// Retries the current challenge without deleting cookies or changing the project account.
    func reload() {
        guard !isBusy else { return }
        if Self.recoveryPreview { loadRecoveryPreview(); return }
        if webView.url == nil { webView.load(URLRequest(url: Self.home)) }
        else { webView.reloadFromOrigin() }
    }

    @objc private func sessionRestored(_ notification: Notification) {
        guard notification.object as? UUID == projectID, !isBusy else { return }
        webView.load(URLRequest(url: Self.home, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    private func requireReadyPage() async throws {
        await health.inspect(webView)
        if let issue = health.issue { throw PostError(message: issue.message) }
        if InstagramPageHealth.isVerificationURL(webView.url) {
            health.verificationRequired()
            throw PostError(message: "Conclua a verificação do Instagram na aba Postar antes de publicar.")
        }
    }

    /// Publishes a carousel with its caption, start to finish. Starts from a fresh Instagram home so
    /// a draft left open on screen can't get in the way.
    func publish(slides: [URL], caption: String) async throws {
        _ = webView(for: SocialSessions.shared.projectID)
        guard !isBusy else { throw PostError(message: "Já existe uma postagem em andamento.") }
        isBusy = true
        defer { isBusy = false }
        try await requireReadyPage()
        guard slides.count <= 20 else { throw PostError(message: "O Instagram aceita até 20 imagens por carrossel.") }
        // Never shown yet: give it a real size, or every control measures as hidden.
        if webView.superview == nil { webView.frame = NSRect(x: 0, y: 0, width: 1200, height: 820) }
        try await withCheckedThrowingContinuation { continuation in
            pageLoaded = continuation
            loadTimeout = Task { @MainActor [weak self] in
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
                guard let self, self.pageLoaded != nil else { return }
                self.health.loadingFailed()
                self.webView.stopLoading()
                self.finishLoad(error: PostError(message: "O Instagram demorou para carregar. Recarregue na aba Postar."))
            }
            webView.load(URLRequest(url: Self.home))
        }
        try await requireReadyPage()
        let step = try await upload(slides: slides)
        guard step == "legenda" else { throw PostError(message: "Parou antes da legenda (\(step)).") }
        try await run(Self.shareScript, arguments: ["caption": String(caption.prefix(2200))])
    }

    /// Login with Facebook and similar links ask for a new window; keep them in this one.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
        return nil
    }

    /// Opens Instagram's new post with these slides, in order, and walks to the caption when it can.
    /// Returns the step it stopped at: "legenda", "filtros" or "enviado".
    func startPost(slides: [URL]) async throws -> String {
        guard !isBusy else { throw PostError(message: "Já existe uma postagem em andamento.") }
        isBusy = true
        defer { isBusy = false }
        try await requireReadyPage()
        return try await upload(slides: slides)
    }

    private func upload(slides: [URL]) async throws -> String {
        let files = try await Task.detached(priority: .userInitiated) {
            try slides.enumerated().map { index, url in
                ["name": String(format: "slide-%02d.jpg", index + 1), "data": try Self.jpegBase64(url)]
            }
        }.value
        return try await run(Self.uploadScript, arguments: ["files": files]) as? String ?? "enviado"
    }

    @discardableResult
    private func run(_ script: String, arguments: [String: Any]) async throws -> Any? {
        try await requireReadyPage()
        do {
            return try await webView.callAsyncJavaScript(Self.helpers + script, arguments: arguments, contentWorld: .page)
        } catch let error as NSError {
            // A `throw new Error(...)` in the script arrives here with its message.
            let message = error.userInfo["WKJavaScriptExceptionMessage"] as? String
            throw PostError(message: message?.replacingOccurrences(of: "Error: ", with: "")
                ?? "O Instagram não respondeu como esperado.")
        }
    }

    struct PostError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// Re-encoded as JPEG: a fraction of the PNG size to push through JavaScript, and Instagram
    /// recompresses anyway.
    nonisolated private static func jpegBase64(_ url: URL) throws -> String {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw PostError(message: "Não deu pra ler \(url.lastPathComponent).")
        }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw PostError(message: "Não deu pra preparar \(url.lastPathComponent).")
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.92] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else {
            throw PostError(message: "Não deu pra preparar \(url.lastPathComponent).")
        }
        return (data as Data).base64EncodedString()
    }

    /// Shared by every script: finds controls by label or text in Portuguese and English, since
    /// Instagram's class names change all the time.
    private static let helpers = #"""
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const shown = el => !!el && el.getClientRects().length > 0;
    async function waitFor(find, ms) {
      const end = Date.now() + ms;
      for (;;) {
        const found = find();
        if (found) return found;
        if (Date.now() > end) return null;
        await sleep(150);
      }
    }
    function press(el) {
      const target = el.closest('a, button, [role="button"], [role="link"], [role="menuitem"]') || el;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    function find(pattern, root = document) {
      for (const el of root.querySelectorAll('[aria-label]'))
        if (pattern.test(el.getAttribute('aria-label').trim()) && shown(el)) return el;
      for (const el of root.querySelectorAll('span, div, button, a'))
        if (el.childElementCount === 0 && pattern.test(el.textContent.trim()) && shown(el)) return el;
      return null;
    }
    const dialog = () => [...document.querySelectorAll('[role="dialog"]')].filter(shown).pop();
    const fileInput = () => {
      const open = dialog();
      return (open && open.querySelector('input[type="file"]')) || document.querySelector('input[type="file"][multiple]');
    };

    """#

    /// Runs on the caption screen with `caption`: writes it and shares the post.
    private static let shareScript = #"""
    const box = await waitFor(() => (dialog() || document).querySelector('[role="textbox"][contenteditable="true"]'), 8000);
    if (!box) throw new Error('Não achei o campo da legenda.');
    box.focus();
    if (caption) {
      // A paste keeps the line breaks; typing line by line is the fallback.
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', caption);
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
      await sleep(500);
      if (!box.textContent.trim()) {
        caption.split('\n').forEach((line, index) => {
          if (index) document.execCommand('insertParagraph');
          if (line) document.execCommand('insertText', false, line);
        });
        await sleep(500);
      }
      if (!box.textContent.trim()) throw new Error('Não consegui escrever a legenda.');
    }
    const share = find(/^(share|compartilhar)$/i, dialog() || document);
    if (!share) throw new Error('Não achei o botão Compartilhar.');
    press(share);
    const done = await waitFor(() => find(/(has been shared|post shared|foi compartilhad|publicação compartilhada)/i), 120000);
    if (!done) throw new Error('Cliquei em Compartilhar, mas o Instagram não confirmou.');
    const close = find(/^(close|fechar)$/i);
    if (close) press(close);
    """#

    /// Runs inside instagram.com with `files` = [{name, data}]: opens a new post with them and walks
    /// to the caption.
    private static let uploadScript = #"""
    if (!fileInput()) {
      const create = await waitFor(() => find(/^(nova publicação|new post|criar|create)$/i), 15000);
      if (!create) throw new Error('Não achei o botão Criar. Você já fez login no Instagram?');
      press(create);
      // Newer layouts open a small menu first: Publicação / Post.
      const opened = await waitFor(() => fileInput() || find(/^(publicação|post)$/i), 8000);
      if (!opened) throw new Error('O Instagram não abriu a janela de novo post.');
      if (!fileInput()) press(find(/^(publicação|post)$/i));
    }
    const input = await waitFor(fileInput, 8000);
    if (!input) throw new Error('A janela de novo post abriu, mas sem o campo de imagens.');

    const transfer = new DataTransfer();
    for (const file of files) {
      const bytes = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
      transfer.items.add(new File([bytes], file.name, { type: 'image/jpeg' }));
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const nextButton = () => find(/^(avançar|next)$/i, dialog() || document);
    if (!(await waitFor(nextButton, 6000))) {
      // Some versions only take a drop on the dialog.
      const zone = dialog();
      if (zone) for (const type of ['dragenter', 'dragover', 'drop'])
        zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
      if (!(await waitFor(nextButton, 8000))) throw new Error('O Instagram não aceitou as imagens.');
    }

    // Crop, then filters, then the caption.
    for (let step = 0; step < 2; step++) {
      const next = await waitFor(nextButton, 10000);
      if (!next) return step === 0 ? 'enviado' : 'filtros';
      press(next);
      await sleep(900);
    }
    const caption = await waitFor(() => (dialog() || document).querySelector('[contenteditable="true"], textarea'), 8000);
    return caption ? 'legenda' : 'filtros';
    """#
}
