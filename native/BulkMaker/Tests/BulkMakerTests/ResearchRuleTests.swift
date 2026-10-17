import XCTest
@testable import BulkMaker

@MainActor
final class ResearchRuleTests: XCTestCase {
    private func post(_ caption: String, views: Int) -> TikTokResearcher.Post {
        TikTokResearcher.Post(id: UUID().uuidString, author: "a", caption: caption, created: Date(), views: views,
                              likes: 0, comments: 0, shares: 0, saves: 0, images: [], followers: 0)
    }

    func testCaptionsAboutAnAppAreRecognized() {
        XCTAssertTrue(TikTokResearcher.mentionsApp("Esse app mudou minhas manhãs 🙏"))
        XCTAssertTrue(TikTokResearcher.mentionsApp("baixe o Aplicativo na App Store"))
        XCTAssertTrue(TikTokResearcher.mentionsApp("#appdeoracao #fé"))
        XCTAssertFalse(TikTokResearcher.mentionsApp("Oração da manhã para começar o dia com Deus"))
        XCTAssertFalse(TikTokResearcher.mentionsApp("aplausos pra quem acordou cedo"))
        // A competitor named on a slide counts, as a whole word.
        XCTAssertTrue(TikTokResearcher.mentionsApp("Parte 2: o Hallow me ajudou a orar todo dia", names: ["Hallow"]))
        XCTAssertFalse(TikTokResearcher.mentionsApp("hallowed be thy name", names: ["Hallow"]))
        XCTAssertEqual(Competitors.short("Hallow: Prayer & Meditation"), "Hallow")
    }

    func testASellingSlideMakesAMillionViewPostFirst() {
        var seller = post("Oração da manhã", views: 2_000_000)
        XCTAssertEqual(seller.priority, 3)
        seller.sellsApp = true
        XCTAssertEqual(seller.priority, 1)
    }

    /// The fixed rule: an app with 1M+ views, then any 1M+ views, then the rest, whatever the raw numbers.
    func testFixedPriority() {
        XCTAssertEqual(post("conheça o app", views: 1_200_000).priority, 1)
        XCTAssertEqual(post("oração da manhã", views: 9_000_000).priority, 3)
        XCTAssertEqual(post("conheça o app", views: 900_000).priority, 2)
        XCTAssertEqual(post("oração da manhã", views: 40_000).priority, 3)
    }

    func testOnboardingShowsPostsInTheRuleOrder() {
        let folder = URL(fileURLWithPath: "/tmp")
        func made(_ views: Int, _ priority: Int) -> ResearchedPost {
            ResearchedPost(handle: "@a", views: views, likes: 0, saves: 0, slides: [folder.appendingPathComponent("1.jpg"), folder.appendingPathComponent("2.jpg")], folder: folder.appendingPathComponent("\(views)"),
                           aboutApp: priority < 3, priority: priority, validated: true)
        }
        let ranked = ResearchedPost.ranked([made(5_000_000, 2), made(80_000, 3), made(1_100_000, 1), made(2_000_000, 2)])
        XCTAssertEqual(ranked.map(\.views), [1_100_000, 5_000_000, 2_000_000, 80_000])
    }
}
