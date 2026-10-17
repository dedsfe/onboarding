import Combine
import WebKit

extension Notification.Name {
    static let instagramSessionRestored = Notification.Name("BulkMaker.instagramSessionRestored")
}

/// Observes the page without clicking, replacing or solving Instagram's security challenge.
@MainActor
final class InstagramPageHealth: ObservableObject {
    enum Issue: Equatable {
        case verification, brokenVerification, loadFailed

        var message: String {
            switch self {
            case .verification: return "O Instagram precisa confirmar sua identidade. As postagens estão pausadas."
            case .brokenVerification: return "A imagem da verificação não carregou. Recarregue ou reconecte sua conta."
            case .loadFailed: return "Não foi possível carregar o Instagram. Tente recarregar a página."
            }
        }
    }

    @Published private(set) var issue: Issue?
    private var revision = 0
    private var failedNavigation = false

    func reset() {
        revision += 1
        failedNavigation = false
        issue = nil
    }

    func loadingFailed() {
        revision += 1
        failedNavigation = true
        issue = .loadFailed
    }

    func beginNavigation() {
        revision += 1
        failedNavigation = false
    }

    func verificationRequired() {
        revision += 1
        issue = .verification
    }

    func inspect(_ webView: WKWebView) async {
        guard !webView.isLoading, !failedNavigation else { return }
        let inspectedRevision = revision
        guard let result = try? await webView.callAsyncJavaScript(Self.inspectionScript,
            arguments: [:], contentWorld: .defaultClient) as? String,
              inspectedRevision == revision else { return }
        switch result {
        case "broken": issue = .brokenVerification
        case "verification": issue = .verification
        case "ready": issue = nil
        default: break
        }
    }

    static func isVerificationURL(_ url: URL?) -> Bool {
        guard let url, let host = url.host,
              host == "instagram.com" || host.hasSuffix(".instagram.com") else { return false }
        return url.path.split(separator: "/").contains { ["challenge", "checkpoint"].contains(String($0)) }
    }

    static let inspectionScript = #"""
    if (!document.body || document.readyState !== 'complete' || !document.body.children.length) return 'loading';
    const documents = [document];
    for (const frame of document.querySelectorAll('iframe')) {
      try { if (frame.contentDocument) documents.push(frame.contentDocument); } catch (_) {}
    }
    const prompt = /confirm you['’]?re human|confirm your identity|security check|confirme que (?:voc[eê] )?[eé] human[oa]|confirme sua identidade|verifique sua identidade/i;
    const challenge = /\/(challenge|checkpoint)(\/|$)/.test(location.pathname)
      || documents.some(doc => prompt.test((doc.body?.innerText || '').slice(0, 12000)))
      || !!document.querySelector('iframe[src*="captcha"], iframe[title*="captcha" i]');
    if (!challenge) return 'ready';
    const broken = documents.some(doc => Array.from(doc.images).some(img => {
      const rect = img.getBoundingClientRect();
      if (!img.getAttribute('src') || rect.width < 40 || rect.height < 20) return false;
      const style = doc.defaultView.getComputedStyle(img);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      return (img.complete && img.naturalWidth === 0) || (!img.complete && performance.now() > 15000);
    }));
    return broken ? 'broken' : 'verification';
    """#
}
