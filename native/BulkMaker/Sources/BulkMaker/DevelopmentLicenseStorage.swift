import Foundation

/// Explicitly limited to the ad-hoc .dev bundle. Distribution always uses Data Protection Keychain.
struct DevelopmentLicenseStorage: LicenseStorage {
    let url: URL

    static func defaultURL(environment: String) -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("The Carousel Maker/Development", isDirectory: true)
            .appendingPathComponent("license-\(environment).json")
    }

    func load() throws -> LicenseRecord? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        do { return try JSONDecoder().decode(LicenseRecord.self, from: Data(contentsOf: url)) }
        catch { throw LicenseFailure.storage }
    }

    func save(_ record: LicenseRecord) throws {
        let manager = FileManager.default
        let directory = url.deletingLastPathComponent()
        let temporary = directory.appendingPathComponent(".license-\(UUID().uuidString).tmp")
        do {
            try manager.createDirectory(at: directory, withIntermediateDirectories: true,
                                        attributes: [.posixPermissions: 0o700])
            let data = try JSONEncoder().encode(record)
            guard manager.createFile(atPath: temporary.path, contents: data, attributes: [.posixPermissions: 0o600]) else {
                throw LicenseFailure.storage
            }
            defer { try? manager.removeItem(at: temporary) }
            guard rename(temporary.path, url.path) == 0 else { throw LicenseFailure.storage }
        } catch { throw LicenseFailure.storage }
    }
}
