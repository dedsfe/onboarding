import AppKit
import SwiftUI
import WebKit

/// The "Postar" tab: Instagram running inside the app. The login lives in WebKit's default data
/// store, which persists on disk: sign in once and it stays.
struct InstagramPage: View {
    var body: some View {
        InstagramWebView()
            .clipShape(.rect(cornerRadius: 12))
            .padding(.horizontal, 16).padding(.bottom, 16)
    }
}

private struct InstagramWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { InstagramBrowser.shared.webView }
    func updateNSView(_ webView: WKWebView, context: Context) {}
}

/// One web view for the whole app run: leaving the tab and coming back keeps the page where it was.
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
}
