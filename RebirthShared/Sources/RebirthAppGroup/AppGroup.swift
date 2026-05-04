import Foundation
import RebirthModels

/// Shared App Group container access. Both iOS app (writer) and watch app
/// (reader) target `group.app.rebirth`. Snapshot is the latest active workout
/// state; outbox SQLite lives at `<container>/outbox.sqlite`.
public struct RebirthAppGroup: Sendable {
    public static let identifier = "group.app.rebirth"

    public static let snapshotKey = "rebirth.activeWorkoutSnapshot.v1"

    public init() {}

    public var defaults: UserDefaults? {
        UserDefaults(suiteName: Self.identifier)
    }

    public var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.identifier)
    }

    public var outboxURL: URL? {
        containerURL?.appendingPathComponent("outbox.sqlite")
    }

    public var watchLogURL: URL? {
        containerURL?.appendingPathComponent("watch-log.txt")
    }

    public func writeSnapshot(_ snapshot: ActiveWorkoutSnapshot) throws {
        guard let defaults = defaults else { return }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let payload = VersionedPayload(snapshot)
        let data = try encoder.encode(payload)
        defaults.set(data, forKey: Self.snapshotKey)
    }

    public func readSnapshot() throws -> ActiveWorkoutSnapshot? {
        guard let defaults = defaults, let data = defaults.data(forKey: Self.snapshotKey) else {
            return nil
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let payload = try decoder.decode(VersionedPayload<ActiveWorkoutSnapshot>.self, from: data)
        guard SchemaVersion.supported.contains(payload.schemaVersion) else {
            throw AppGroupError.unsupportedSchemaVersion(payload.schemaVersion)
        }
        return payload.body
    }

    public func clearSnapshot() {
        defaults?.removeObject(forKey: Self.snapshotKey)
    }
}

public enum AppGroupError: Error, Equatable {
    case unsupportedSchemaVersion(Int)
}
