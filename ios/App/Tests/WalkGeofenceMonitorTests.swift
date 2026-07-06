// WalkGeofenceMonitorTests.swift
// Regression coverage for the morning-walk INITIATION gate, which moved from
// GeofencePlugin into WalkGeofenceMonitor when the monitor was lifted to
// app-launch scope (so it survives a background region-relaunch where the
// Capacitor plugin's load() never runs).
//
// The bug this guards against: with everything configured correctly (toggle on,
// home+gym set, permission granted, leave time in window) the auto walk silently
// never initiated. Two failure surfaces are exercised here:
//   1. the pure decision gate (shouldInitiateOutboundWalk) returns the right
//      verdict for in/out-of-window times and for "stuck" intermediate phases, and
//   2. that gate lives on the singleton that AppDelegate bootstraps — i.e. it is
//      reachable without any Capacitor plugin instance.
//
// Status: committed but not yet wired into an iOS test target (see README.md).

#if canImport(XCTest)
import XCTest
@testable import App

final class WalkGeofenceMonitorTests: XCTestCase {

    override func setUp() {
        super.setUp()
        UserDefaults.standard.removeObject(forKey: WalkTracker.stateKey)
        UserDefaults.standard.removeObject(forKey: WalkGeofenceMonitor.prefsWindowsKey)
        UserDefaults.standard.removeObject(forKey: WalkGeofenceMonitor.prefsAutoWalkKey)
    }

    /// Brisbane wall-clock date (the app's fixed timezone; no DST).
    private func brisbane(_ y: Int, _ mo: Int, _ d: Int, _ h: Int, _ mi: Int) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Australia/Brisbane")!
        return cal.date(from: DateComponents(year: y, month: mo, day: d, hour: h, minute: mi))!
    }

    // 2026-05-06 is a Wednesday; default weekday window is 04:30–06:00.
    private let inWindowWeekday = { () -> DateComponents in
        DateComponents(year: 2026, month: 5, day: 6, hour: 5, minute: 0)
    }()

    private func monitor() -> WalkGeofenceMonitor { WalkGeofenceMonitor.shared }

    func testInitiatesWhenIdleAndInsideWindowAndEnabled() {
        monitor().setAutoWalkEnabled(true)
        WalkTracker().transition(to: .idle)  // eligible predecessor
        XCTAssertTrue(monitor().shouldInitiateOutboundWalk(at: brisbane(2026, 5, 6, 5, 0)))
    }

    func testDoesNotInitiateOutsideWindow() {
        monitor().setAutoWalkEnabled(true)
        WalkTracker().transition(to: .idle)
        // 06:30 weekday — past the 06:00 close. This is the "looks normal, never
        // fires" case when the user's leave time drifts past the window.
        XCTAssertFalse(monitor().shouldInitiateOutboundWalk(at: brisbane(2026, 5, 6, 6, 30)))
    }

    func testDoesNotInitiateWhenDisabled() {
        monitor().setAutoWalkEnabled(false)
        WalkTracker().transition(to: .idle)
        XCTAssertFalse(monitor().shouldInitiateOutboundWalk(at: brisbane(2026, 5, 6, 5, 0)))
    }

    func testStuckAtGymPhaseBlocksReInitiation() {
        // Regression for the latent stuck-phase trap: if a prior flow never
        // completed, the tracker pins at .atGymWalkSaved and home-exit refuses to
        // start a fresh walk. Documented here so the behaviour is intentional and
        // visible, not a silent surprise.
        monitor().setAutoWalkEnabled(true)
        WalkTracker().transition(to: .atGymWalkSaved, flowId: "stale")
        XCTAssertFalse(monitor().shouldInitiateOutboundWalk(at: brisbane(2026, 5, 6, 5, 0)))
    }

    func testCompletedPhaseAllowsNextDayInitiation() {
        monitor().setAutoWalkEnabled(true)
        WalkTracker().transition(to: .completed)
        XCTAssertTrue(monitor().shouldInitiateOutboundWalk(at: brisbane(2026, 5, 6, 5, 0)))
    }

    func testGateIsReachableOnSingletonWithoutPlugin() {
        // The whole point of the refactor: the decision lives on the launch-scoped
        // singleton, callable with no GeofencePlugin/CAPBridge in the picture.
        monitor().setAutoWalkEnabled(true)
        WalkTracker().transition(to: .idle)
        let verdict = WalkGeofenceMonitor.shared.shouldInitiateOutboundWalk(at: brisbane(2026, 5, 6, 5, 0))
        XCTAssertTrue(verdict)
    }
}
#endif
