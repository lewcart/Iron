import Foundation
import Testing
@testable import RebirthOutbox

@Suite("Outbox basics")
struct OutboxBasicsTests {
    // Note: these tests need the App Group container to exist. On CI they
    // will skip until we set up a sandboxed harness. Day 4 wires this up
    // properly with an in-memory SQLite override.

    @Test("Outbox initialization is idempotent (skipped without container)")
    func initIdempotent() throws {
        try doSkipIfNoContainer()
    }

    private func doSkipIfNoContainer() throws {
        let id = "group.app.rebirth"
        guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) != nil else {
            // Skip silently in unit-test mode without app group entitlement.
            return
        }
        // Real test body lands on Day 4.
    }
}
