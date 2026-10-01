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

    private static var agendaFile: URL {
        TerminalHandoff.projectDirectory.appendingPathComponent(".bulk-maker/agenda.json")
    }

    var body: some View {
        HStack(spacing: 12) {
            postColumn.frame(width: 260)
            InstagramWebView().clipShape(.rect(cornerRadius: 12))
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

            if let status {
                Text(status)
                    .font(.system(size: 12))
                    .foregroundStyle(statusIsError ? Color.red : .secondary)
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .glassEffect(.regular, in: .rect(cornerRadius: 12))
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: status)
    }

    private func row(_ post: PostAgenda.Post) -> some View {
        let isSending = sendingID == post.id
        let isHovered = hoveredID == post.id
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
        .disabled(sendingID != nil)
        .onHover { inside in
            withAnimation(.snappy(duration: 0.18)) { hoveredID = inside ? post.id : (hoveredID == post.id ? nil : hoveredID) }
        }
        .help("Abrir este carrossel no Instagram")
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

private struct InstagramWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { InstagramBrowser.shared.webView }
    func updateNSView(_ webView: WKWebView, context: Context) {}
}

/// One web view for the whole app run: leaving the tab and coming back keeps the page where it was.
/// The login lives in WebKit's default data store, which persists on disk: sign in once and it stays.
@MainActor
final class InstagramBrowser: NSObject, WKUIDelegate {
    static let shared = InstagramBrowser()

    let webView: WKWebView

    override private init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        // Without a Safari token Instagram treats WebKit as an unsupported browser.
        configuration.applicationNameForUserAgent = "Version/26.0 Safari/605.1.15"
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: URL(string: "https://www.instagram.com/")!))
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
        let files = try await Task.detached(priority: .userInitiated) {
            try slides.enumerated().map { index, url in
                ["name": String(format: "slide-%02d.jpg", index + 1), "data": try Self.jpegBase64(url)]
            }
        }.value
        do {
            let step = try await webView.callAsyncJavaScript(Self.uploadScript, arguments: ["files": files],
                                                             contentWorld: .page)
            return step as? String ?? "enviado"
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

    /// Runs inside instagram.com with `files` = [{name, data}]. Finds controls by label or text in
    /// Portuguese and English, since Instagram's class names change all the time.
    private static let uploadScript = #"""
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

    if (!fileInput()) {
      const create = find(/^(nova publicação|new post|criar|create)$/i);
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
