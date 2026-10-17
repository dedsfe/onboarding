import XCTest
@testable import BulkMaker

@MainActor
final class ResearchRelevanceTests: XCTestCase {
    private var profile: ProductProfile {
        var p = ProductProfile()
        p.name = "Oração Diária"
        p.whatItDoes = "Bloqueia apps de manhã até a pessoa fazer sua oração."
        p.umbrellaNiche = "Vida cristã no dia a dia: fé, rotina espiritual e hábitos que ajudam a viver com mais presença e menos tela"
        p.subNiches = ["Oração da manhã", "Devocional diário", "Rotina matinal cristã"]
        p.competitors = ["Hallow", "Glorify"]
        p.keywords = ["oração da manhã"]
        p.sellerSearches = ["aplicativo que bloqueia o celular até eu orar"]
        return p
    }

    private func post(_ id: String, author: String, caption: String, views: Int, slides: Int) -> TikTokResearcher.Post {
        TikTokResearcher.Post(id: id, author: author, caption: caption, created: Date(), views: views,
            likes: 0, comments: 0, shares: 0, saves: 0,
            images: (0..<slides).map { URL(string: "https://example.test/\(id)-\($0).jpg")! }, followers: 0)
    }

    func testScreenshotExamplesCannotBecomeProductReferences() {
        let single = post("7661827100940225812", author: "rose_massoterapeutab7",
            caption: "Deus nesta manhã que se inicia nus rendemos diante de ti,pois tú és o autor da vida #Oraçãoparamanhã", views: 1_100_000, slides: 1)
        let offTopic = post("7640954986821618965", author: "thallidailly",
            caption: "#creatorsearchinsights Aqui vão 4 lições que eu aprendi pra crescer rápido no tiktok sendo consistente em uma conta nova #dicasdetiktok #crescernotiktok", views: 7_800_000, slides: 5)
        var seller = post("seller", author: "pessoa_real",
            caption: "Eu não conseguia orar de manhã. Esse aplicativo de oração me ajudou a começar o dia com Deus. Baixe e experimente.", views: 85_000, slides: 5)
        seller.assessment = ResearchAssessment(id: seller.id, nicheMatch: true, productPromotion: true,
            personalStory: true, creatorLed: true, nicheEvidence: "orar de manhã", angleEvidence: "Esse aplicativo de oração me ajudou",
            creatorEvidence: "Eu não conseguia orar de manhã", reason: "Relato pessoal com aplicativo de oração")
        let selected = TikTokResearcher.judge([single, offTopic, seller], profile: profile)
        XCTAssertEqual(selected.flatMap(\.posts).map(\.id), ["seller"])
        XCTAssertTrue(TikTokResearcher.judge([single, offTopic], profile: profile).isEmpty,
                      "Sem referência adequada, não preencher a quantidade com posts irrelevantes")
    }

    func testPlatformAdviceIsNotAProductRecommendation() {
        XCTAssertFalse(TikTokResearcher.mentionsApp("Assim tu realmente mostras pro app que és ativa, que não é apenas um robô. Me segue pra aprender mais!"))
        XCTAssertFalse(TikTokResearcher.mentionsApp("Abra o app do TikTok, poste nos stories e ganhe seguidores."))
    }

    func testSinglePhotoIsRejectedAtIngestion() {
        let item: [String: Any] = ["id": "123", "imagePost": ["images": [["imageURL": ["urlList": ["https://example.test/1.jpg"]]]]]]
        XCTAssertNil(TikTokResearcher.post(from: item))
    }

    func testEvidenceCannotComeFromAnotherPostOrFromTheProductProfile() {
        let assessment = ResearchAssessment(id: "wrong", nicheMatch: true, productPromotion: true,
            personalStory: true, creatorLed: true, nicheEvidence: "aplicativo de oração", angleEvidence: "Esse app me ajudou a orar",
            creatorEvidence: "minha rotina de oração", reason: "Inválido")
        XCTAssertFalse(assessment.isSupported(by: "Dicas de crescer no TikTok. Poste nos stories."))
    }

    func testSearchUsesShortProductTermsInsteadOfAppendingTheWholeNiche() {
        let terms = TikTokResearcher.researchQueries("devocional diário", profile: profile)
        XCTAssertTrue(terms.contains("app Hallow"))
        XCTAssertTrue(terms.contains("app devocional diário"))
        XCTAssertFalse(terms.contains("oração da manhã"), "Tema amplo sem recorte de produto não deve virar busca de referência")
        XCTAssertTrue(terms.allSatisfy { $0.split(separator: " ").count <= 9 })
        XCTAssertFalse(terms.joined().contains(profile.umbrellaNiche))
    }

    func testSellerWithFewerViewsBeatsGenericViralContent() {
        let seller = post("seller", author: "pessoa_real", caption: "Esse aplicativo de oração mudou minhas manhãs. Baixe o app.", views: 85_000, slides: 4)
        let generic = post("generic", author: "pagina", caption: "Oração da manhã. Bom dia e muita fé!", views: 9_000_000, slides: 4)
        XCTAssertLessThan(seller.priority, generic.priority)
    }
}
