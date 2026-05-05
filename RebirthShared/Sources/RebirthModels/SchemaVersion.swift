import Foundation

public enum SchemaVersion {
    public static let current: Int = 1
    public static let supported: ClosedRange<Int> = 1...1
}

public struct VersionedPayload<Body: Codable>: Codable {
    public let schemaVersion: Int
    public let body: Body

    public init(_ body: Body, version: Int = SchemaVersion.current) {
        self.schemaVersion = version
        self.body = body
    }

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case body
    }
}
