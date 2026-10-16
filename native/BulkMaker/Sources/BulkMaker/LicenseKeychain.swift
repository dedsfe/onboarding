import Foundation
import LocalAuthentication
import Security

protocol LicenseStorage {
    func load() throws -> LicenseRecord?
    func save(_ record: LicenseRecord) throws
    func recover() throws -> LicenseRecord?
}

extension LicenseStorage {
    func recover() throws -> LicenseRecord? { try load() }
}

struct LicenseKeychain: LicenseStorage {
    let service: String
    var accessGroup: String? = "4ZQ8PBTL5U.com.andrefelipe.carouselmaker"

    init(service: String) { self.service = service }

    var query: [String: Any] {
        var value: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: "license-record-v1",
         kSecAttrSynchronizable as String: false,
         kSecUseDataProtectionKeychain as String: true]
        if let accessGroup { value[kSecAttrAccessGroup as String] = accessGroup }
        return value
    }

    func load() throws -> LicenseRecord? {
        try loadWithoutAuthentication()
    }

    func recover() throws -> LicenseRecord? {
        try loadWithoutAuthentication()
    }

    private func loadWithoutAuthentication() throws -> LicenseRecord? {
        var request = query
        let context = LAContext()
        context.interactionNotAllowed = true
        request[kSecUseAuthenticationContext as String] = context
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
        var updateQuery = query
        let context = LAContext()
        context.interactionNotAllowed = true
        updateQuery[kSecUseAuthenticationContext as String] = context
        var status = SecItemUpdate(updateQuery as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw LicenseFailure.storage }
    }
}
