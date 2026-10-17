import XCTest
@testable import BulkMaker

final class SafariCookiesTests: XCTestCase {
    /// One page with one record, laid out as Safari writes it.
    private func file(domain: String, name: String, value: String, path: String = "/", flags: UInt32, expires: Date) -> Data {
        func le32(_ v: UInt32) -> [UInt8] { withUnsafeBytes(of: v.littleEndian, Array.init) }
        func be32(_ v: UInt32) -> [UInt8] { withUnsafeBytes(of: v.bigEndian, Array.init) }
        let strings = [domain, name, path, value].map { Array($0.utf8) + [0] }
        var offsets: [UInt32] = []
        var at: UInt32 = 56
        for s in strings { offsets.append(at); at += UInt32(s.count) }
        var record = le32(at) + le32(0) + le32(flags) + le32(0) + offsets.flatMap(le32) + le32(0) + le32(0)
        record += withUnsafeBytes(of: expires.timeIntervalSinceReferenceDate.bitPattern.littleEndian, Array.init)
        record += withUnsafeBytes(of: Double(0).bitPattern.littleEndian, Array.init)
        record += strings.flatMap { $0 }
        let page = [0, 0, 1, 0] + le32(1) + le32(16) + le32(0) + record
        return Data(Array("cook".utf8) + be32(1) + be32(UInt32(page.count)) + page)
    }

    func testReadsSessionCookie() throws {
        let expires = Date(timeIntervalSinceNow: 86_400 * 30)
        let cookies = SafariCookies.parse(file(domain: ".tiktok.com", name: "sessionid", value: "abc123", flags: 5, expires: expires))
        let cookie = try XCTUnwrap(cookies.first)
        XCTAssertEqual(cookies.count, 1)
        XCTAssertEqual(cookie.domain, ".tiktok.com")
        XCTAssertEqual(cookie.name, "sessionid")
        XCTAssertEqual(cookie.value, "abc123")
        XCTAssertTrue(cookie.isSecure)
        XCTAssertTrue(cookie.isHTTPOnly)
        XCTAssertEqual(cookie.expiresDate!.timeIntervalSince1970, expires.timeIntervalSince1970, accuracy: 1)
        XCTAssertTrue(SocialSessions.hasSession(cookies, .tiktok))
    }

    func testIgnoresGarbage() {
        XCTAssertTrue(SafariCookies.parse(Data("not a cookie file".utf8)).isEmpty)
        XCTAssertTrue(SafariCookies.parse(Data("cook".utf8) + Data([0, 0, 0, 9])).isEmpty)
    }
}
