import Foundation
import Testing
@testable import RebirthOutbox

@Suite("Outbox basics")
struct OutboxBasicsTests {

    private func tempOutboxURL() -> URL {
        let dir = FileManager.default.temporaryDirectory
        return dir.appendingPathComponent("rebirth-outbox-\(UUID().uuidString).sqlite")
    }

    @Test("Enqueue + pending round-trip")
    func enqueueRoundTrip() throws {
        let url = tempOutboxURL()
        defer { try? FileManager.default.removeItem(at: url) }
        let outbox = try RebirthOutbox(url: url)

        let body = "{\"workout_sets\":[]}".data(using: .utf8)!
        try outbox.enqueue(mutationId: "m1", endpoint: "/api/sync/push", body: body)
        try outbox.enqueue(mutationId: "m2", endpoint: "/api/sync/push", body: body)

        let pending = try outbox.pending()
        #expect(pending.count == 2)
        #expect(pending.map(\.mutationId) == ["m1", "m2"])
        #expect(try outbox.count() == 2)
    }

    @Test("Remove drops a pending row")
    func removeDrops() throws {
        let url = tempOutboxURL()
        defer { try? FileManager.default.removeItem(at: url) }
        let outbox = try RebirthOutbox(url: url)

        try outbox.enqueue(mutationId: "m1", endpoint: "/api/sync/push", body: Data("a".utf8))
        try outbox.enqueue(mutationId: "m2", endpoint: "/api/sync/push", body: Data("b".utf8))
        try outbox.remove(mutationId: "m1")

        let pending = try outbox.pending()
        #expect(pending.count == 1)
        #expect(pending.first?.mutationId == "m2")
    }

    @Test("recordAttempt increments and stores last error")
    func recordAttempt() throws {
        let url = tempOutboxURL()
        defer { try? FileManager.default.removeItem(at: url) }
        let outbox = try RebirthOutbox(url: url)

        try outbox.enqueue(mutationId: "m1", endpoint: "/api/sync/push", body: Data("a".utf8))
        try outbox.recordAttempt(mutationId: "m1", error: "boom")
        try outbox.recordAttempt(mutationId: "m1", error: "boom2")

        let pending = try outbox.pending()
        let row = try #require(pending.first)
        #expect(row.attemptCount == 2)
        #expect(row.lastError == "boom2")
        #expect(row.lastAttemptAt != nil)
    }

    @Test("Re-enqueue same mutationId replaces (idempotency)")
    func enqueueIsIdempotent() throws {
        let url = tempOutboxURL()
        defer { try? FileManager.default.removeItem(at: url) }
        let outbox = try RebirthOutbox(url: url)

        try outbox.enqueue(mutationId: "m1", endpoint: "/api/sync/push", body: Data("a".utf8))
        try outbox.enqueue(mutationId: "m1", endpoint: "/api/sync/push", body: Data("b".utf8))
        let pending = try outbox.pending()
        #expect(pending.count == 1)
        #expect(pending.first?.bodyJSON == Data("b".utf8))
    }

    @Test("Survives reopen — persistence is on disk")
    func persistenceAcrossReopen() throws {
        let url = tempOutboxURL()
        defer { try? FileManager.default.removeItem(at: url) }
        do {
            let outbox = try RebirthOutbox(url: url)
            try outbox.enqueue(mutationId: "m1", endpoint: "/api/sync/push", body: Data("hello".utf8))
        }
        let outbox2 = try RebirthOutbox(url: url)
        let pending = try outbox2.pending()
        #expect(pending.count == 1)
        #expect(pending.first?.mutationId == "m1")
    }
}
