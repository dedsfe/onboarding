import WebKit
import XCTest
@testable import BulkMaker

@MainActor
final class InstagramPageHealthTests: XCTestCase {
    private func page(_ html: String, path: String = "/challenge/") async throws -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 900, height: 700), configuration: configuration)
        view.loadHTMLString(html, baseURL: URL(string: "https://www.instagram.com\(path)"))
        for _ in 0..<100 {
            let ready = try? await view.evaluateJavaScript("document.readyState === 'complete' && !!document.querySelector('h1')") as? Bool
            if ready == true { return view }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("Fixture did not load")
        return view
    }

    func testBrokenCaptchaOffersRecovery() async throws {
        let view = try await page("""
            <h1>Confirm you're human</h1>
            <img width="600" height="150" src="data:image/webp;base64,bm90LWFuLWltYWdl">
            <input placeholder="Enter the code from the image"><button disabled>Next</button>
            """)
        let broken = try await view.evaluateJavaScript("document.images[0].complete && document.images[0].naturalWidth === 0") as? Bool
        XCTAssertEqual(broken, true, "Fixture must reproduce the broken image")
        let health = InstagramPageHealth()
        await health.inspect(view)
        XCTAssertEqual(health.issue, .brokenVerification, "Broken CAPTCHA must not leave the app without recovery")
    }

    func testHealthyChallengeStillPausesPosting() async throws {
        let view = try await page("<h1>Confirme que você é humano</h1><input><button>Avançar</button>")
        let health = InstagramPageHealth()
        await health.inspect(view)
        XCTAssertEqual(health.issue, .verification)
    }

    func testOrdinaryBrokenFeedImageDoesNotBlockPosting() async throws {
        let view = try await page("<h1>Instagram</h1><img src='data:image/webp;base64,bm9wZQ=='>", path: "/")
        let health = InstagramPageHealth()
        await health.inspect(view)
        XCTAssertNil(health.issue)
    }

    func testRecoveryClearsOnlyAfterHealthyPageLoads() async throws {
        let health = InstagramPageHealth()
        health.loadingFailed()
        health.beginNavigation()
        let view = try await page("<h1>Instagram</h1><nav>Home</nav>", path: "/")
        await health.inspect(view)
        XCTAssertNil(health.issue)
    }

    func testFailedNavigationDoesNotClearAgainstOldFeed() async throws {
        let view = try await page("<h1>Instagram</h1><nav>Home</nav>", path: "/")
        let health = InstagramPageHealth()
        health.loadingFailed()
        await health.inspect(view)
        XCTAssertEqual(health.issue, .loadFailed)
    }

    func testRecognizesCheckpointRoutesOnlyOnInstagram() {
        XCTAssertTrue(InstagramPageHealth.isVerificationURL(URL(string: "https://www.instagram.com/challenge/123/")))
        XCTAssertTrue(InstagramPageHealth.isVerificationURL(URL(string: "https://instagram.com/checkpoint/")))
        XCTAssertFalse(InstagramPageHealth.isVerificationURL(URL(string: "https://instagram.com/")))
        XCTAssertFalse(InstagramPageHealth.isVerificationURL(URL(string: "https://fakeinstagram.com/challenge/")))
    }
}
