import Foundation
import Security

public enum KeychainError: Error, Equatable {
    case itemNotFound
    case unexpectedStatus(OSStatus)
    case encodingFailed
}

/// Minimal keychain wrapper for the Rebirth API key, scoped to the shared
/// access group `group.app.rebirth` so iOS app and watch app share the value.
///
/// Same Apple Developer Team ID is required across both targets — if signing
/// teams diverge, reads return `errSecItemNotFound` and the watch surfaces a
/// "Re-pair from phone" recovery flow.
public struct RebirthKeychain: Sendable {
    public static let accessGroup = "group.app.rebirth"
    public static let service = "app.rebirth.api"
    public static let account = "primary"

    public init() {}

    public func getAPIKey() throws -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: Self.account,
            kSecAttrAccessGroup as String: Self.accessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data, let str = String(data: data, encoding: .utf8) else {
                throw KeychainError.encodingFailed
            }
            return str
        case errSecItemNotFound:
            throw KeychainError.itemNotFound
        default:
            throw KeychainError.unexpectedStatus(status)
        }
    }

    public func setAPIKey(_ key: String) throws {
        guard let data = key.data(using: .utf8) else { throw KeychainError.encodingFailed }
        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: Self.account,
            kSecAttrAccessGroup as String: Self.accessGroup,
        ]
        // Try update first — covers re-key without a duplicate-add error.
        let updateAttrs: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, updateAttrs as CFDictionary)
        switch updateStatus {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            var addQuery = baseQuery
            addQuery[kSecValueData as String] = data
            addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw KeychainError.unexpectedStatus(addStatus) }
        default:
            throw KeychainError.unexpectedStatus(updateStatus)
        }
    }

    public func deleteAPIKey() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: Self.account,
            kSecAttrAccessGroup as String: Self.accessGroup,
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            throw KeychainError.unexpectedStatus(status)
        }
    }
}
