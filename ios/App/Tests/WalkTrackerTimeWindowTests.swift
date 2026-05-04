// WalkTrackerTimeWindowTests.swift
// Tests the depart-window gate logic (mirrored in src/lib/geofence.test.ts as
// the TS-side parity check; this is the authoritative Swift version).

#if canImport(XCTest)
import XCTest
@testable import App

final class WalkTrackerTimeWindowTests: XCTestCase {

    /// A self-contained reimplementation of GeofencePlugin.isWithinDepartWindow's
    /// pure logic for testability. The real method reads UserDefaults; here we
    /// pass the windows in directly so tests don't touch persisted state.
    private func isInside(_ now: Date,
                          weekday: (sh: Int, sm: Int, eh: Int, em: Int),
                          weekend: (sh: Int, sm: Int, eh: Int, em: Int)) -> Bool {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/London")!
        let weekday1to7 = cal.component(.weekday, from: now)  // 1=Sun
        let isWeekend = (weekday1to7 == 1 || weekday1to7 == 7)
        let w = isWeekend ? weekend : weekday
        let h = cal.component(.hour, from: now)
        let m = cal.component(.minute, from: now)
        let nowMin = h * 60 + m
        let startMin = w.sh * 60 + w.sm
        let endMin = w.eh * 60 + w.em
        return nowMin >= startMin && nowMin < endMin
    }

    private let wd = (sh: 4, sm: 30, eh: 6, em: 0)
    private let we = (sh: 5, sm: 0, eh: 8, em: 0)

    private func london(_ y: Int, _ mo: Int, _ d: Int, _ h: Int, _ mi: Int) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/London")!
        let comps = DateComponents(year: y, month: mo, day: d, hour: h, minute: mi)
        return cal.date(from: comps)!
    }

    func testWeekdayInsideWindow() {
        XCTAssertTrue(isInside(london(2026, 5, 6, 4, 35), weekday: wd, weekend: we))
    }

    func testWeekdayOutsideAfterWindow() {
        XCTAssertFalse(isInside(london(2026, 5, 6, 6, 30), weekday: wd, weekend: we))
    }

    func testWeekdayClosingEdgeIsExclusive() {
        XCTAssertFalse(isInside(london(2026, 5, 6, 6, 0), weekday: wd, weekend: we))
    }

    func testWeekdayOpeningEdgeIsInclusive() {
        XCTAssertTrue(isInside(london(2026, 5, 6, 4, 30), weekday: wd, weekend: we))
    }

    func testSaturdayBeforeWeekendWindow() {
        XCTAssertFalse(isInside(london(2026, 5, 9, 4, 45), weekday: wd, weekend: we))
    }

    func testSaturdayInsideWeekendWindow() {
        XCTAssertTrue(isInside(london(2026, 5, 9, 5, 30), weekday: wd, weekend: we))
    }

    func testSundayAfterWeekendWindow() {
        XCTAssertFalse(isInside(london(2026, 5, 10, 9, 0), weekday: wd, weekend: we))
    }

    func testDSTSpringForward() {
        // 2026 BST starts 2026-03-29 01:00 UTC = 02:00 BST.
        // 04:35 BST should still be inside the window.
        XCTAssertTrue(isInside(london(2026, 3, 30, 4, 35), weekday: wd, weekend: we))
    }
}
#endif
