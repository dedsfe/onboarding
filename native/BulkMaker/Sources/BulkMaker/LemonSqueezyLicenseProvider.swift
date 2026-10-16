import Foundation

struct LicenseConfiguration: Decodable {
    var environment: String
    var storeID: Int
    var productID: Int
    var variantIDs: [Int]
    var portalURL: URL?
    var checkoutURL: URL?
    var subscriptionURL: URL? = nil
    var siteURL: URL? = nil
    var supportEmail: String? = nil

    var isConfigured: Bool {
        ["test", "live"].contains(environment) && storeID > 0 && productID > 0
            && !variantIDs.isEmpty && variantIDs.allSatisfy { $0 > 0 }
    }

    static var bundled: LicenseConfiguration {
        guard let url = Bundle.module.url(forResource: "LicenseConfiguration", withExtension: "plist"),
              let data = try? Data(contentsOf: url),
              let value = try? PropertyListDecoder().decode(Self.self, from: data) else {
            return .init(environment: "test", storeID: 0, productID: 0, variantIDs: [])
        }
        return value
    }
}

struct LemonSqueezyLicenseProvider: LicenseProvider {
    let configuration: LicenseConfiguration
    var session: URLSession = Self.privateSession()

    private static func privateSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        return URLSession(configuration: configuration)
    }

    func activate(key: String, instanceName: String) async throws -> LicenseEntitlement {
        // Check product identity before consuming an activation slot.
        let check = try await request("validate", fields: ["license_key": key])
        try checkIdentity(check)
        guard check.valid == true, let license = check.licenseKey,
              ["active", "inactive"].contains(license.status) else { throw LicenseFailure.rejected }
        guard license.activationLimit == 2, license.activationUsage < 2 else { throw LicenseFailure.activationLimit }
        let result = try await request("activate", fields: ["license_key": key, "instance_name": instanceName])
        guard result.activated == true else { throw LicenseFailure.rejected }
        do { return try await enrich(try entitlement(result), key: key) }
        catch {
            if let instance = result.instance { try? await deactivate(key: key, instanceID: instance.id) }
            throw error
        }
    }

    func validate(key: String, instanceID: String) async throws -> LicenseEntitlement {
        let result = try await request("validate", fields: ["license_key": key, "instance_id": instanceID])
        guard result.valid == true else { throw LicenseFailure.rejected }
        let entitlement = try entitlement(result)
        guard entitlement.instanceID == instanceID else { throw LicenseFailure.rejected }
        return try await enrich(entitlement, key: key)
    }

    func deactivate(key: String, instanceID: String) async throws {
        let result = try await request("deactivate", fields: ["license_key": key, "instance_id": instanceID])
        guard result.deactivated == true else { throw LicenseFailure.rejected }
    }

    private func enrich(_ entitlement: LicenseEntitlement, key: String) async throws -> LicenseEntitlement {
        guard let url = configuration.subscriptionURL, url.scheme == "https", url.host != nil else { return entitlement }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 8
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["license_key": key, "instance_id": entitlement.instanceID])
        // Billing details enrich the validated license. A billing-server outage never revokes a good key.
        guard let (data, response) = try? await session.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let metadata = try? JSONDecoder().decode(SubscriptionMetadata.self, from: data) else { return entitlement }
        if metadata.status == "expired" { throw LicenseFailure.rejected }
        var value = entitlement
        value.renewsAt = metadata.renewsAt.flatMap(Self.date)
        return value
    }

    private struct SubscriptionMetadata: Decodable {
        var renewsAt: String?
        var status: String
    }

    private func checkIdentity(_ response: Response) throws {
        guard let meta = response.meta else { throw LicenseFailure.rejected }
        guard meta.storeID == configuration.storeID, meta.productID == configuration.productID,
              configuration.variantIDs.contains(meta.variantID) else { throw LicenseFailure.wrongProduct }
    }

    private func entitlement(_ response: Response) throws -> LicenseEntitlement {
        try checkIdentity(response)
        guard let license = response.licenseKey, license.status == "active",
              let instance = response.instance, !instance.id.isEmpty, let meta = response.meta else {
            throw LicenseFailure.rejected
        }
        guard license.activationLimit == 2, license.activationUsage <= 2 else { throw LicenseFailure.activationLimit }
        let expires: Date?
        if let raw = license.expiresAt {
            guard let parsed = Self.date(raw) else { throw LicenseFailure.invalidResponse }
            expires = parsed
        } else { expires = nil }
        return LicenseEntitlement(instanceID: instance.id, email: meta.customerEmail,
                                  plan: meta.variantName, expiresAt: expires,
                                  activationUsage: license.activationUsage)
    }

    private func request(_ action: String, fields: [String: String]) async throws -> Response {
        guard configuration.isConfigured else { throw LicenseFailure.configuration }
        var request = URLRequest(url: URL(string: "https://api.lemonsqueezy.com/v1/licenses/\(action)")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        // Encode +, &, = and unicode as literal form values, including pasted keys.
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        request.httpBody = fields.sorted { $0.key < $1.key }.map {
            "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")"
        }.joined(separator: "&").data(using: .utf8)
        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: request) }
        catch { throw LicenseFailure.unavailable }
        guard let http = response as? HTTPURLResponse else { throw LicenseFailure.invalidResponse }
        if http.statusCode == 429 || http.statusCode >= 500 { throw LicenseFailure.unavailable }
        guard (200..<300).contains(http.statusCode) else {
            // A structured 4xx is an authoritative rejection; never apply offline grace to it.
            if [400, 404, 422].contains(http.statusCode),
               (try? JSONSerialization.jsonObject(with: data)) is [String: Any] { throw LicenseFailure.rejected }
            throw LicenseFailure.invalidResponse
        }
        guard let result = try? JSONDecoder().decode(Response.self, from: data) else {
            throw LicenseFailure.invalidResponse
        }
        return result
    }

    private static func date(_ value: String) -> Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: value) { return date }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: value) { return date }
        let legacy = DateFormatter()
        legacy.locale = Locale(identifier: "en_US_POSIX")
        legacy.timeZone = TimeZone(secondsFromGMT: 0)
        legacy.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return legacy.date(from: value)
    }

    private struct Response: Decodable {
        var activated: Bool?
        var valid: Bool?
        var deactivated: Bool?
        var licenseKey: Key?
        var instance: Instance?
        var meta: Meta?
        enum CodingKeys: String, CodingKey {
            case activated, valid, deactivated, instance, meta
            case licenseKey = "license_key"
        }
    }
    private struct Key: Decodable {
        var status: String
        var activationLimit: Int
        var activationUsage: Int
        var expiresAt: String?
        enum CodingKeys: String, CodingKey {
            case status
            case activationLimit = "activation_limit", activationUsage = "activation_usage", expiresAt = "expires_at"
        }
    }
    private struct Instance: Decodable { var id: String }
    private struct Meta: Decodable {
        var storeID: Int
        var productID: Int
        var variantID: Int
        var variantName: String
        var customerEmail: String
        enum CodingKeys: String, CodingKey {
            case storeID = "store_id", productID = "product_id", variantID = "variant_id"
            case variantName = "variant_name", customerEmail = "customer_email"
        }
    }
}
