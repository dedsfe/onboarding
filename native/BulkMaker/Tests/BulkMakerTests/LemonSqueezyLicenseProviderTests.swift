import Foundation
import XCTest
@testable import BulkMaker

final class LemonSqueezyLicenseProviderTests: XCTestCase {
    private func provider() -> LemonSqueezyLicenseProvider {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [LicenseURLProtocol.self]
        return .init(configuration: .init(environment: "test", storeID: 10, productID: 20, variantIDs: [30]),
                     session: URLSession(configuration: configuration))
    }

    private func fixture(action: String = "valid", product: Int = 20, limit: Int = 2,
                         usage: Int = 1, instance: String = "this-mac", expires: String? = nil) -> Data {
        try! JSONSerialization.data(withJSONObject: [
            action: true,
            "license_key": ["status": "active", "activation_limit": limit, "activation_usage": usage,
                            "expires_at": expires as Any? ?? NSNull()],
            "instance": ["id": instance],
            "meta": ["store_id": 10, "product_id": product, "variant_id": 30,
                     "variant_name": "Mensal", "customer_email": "test@example.invalid"]
        ])
    }

    func testActivationPreflightsThenSavesReturnedInstanceAndEncodesForm() async throws {
        let validate = fixture()
        let activate = fixture(action: "activated")
        let requests = LicenseRequestLog()
        LicenseURLProtocol.respond { request in
            requests.append(request)
            return (200, request.url!.lastPathComponent == "activate" ? activate : validate)
        }
        let value = try await provider().activate(key: "a+b&c=á", instanceName: "Mac 123")
        XCTAssertEqual(value.instanceID, "this-mac")
        let captured = requests.requests
        XCTAssertEqual(captured.map { $0.url!.lastPathComponent }, ["validate", "activate"])
        XCTAssertEqual(captured[1].value(forHTTPHeaderField: "Accept"), "application/json")
        XCTAssertEqual(captured[1].value(forHTTPHeaderField: "Content-Type"), "application/x-www-form-urlencoded")
        XCTAssertEqual(String(data: captured[1].httpBody!, encoding: .utf8), "instance_name=Mac%20123&license_key=a%2Bb%26c%3D%C3%A1")
        XCTAssertNil(captured[1].value(forHTTPHeaderField: "Authorization"))
    }

    func testForeignProductDoesNotConsumeActivation() async {
        let data = fixture(product: 99)
        let requests = LicenseRequestLog()
        LicenseURLProtocol.respond { request in requests.append(request); return (200, data) }
        do {
            _ = try await provider().activate(key: "dummy", instanceName: "Mac")
            XCTFail("A foreign product must not grant access")
        } catch { XCTAssertEqual(error as? LicenseFailure, .wrongProduct) }
        XCTAssertEqual(requests.requests.count, 1)
    }

    func testThirdMacAndMisconfiguredActivationLimitAreRejectedBeforeActivation() async {
        for (limit, usage) in [(2, 2), (3, 0)] {
            let data = fixture(limit: limit, usage: usage)
            let requests = LicenseRequestLog()
            LicenseURLProtocol.respond { request in requests.append(request); return (200, data) }
            do {
                _ = try await provider().activate(key: "dummy", instanceName: "Mac")
                XCTFail("Expected activation limit rejection")
            } catch { XCTAssertEqual(error as? LicenseFailure, .activationLimit) }
            XCTAssertEqual(requests.requests.count, 1)
        }
    }

    func testValidationIsBoundToThisInstanceAndUnderstandsDocumentedDateFormats() async throws {
        for date in ["2027-01-01T00:00:00.000Z", "2027-01-01T00:00:00Z", "2027-01-01 00:00:00"] {
            let data = fixture(expires: date)
            LicenseURLProtocol.respond { request in
                XCTAssertEqual(String(data: request.httpBody!, encoding: .utf8), "instance_id=this-mac&license_key=dummy")
                return (200, data)
            }
            let entitlement = try await provider().validate(key: "dummy", instanceID: "this-mac")
            XCTAssertNotNil(entitlement.expiresAt)
        }
        let foreign = fixture(instance: "other-mac")
        LicenseURLProtocol.respond { _ in (200, foreign) }
        do {
            _ = try await provider().validate(key: "dummy", instanceID: "this-mac")
            XCTFail("A different instance must not grant access")
        } catch { XCTAssertEqual(error as? LicenseFailure, .rejected) }
    }

