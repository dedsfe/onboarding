import Foundation

enum ProductLinks {
    private static let configuration = LicenseConfiguration.bundled
    static var support: URL? {
        guard let email = configuration.supportEmail, email.contains("@"),
              !email.contains(where: { $0.isWhitespace }) else { return nil }
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = email
        return components.url
    }
    static var privacy: URL? { website("privacidade") }
    static var terms: URL? { website("termos") }
    private static func website(_ path: String) -> URL? {
        guard let origin = configuration.siteURL, origin.scheme == "https", origin.host != nil else { return nil }
        return origin.appendingPathComponent(path)
    }
}
