import XCTest
@testable import BulkMaker

final class OnboardingServicesTests: XCTestCase {
    func testNormalizesSiteAddress() {
        XCTAssertEqual(SiteSnapshot.normalize("oracaodiaria.com.br")?.absoluteString, "https://oracaodiaria.com.br")
        XCTAssertEqual(SiteSnapshot.normalize(" https://acme.io/app ")?.host(), "acme.io")
        XCTAssertNil(SiteSnapshot.normalize("não é site"))
        XCTAssertNil(SiteSnapshot.normalize("abc"))
    }

    func testDecodesPartialProfileFromAI() throws {
        let json = #"{"name":"Acme","tagline":null,"what_it_does":"Faz X","umbrella_niche":"produtividade","keywords":["como focar","rotina"],"features":null}"#
        let profile = try JSONDecoder().decode(ProductProfile.self, from: Data(json.utf8))
        XCTAssertEqual(profile.name, "Acme")
        XCTAssertNil(profile.tagline)
        XCTAssertEqual(profile.whatItDoes, "Faz X")
        XCTAssertEqual(profile.keywords, ["como focar", "rotina"])
        XCTAssertEqual(profile.features, [])
        XCTAssertTrue(profile.markdown.contains("## Nicho\nprodutividade"))
    }
}