    func testDeactivationSendsInstanceID() async throws {
        LicenseURLProtocol.respond { request in
            XCTAssertEqual(request.url!.lastPathComponent, "deactivate")
            XCTAssertEqual(String(data: request.httpBody!, encoding: .utf8), "instance_id=this-mac&license_key=dummy")
            return (200, Data(#"{"deactivated":true}"#.utf8))
        }
        try await provider().deactivate(key: "dummy", instanceID: "this-mac")
    }

    func testAuthoritativeRejectionDiffersFromServiceAndProtocolFailures() async {
        for (status, body, expected): (Int, String, LicenseFailure) in [
            (400, #"{"error":"invalid key"}"#, .rejected),
            (404, #"{"error":"instance missing"}"#, .rejected),
            (429, "", .unavailable), (503, "", .unavailable),
            (200, "broken json", .invalidResponse), (403, "<html>proxy</html>", .invalidResponse),
            (200, #"{"valid":false}"#, .rejected)
        ] {
            LicenseURLProtocol.respond { _ in (status, Data(body.utf8)) }
            do {
                _ = try await provider().validate(key: "dummy", instanceID: "this-mac")
                XCTFail("Expected failure for \(status)")
            } catch { XCTAssertEqual(error as? LicenseFailure, expected) }
        }
    }

    func testMissingProductConfigurationFailsBeforeNetworkRequest() async {
        var client = provider()
        client = .init(configuration: .init(environment: "test", storeID: 0, productID: 0, variantIDs: []), session: client.session)
        LicenseURLProtocol.respond { _ in XCTFail("Should not send an unconfigured key"); return (500, Data()) }
        do {
            _ = try await client.activate(key: "dummy", instanceName: "Mac")
            XCTFail("Missing configuration must not grant access")
        } catch { XCTAssertEqual(error as? LicenseFailure, .configuration) }
    }

    func testRenewalComesFromOptionalBillingServerAndItsOutageDoesNotRevokeGoodLicense() async throws {
        var config = provider().configuration
        config.subscriptionURL = URL(string: "https://carousel.example.invalid/api/license/subscription")
        let direct = fixture()
        var client = provider()
        client = .init(configuration: config, session: client.session)
        LicenseURLProtocol.respond { request in
            if request.url?.host == "carousel.example.invalid" {
                return (200, Data(#"{"status":"active","renewsAt":"2026-11-01T00:00:00Z"}"#.utf8))
            }
            return (200, direct)
        }
        let value = try await client.validate(key: "dummy", instanceID: "this-mac")
        XCTAssertNotNil(value.renewsAt)
        LicenseURLProtocol.respond { request in
            request.url?.host == "carousel.example.invalid" ? (503, Data()) : (200, direct)
        }
        let offlineBilling = try await client.validate(key: "dummy", instanceID: "this-mac")
        XCTAssertEqual(offlineBilling.instanceID, "this-mac")
    }
}

private final class LicenseRequestLog: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [URLRequest] = []
    var requests: [URLRequest] { lock.lock(); defer { lock.unlock() }; return values }
    func append(_ request: URLRequest) { lock.lock(); defer { lock.unlock() }; values.append(request) }
}

private final class LicenseURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var handler: ((URLRequest) -> (Int, Data))?
    static func respond(_ value: @escaping (URLRequest) -> (Int, Data)) {
        lock.lock(); defer { lock.unlock() }; handler = value
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock()
        let handler = Self.handler!
        Self.lock.unlock()
        var captured = request
        if captured.httpBody == nil, let stream = captured.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var body = Data()
            var buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count > 0 else { break }
                body.append(buffer, count: count)
            }
            captured.httpBody = body
        }
        let (status, data) = handler(captured)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
