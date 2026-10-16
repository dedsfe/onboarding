import Foundation
import Security

protocol LicenseStorage {
    func load() throws -> LicenseRecord?
    func save(_ record: LicenseRecord) throws
}

struct LicenseKeychain: LicenseStorage {
    let service: String

    init(service: String) { self.service = service }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: "license-record-v1",
         kSecAttrSynchronizable as String: false]
    }

    func load() throws -> LicenseRecord? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let record = try? JSONDecoder().decode(LicenseRecord.self, from: data) else {
            // Corruption or a locked Keychain must never create a fresh trial.
            throw LicenseFailure.storage
        }
        return record
    }

    func save(_ record: LicenseRecord) throws {
        let data = try JSONEncoder().encode(record)
        let attributes = [kSecValueData as String: data]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw LicenseFailure.storage }
    }
}
