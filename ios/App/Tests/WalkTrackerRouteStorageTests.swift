// WalkTrackerRouteStorageTests.swift
// JSONL round-trip + truncated-write tolerance.

#if canImport(XCTest)
import XCTest
import CoreLocation
@testable import App

final class WalkTrackerRouteStorageTests: XCTestCase {

    let storage = WalkTrackerStorage()
    let testFlowId = "tests-route-storage"

    override func setUp() {
        super.setUp()
        storage.delete(flowId: testFlowId)
    }

    override func tearDown() {
        storage.delete(flowId: testFlowId)
        super.tearDown()
    }

    func testRoundTripPreservesCoordinates() throws {
        let now = Date()
        let samples: [CLLocation] = (0..<10).map { i in
            CLLocation(
                coordinate: CLLocationCoordinate2D(latitude: 51.5 + Double(i) * 0.0001, longitude: -0.1),
                altitude: 10,
                horizontalAccuracy: 5,
                verticalAccuracy: 5,
                course: 0,
                speed: 1.4,
                timestamp: now.addingTimeInterval(TimeInterval(i))
            )
        }
        try storage.append(samples: samples, to: testFlowId)
        let loaded = try storage.loadAll(flowId: testFlowId)
        XCTAssertEqual(loaded.count, samples.count)
        for (a, b) in zip(samples, loaded) {
            XCTAssertEqual(a.coordinate.latitude, b.coordinate.latitude, accuracy: 1e-9)
            XCTAssertEqual(a.coordinate.longitude, b.coordinate.longitude, accuracy: 1e-9)
            XCTAssertEqual(a.timestamp.timeIntervalSince1970, b.timestamp.timeIntervalSince1970, accuracy: 1.0)
        }
    }

    func testAppendsToExistingFile() throws {
        let now = Date()
        let first = [CLLocation(latitude: 51.5, longitude: -0.1)]
        let second = [CLLocation(latitude: 51.6, longitude: -0.2)]
        try storage.append(samples: first, to: testFlowId)
        try storage.append(samples: second, to: testFlowId)
        let loaded = try storage.loadAll(flowId: testFlowId)
        XCTAssertEqual(loaded.count, 2)
        _ = now
    }

    func testTruncatedLineIsIgnored() throws {
        let url = try storage.routeFile(flowId: testFlowId)
        let bytes = "{\"lat\":51.5,\"lon\":-0.1,\"alt\":0,\"ts\":\"2026-05-04T05:00:00Z\",\"horizAcc\":5}\n{\"lat\":51".data(using: .utf8)!
        try bytes.write(to: url)
        let loaded = try storage.loadAll(flowId: testFlowId)
        XCTAssertEqual(loaded.count, 1)
    }

    func testDeleteRemovesFile() throws {
        try storage.append(samples: [CLLocation(latitude: 51.5, longitude: -0.1)], to: testFlowId)
        XCTAssertFalse(try storage.loadAll(flowId: testFlowId).isEmpty)
        storage.delete(flowId: testFlowId)
        XCTAssertTrue(try storage.loadAll(flowId: testFlowId).isEmpty)
    }
}
#endif
