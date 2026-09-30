import XCTest
@testable import BulkMaker

final class ArtworkCatalogTests: XCTestCase {
    func testBundledPaintingsLoadWithIIIFURLs() throws {
        XCTAssertEqual(Artwork.catalog.count, 1290)
        XCTAssertTrue(Artwork.catalog.allSatisfy { !$0.title.isEmpty && UUID(uuidString: $0.id) != nil })
        let artwork = try XCTUnwrap(Artwork.catalog.first { $0.id == "00209fb1-64a2-4961-9ccc-8c6c06117df2" })
        XCTAssertEqual(artwork.imageURL(width: 2560).absoluteString,
                       "https://api.nga.gov/iiif/00209fb1-64a2-4961-9ccc-8c6c06117df2/full/2560,/0/default.jpg")
        XCTAssertEqual(artwork.wallpaperID, "nga-00209fb1-64a2-4961-9ccc-8c6c06117df2")
    }
}
