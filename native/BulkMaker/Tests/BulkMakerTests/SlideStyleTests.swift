import CarouselEngine
import ImageIO
import UniformTypeIdentifiers
import XCTest

final class SlideStyleTests: XCTestCase {
    func testSlideStyleWinsFieldByFieldOverThePlanStyle() {
        let post = SlideStyle(font: "Inter", weight: 800, color: "#FFFFFF", strokeWidth: 6, strokeColor: "#000000",
                              position: .bottom, textCase: .normal)
        let merged = post.overridden(by: SlideStyle(color: "#FFD60A", textCase: .upper))
        XCTAssertEqual(merged, SlideStyle(font: "Inter", weight: 800, color: "#FFD60A", strokeWidth: 6,
                                          strokeColor: "#000000", position: .bottom, textCase: .upper))
        XCTAssertEqual(post.overridden(by: nil), post)
    }

    func testPlanReadsAndWritesStyleOnlyOnTheSlidesThatHaveOne() throws {
        let json = """
        { "style": { "color": "#FFFFFF" },
          "slides": [ { "photo": "/a.jpg", "text": "um" },
                      { "photo": "/b.jpg", "text": "dois", "style": { "textCase": "upper" } } ] }
        """
        let plan = try JSONDecoder().decode(CarouselPlan.self, from: Data(json.utf8))
        XCTAssertNil(plan.slides[0].style)
        XCTAssertEqual(plan.slides[1].style, SlideStyle(textCase: .upper))
        let encoded = String(decoding: try JSONEncoder().encode(plan), as: UTF8.self)
        XCTAssertEqual(encoded.components(separatedBy: "\"textCase\"").count - 1, 1)
    }

    func testRendererUsesTheSlideStyle() throws {
        let photo = FileManager.default.temporaryDirectory.appendingPathComponent("estilo-\(UUID().uuidString).jpg")
        defer { try? FileManager.default.removeItem(at: photo) }
        let context = try XCTUnwrap(CGContext(data: nil, width: 108, height: 192, bitsPerComponent: 8, bytesPerRow: 0,
                                              space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.setFillColor(CGColor(gray: 0.2, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 108, height: 192))
        try SlideRenderer.writeJPEG(try XCTUnwrap(context.makeImage()), to: photo)

        let post = SlideStyle(position: .bottom)
        let plain = SlidePlan(photo: photo.path, text: "frase curta")
        let own = SlidePlan(photo: photo.path, text: "frase curta", style: SlideStyle(position: .top))
        XCTAssertEqual(try SlideRenderer.render(plain, style: post, format: .tiktok).1.position, "bottom")
        XCTAssertEqual(try SlideRenderer.render(own, style: post, format: .tiktok).1.position, "top")
    }

    func testPostStyleReachesSlidesThatOverrodeTheSameField() {
        var plan = CarouselPlan(style: SlideStyle(color: "#FFFFFF"), slides: [
            SlidePlan(photo: "/a.jpg", text: "um", position: .top, style: SlideStyle(color: "#FF0000", textCase: .upper)),
            SlidePlan(photo: "/b.jpg", text: "dois", style: SlideStyle(color: "#00FF00"))
        ])
        plan.setPostStyle(SlideStyle(color: "#FFD60A", position: .bottom))
        XCTAssertEqual(plan.style, SlideStyle(color: "#FFD60A", position: .bottom))
        XCTAssertEqual(plan.slides[0].style, SlideStyle(textCase: .upper))
        XCTAssertNil(plan.slides[0].position)
        XCTAssertNil(plan.slides[1].style)
    }

    func testSlideStyleReplacesTheLegacyPositionAndEmptyFollowsThePost() {
        var plan = CarouselPlan(slides: [SlidePlan(photo: "/a.jpg", text: "um", position: .top)])
        plan.setSlideStyle(SlideStyle(position: .middle), at: 0)
        XCTAssertNil(plan.slides[0].position)
        XCTAssertEqual(plan.slides[0].style?.position, .middle)
        plan.setSlideStyle(SlideStyle(), at: 0)
        XCTAssertNil(plan.slides[0].style)
    }
}
