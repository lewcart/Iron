// WalkTrackerStateMachineTests.swift
// Unit tests for WalkPhase round-trip and WalkTrackerState persistence shape.
// See ios/App/Tests/README.md for how to wire these into a test target.

#if canImport(XCTest)
import XCTest
@testable import App  // app module exposed via ENABLE_TESTABILITY=YES

final class WalkTrackerStateMachineTests: XCTestCase {

    override func setUp() {
        super.setUp()
        UserDefaults.standard.removeObject(forKey: WalkTracker.stateKey)
        UserDefaults.standard.removeObject(forKey: WalkTracker.hkWriteLikelyDeniedKey)
    }

    func testInitialPhaseIsIdle() {
        let t = WalkTracker(healthStore: nil)
        XCTAssertEqual(t.loadState().phase, .idle)
    }

    func testStateRoundTripThroughEncoder() throws {
        let original = WalkTrackerState(
            phase: .walkOutboundActive,
            flowId: "test-flow-1",
            startedAt: Date(timeIntervalSince1970: 1_700_000_000),
            lastFlushAt: Date(timeIntervalSince1970: 1_700_000_030),
            lastWalkSummary: nil
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(original)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let round = try decoder.decode(WalkTrackerState.self, from: data)
        XCTAssertEqual(round.phase, original.phase)
        XCTAssertEqual(round.flowId, original.flowId)
        XCTAssertEqual(round.startedAt, original.startedAt)
    }

    func testTransitionPersistsNewPhase() {
        let t = WalkTracker(healthStore: nil)
        t.transition(to: .walkOutboundActive, flowId: "flow-1")
        XCTAssertEqual(t.loadState().phase, .walkOutboundActive)
        XCTAssertEqual(t.loadState().flowId, "flow-1")

        t.transition(to: .atGymWalkSaved)
        XCTAssertEqual(t.loadState().phase, .atGymWalkSaved)
        XCTAssertEqual(t.loadState().flowId, "flow-1")
    }

    func testCompletedClearsStartedAt() {
        let t = WalkTracker(healthStore: nil)
        let _ = t.start(reason: .departHome)
        XCTAssertNotNil(t.loadState().startedAt)
        t.transition(to: .completed)
        XCTAssertNil(t.loadState().startedAt)
    }

    func testEveryPhaseRawValueIsStable() {
        // Stable raw values are required for the JS bridge contract.
        XCTAssertEqual(WalkPhase.idle.rawValue, "idle")
        XCTAssertEqual(WalkPhase.walkOutboundActive.rawValue, "walkOutboundActive")
        XCTAssertEqual(WalkPhase.atGymWalkSaved.rawValue, "atGymWalkSaved")
        XCTAssertEqual(WalkPhase.strengthActive.rawValue, "strengthActive")
        XCTAssertEqual(WalkPhase.walkInboundActive.rawValue, "walkInboundActive")
        XCTAssertEqual(WalkPhase.completed.rawValue, "completed")
        XCTAssertEqual(WalkPhase.partialMissedInbound.rawValue, "partialMissedInbound")
        XCTAssertEqual(WalkPhase.failedSaveAwaitingRetry.rawValue, "failedSaveAwaitingRetry")
        XCTAssertEqual(WalkPhase.permissionRevoked.rawValue, "permissionRevoked")
    }
}
#endif
