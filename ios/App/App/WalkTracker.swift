import Foundation
import CoreLocation
import HealthKit

// MARK: - WalkPhase

/// Single source of truth for the morning-flow state machine. Persisted to
/// UserDefaults via WalkTrackerState; UI state matrix maps 1:1.
enum WalkPhase: String, Codable {
    case idle
    case walkOutboundActive
    case atGymWalkSaved
    case strengthActive
    case walkInboundActive
    case completed
    case partialMissedInbound
    case failedSaveAwaitingRetry
    case permissionRevoked
}

// MARK: - WalkTrackerState (persisted)

/// Small, frequently-written state. Route samples are stored separately as
/// JSONL files (see WalkTrackerStorage) — keeping this struct tiny makes
/// UserDefaults appropriate.
struct WalkTrackerState: Codable {
    var phase: WalkPhase
    var flowId: String?
    var startedAt: Date?
    var lastFlushAt: Date?
    var lastWalkSummary: WalkSummary?
}

struct WalkSummary: Codable {
    let outboundDistanceMeters: Double?
    let outboundDurationSeconds: TimeInterval?
    let outboundEndedAt: Date?
    let strengthDurationSeconds: TimeInterval?
    let inboundDistanceMeters: Double?
    let inboundDurationSeconds: TimeInterval?
    let inboundEndedAt: Date?
    let isPartial: Bool
}

// MARK: - WalkSnapshot (returned to JS)

struct WalkSnapshot: Codable {
    let phase: String
    let flowId: String?
    let startedAt: String?  // ISO-8601
    let distanceMeters: Double
    let durationSeconds: TimeInterval
    let lastSampleAt: String?
}

// MARK: - WalkTrackerStorage

/// JSONL-based route sample storage. Append-only with throttled flush.
/// Lives under Application Support/walks/<flowId>/route.jsonl.
final class WalkTrackerStorage {
    private let fileManager = FileManager.default

    private func walksDirectory() throws -> URL {
        let base = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let dir = base.appendingPathComponent("walks", isDirectory: true)
        if !fileManager.fileExists(atPath: dir.path) {
            try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    func routeFile(flowId: String) throws -> URL {
        let dir = try walksDirectory().appendingPathComponent(flowId, isDirectory: true)
        if !fileManager.fileExists(atPath: dir.path) {
            try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir.appendingPathComponent("route.jsonl", isDirectory: false)
    }

    func append(samples: [CLLocation], to flowId: String) throws {
        let url = try routeFile(flowId: flowId)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        var blob = Data()
        for s in samples {
            let line = SampleLine(
                lat: s.coordinate.latitude,
                lon: s.coordinate.longitude,
                alt: s.altitude,
                ts: s.timestamp,
                speed: s.speed >= 0 ? s.speed : nil,
                horizAcc: s.horizontalAccuracy
            )
            if let data = try? encoder.encode(line) {
                blob.append(data)
                blob.append(0x0A)  // newline
            }
        }
        if blob.isEmpty { return }
        if fileManager.fileExists(atPath: url.path) {
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: blob)
        } else {
            try blob.write(to: url)
        }
    }

    func loadAll(flowId: String) throws -> [CLLocation] {
        let url = try routeFile(flowId: flowId)
        guard fileManager.fileExists(atPath: url.path) else { return [] }
        let raw = try String(contentsOf: url, encoding: .utf8)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        var out: [CLLocation] = []
        for line in raw.split(separator: "\n", omittingEmptySubsequences: true) {
            guard let data = line.data(using: .utf8) else { continue }
            // Skip last partial line on truncated write (decoder will fail, we ignore).
            guard let s = try? decoder.decode(SampleLine.self, from: data) else { continue }
            let loc = CLLocation(
                coordinate: CLLocationCoordinate2D(latitude: s.lat, longitude: s.lon),
                altitude: s.alt,
                horizontalAccuracy: s.horizAcc,
                verticalAccuracy: -1,
                course: -1,
                speed: s.speed ?? -1,
                timestamp: s.ts
            )
            out.append(loc)
        }
        return out
    }

    func delete(flowId: String) {
        guard let dir = try? walksDirectory().appendingPathComponent(flowId, isDirectory: true) else {
            return
        }
        try? fileManager.removeItem(at: dir)
    }

    private struct SampleLine: Codable {
        let lat: Double
        let lon: Double
        let alt: Double
        let ts: Date
        let speed: Double?
        let horizAcc: Double
    }
}

// MARK: - WalkTracker

/// Stateful collector that owns active-walk lifecycle: start, accumulate
/// CLLocation samples (passed in from the GeofencePlugin's location manager),
/// throttle-flush to disk, and finalize via HKWorkoutBuilder + HKWorkoutRouteBuilder.
///
/// Coordinator boundary: GeofencePlugin owns the single CLLocationManager. WalkTracker
/// is a passive collector — the plugin routes didUpdateLocations callbacks here.
final class WalkTracker {

    static let stateKey = "WalkTrackerState.v1"
    static let hkWriteLikelyDeniedKey = "WalkTracker.hkWriteLikelyDenied"

    enum WalkReason: String, Codable {
        case departHome
        case postWorkout
    }

    private let storage = WalkTrackerStorage()
    private let healthStore: HKHealthStore?

    /// In-memory accumulators. Reset on start/cancel/finish. All access goes
    /// through `serialQueue` to keep mutations safe across the CLLocation delegate,
    /// JS bridge, and HealthKit completion callbacks.
    private var activeFlowId: String?
    private var activeStartedAt: Date?
    private var pendingSamples: [CLLocation] = []
    private var totalSamplesCount: Int = 0
    private var lastFlushAt: Date?
    private var firstFlushedSampleAt: Date?
    private var lastSampleAt: Date?
    private var finishInFlight: Bool = false

    /// Serial queue for all mutable-state access. CLLocationManager delegate
    /// callbacks, Capacitor plugin calls, and notification action handlers all
    /// hop onto this queue before touching any tracker state.
    private let serialQueue = DispatchQueue(label: "com.rebirth.walk-tracker.serial")

    /// Throttle thresholds.
    private static let flushIntervalSeconds: TimeInterval = 30
    private static let flushDistanceMeters: Double = 50

    init(healthStore: HKHealthStore? = HKHealthStore.isHealthDataAvailable() ? HKHealthStore() : nil) {
        self.healthStore = healthStore
    }

    /// Request HealthKit write permissions for workout + route + the sample
    /// types we attach to the workout. Idempotent; iOS only prompts once and
    /// remembers the answer per type.
    func requestHKWriteAuthorization(completion: @escaping (Bool, Error?) -> Void) {
        guard let store = healthStore else {
            completion(false, nil)
            return
        }
        var write: Set<HKSampleType> = [HKObjectType.workoutType(), HKSeriesType.workoutRoute()]
        if let d = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning) {
            write.insert(d)
        }
        if let e = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
            write.insert(e)
        }
        store.requestAuthorization(toShare: write, read: []) { success, err in
            DispatchQueue.main.async { completion(success, err) }
        }
    }

    // MARK: - State persistence

    func loadState() -> WalkTrackerState {
        guard let data = UserDefaults.standard.data(forKey: WalkTracker.stateKey) else {
            return WalkTrackerState(phase: .idle, flowId: nil, startedAt: nil, lastFlushAt: nil, lastWalkSummary: nil)
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        if let s = try? decoder.decode(WalkTrackerState.self, from: data) {
            return s
        }
        return WalkTrackerState(phase: .idle, flowId: nil, startedAt: nil, lastFlushAt: nil, lastWalkSummary: nil)
    }

    func saveState(_ state: WalkTrackerState) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(state) {
            UserDefaults.standard.set(data, forKey: WalkTracker.stateKey)
        }
    }

    /// Single transition point — every phase change flows through here so
    /// observers always see consistent state.
    func transition(to newPhase: WalkPhase, flowId: String? = nil, reason: String? = nil, onChange: ((WalkTrackerState) -> Void)? = nil) {
        var s = loadState()
        s.phase = newPhase
        if let flowId = flowId { s.flowId = flowId }
        if newPhase == .idle || newPhase == .completed || newPhase == .partialMissedInbound {
            // Phase implies the flow is over; keep flowId for status row but clear active markers.
            s.startedAt = nil
        }
        saveState(s)
        onChange?(s)
    }

    // MARK: - Lifecycle

    /// Begin a new walk. Returns the flowId to be used for route storage.
    ///
    /// Departing home (.departHome) always mints a new flowId — yesterday's
    /// completed flow shouldn't taint today's. Post-workout (.postWorkout)
    /// reuses the existing flowId so walk-1 + walk-2 share the same morning
    /// timeline. Falls back to a new id if none is present.
    func start(reason: WalkReason, at: Date = Date()) -> String {
        return serialQueue.sync {
            let flowId: String
            switch reason {
            case .departHome:
                flowId = UUID().uuidString
            case .postWorkout:
                flowId = currentFlowIdOrNew_unsafe()
            }
            activeFlowId = flowId
            activeStartedAt = at
            pendingSamples = []
            totalSamplesCount = 0
            lastFlushAt = at
            firstFlushedSampleAt = nil
            lastSampleAt = nil
            finishInFlight = false

            var s = loadState()
            s.phase = (reason == .departHome) ? .walkOutboundActive : .walkInboundActive
            s.flowId = flowId
            s.startedAt = at
            s.lastFlushAt = at
            saveState(s)

            return flowId
        }
    }

    /// Hydrate in-memory accumulators from persisted state on app relaunch.
    /// Returns true if there was an active walk to restore. Called by
    /// GeofencePlugin.recoverActiveWalkIfNeeded before resuming or finishing.
    func restoreActiveWalkIfPersisted() -> Bool {
        return serialQueue.sync {
            let s = loadState()
            guard
                s.phase == .walkOutboundActive || s.phase == .walkInboundActive,
                let flowId = s.flowId,
                let started = s.startedAt
            else {
                return false
            }
            activeFlowId = flowId
            activeStartedAt = started
            pendingSamples = []
            // Best-effort: derive lastSampleAt from the persisted route file.
            if let samples = try? storage.loadAll(flowId: flowId), let last = samples.last {
                lastSampleAt = last.timestamp
                totalSamplesCount = samples.count
            } else {
                lastSampleAt = nil
                totalSamplesCount = 0
            }
            lastFlushAt = s.lastFlushAt ?? started
            firstFlushedSampleAt = nil
            finishInFlight = false
            return true
        }
    }

    /// Add a location sample. Throttled flush to disk.
    func ingest(location: CLLocation) {
        serialQueue.sync {
            guard activeFlowId != nil else { return }
            // Filter obviously bogus points.
            if location.horizontalAccuracy < 0 || location.horizontalAccuracy > 100 { return }
            pendingSamples.append(location)
            totalSamplesCount += 1
            lastSampleAt = location.timestamp
            if firstFlushedSampleAt == nil { firstFlushedSampleAt = location.timestamp }
            flushIfDue_unsafe()
        }
    }

    /// Internal helper, must be called inside serialQueue.
    private func flushIfDue_unsafe() {
        guard let flowId = activeFlowId, !pendingSamples.isEmpty else { return }
        let now = Date()
        let timeSinceFlush = now.timeIntervalSince(lastFlushAt ?? now)
        let distSinceFlush = approximateDistance(of: pendingSamples)
        if timeSinceFlush >= WalkTracker.flushIntervalSeconds || distSinceFlush >= WalkTracker.flushDistanceMeters {
            do {
                try storage.append(samples: pendingSamples, to: flowId)
                pendingSamples = []
                lastFlushAt = now
                var s = loadState()
                s.lastFlushAt = now
                saveState(s)
            } catch {
                // Disk write failed (storage protected, file handle error). Keep
                // pendingSamples in memory — a later flush retries the same data.
                // We don't surface this to UI yet; if the same condition persists
                // until finish(), the samples are flushed there too (or finish
                // fails, transitioning to .failedSaveAwaitingRetry).
                print("[WalkTracker] flush failed: \(error)")
            }
        }
    }

    /// Force-flush remaining buffered samples (called before finish/cancel).
    /// Must be called inside serialQueue.
    private func forceFlush_unsafe() {
        guard let flowId = activeFlowId, !pendingSamples.isEmpty else { return }
        do {
            try storage.append(samples: pendingSamples, to: flowId)
            pendingSamples = []
            lastFlushAt = Date()
        } catch {
            // Same conservative behavior as flushIfDue_unsafe — keep samples in memory.
            print("[WalkTracker] force-flush failed: \(error)")
        }
    }

    /// Finalize the active walk: save HKWorkout + HKWorkoutRoute. Returns
    /// the saved workout, or nil on permission denied / other failure.
    func finish(at: Date = Date(), completion: @escaping (Result<HKWorkout, WalkSaveError>) -> Void) {
        // Single guard + flush + setup all under one serialQueue hop. The HK
        // callback chain itself runs on HK's queue (we don't re-serialize it
        // because each callback only writes to its own continuation), but we
        // guard finishInFlight against double-firing.
        let setup: (flowId: String, startedAt: Date, leg: String, samples: [CLLocation], distance: Double, energy: Double, store: HKHealthStore)? = serialQueue.sync {
            if finishInFlight { return nil }
            guard let flowId = activeFlowId, let startedAt = activeStartedAt else { return nil }
            guard let store = healthStore else { return nil }
            forceFlush_unsafe()
            let allSamples = (try? storage.loadAll(flowId: flowId)) ?? []
            if allSamples.isEmpty { return nil }
            finishInFlight = true
            let leg = (loadState().phase == .walkInboundActive) ? "inbound" : "outbound"
            let dist = approximateDistance(of: allSamples)
            let energy = estimateEnergyKcal(distanceMeters: dist, durationSeconds: at.timeIntervalSince(startedAt))
            return (flowId, startedAt, leg, allSamples, dist, energy, store)
        }
        guard let s = setup else {
            // Determine the precise reason. (One more serialQueue hop, cheap.)
            let reason: WalkSaveError = serialQueue.sync {
                if finishInFlight { return .notActive }  // already in flight, treat as no-op-ish
                if activeFlowId == nil || activeStartedAt == nil { return .notActive }
                if healthStore == nil { return .healthKitUnavailable }
                return .noSamples
            }
            completion(.failure(reason))
            return
        }

        let config = HKWorkoutConfiguration()
        config.activityType = .walking
        config.locationType = .outdoor

        let builder = HKWorkoutBuilder(healthStore: s.store, configuration: config, device: .local())
        builder.beginCollection(withStart: s.startedAt) { [weak self] success, err in
            guard let self else { return }
            if !success {
                self.clearFinishInFlight()
                completion(.failure(.beginCollectionFailed(err)))
                return
            }
            var hkSamples: [HKSample] = []
            if let distanceType = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning) {
                let distQty = HKQuantity(unit: .meter(), doubleValue: s.distance)
                hkSamples.append(HKQuantitySample(type: distanceType, quantity: distQty, start: s.startedAt, end: at))
            }
            if let energyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned), s.energy > 0 {
                let kcal = HKQuantity(unit: .kilocalorie(), doubleValue: s.energy)
                hkSamples.append(HKQuantitySample(type: energyType, quantity: kcal, start: s.startedAt, end: at))
            }
            let metadata: [String: Any] = [
                HKMetadataKeyWorkoutBrandName: "Rebirth",
                "RebirthFlowId": s.flowId,
                "RebirthWalkLeg": s.leg
            ]
            builder.addMetadata(metadata) { metaSuccess, metaErr in
                if !metaSuccess {
                    self.markHKWriteLikelyDenied(if: metaErr)
                    self.clearFinishInFlight()
                    completion(.failure(.finishWorkoutFailed(metaErr)))
                    return
                }
                builder.add(hkSamples) { addSuccess, addErr in
                    if !addSuccess {
                        self.markHKWriteLikelyDenied(if: addErr)
                        self.clearFinishInFlight()
                        completion(.failure(.finishWorkoutFailed(addErr)))
                        return
                    }
                    builder.endCollection(withEnd: at) { endSuccess, endErr in
                        if !endSuccess {
                            self.markHKWriteLikelyDenied(if: endErr)
                            self.clearFinishInFlight()
                            completion(.failure(.finishWorkoutFailed(endErr)))
                            return
                        }
                        builder.finishWorkout { workout, finErr in
                            guard let workout = workout, finErr == nil else {
                                self.markHKWriteLikelyDenied(if: finErr)
                                self.clearFinishInFlight()
                                completion(.failure(.finishWorkoutFailed(finErr)))
                                return
                            }
                            // Workout finalized. Now associate the route.
                            let routeBuilder = HKWorkoutRouteBuilder(healthStore: s.store, device: .local())
                            routeBuilder.insertRouteData(s.samples) { insertSuccess, routeErr in
                                if !insertSuccess {
                                    self.markHKWriteLikelyDenied(if: routeErr)
                                    self.clearFinishInFlight()
                                    completion(.failure(.routeInsertFailed(routeErr ?? GenericRouteError(), workout: workout)))
                                    return
                                }
                                routeBuilder.finishRoute(with: workout, metadata: nil) { route, finishErr in
                                    if route == nil || finishErr != nil {
                                        self.markHKWriteLikelyDenied(if: finishErr)
                                        self.clearFinishInFlight()
                                        completion(.failure(.routeInsertFailed(finishErr ?? GenericRouteError(), workout: workout)))
                                        return
                                    }
                                    UserDefaults.standard.removeObject(forKey: WalkTracker.hkWriteLikelyDeniedKey)
                                    self.cleanupAfterSave(flowId: s.flowId)
                                    completion(.success(workout))
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private func clearFinishInFlight() {
        serialQueue.sync { finishInFlight = false }
    }

    private struct GenericRouteError: Error {
        let localizedDescription: String = "HKWorkoutRouteBuilder failure"
    }

    /// Cancel without saving. Deletes the route file.
    func cancel() {
        serialQueue.sync {
            if let flowId = activeFlowId {
                storage.delete(flowId: flowId)
            }
            activeFlowId = nil
            activeStartedAt = nil
            pendingSamples = []
            totalSamplesCount = 0
            lastFlushAt = nil
            firstFlushedSampleAt = nil
            lastSampleAt = nil
            finishInFlight = false
            var s = loadState()
            s.phase = .idle
            s.startedAt = nil
            // flowId preserved for status row continuity through the day.
            saveState(s)
        }
    }

    /// Inject a synthetic route (back-dated samples around the user's current
    /// position) and persist them as if they came from CLLocationManager.
    /// Used by the dev "Simulate walk" buttons to exercise the full save path
    /// without leaving the house.
    ///
    /// `centerLat`/`centerLon` is where the synthetic route lives in space.
    /// Samples are placed in a small ~200m loop around that point, with
    /// timestamps spread evenly across `durationSeconds`, ending at `endsAt`.
    func injectSyntheticRoute(
        centerLat: Double,
        centerLon: Double,
        sampleCount: Int = 20,
        durationSeconds: TimeInterval,
        endsAt: Date = Date()
    ) {
        serialQueue.sync {
            guard activeFlowId != nil else { return }
            let startTime = endsAt.addingTimeInterval(-durationSeconds)
            // Simple circular route: place samples on a circle of ~80m radius
            // around the centre point. Earth radius ~6371000m; 80m → ~0.00072°.
            let radiusDeg = 0.00072
            var synthetic: [CLLocation] = []
            for i in 0..<sampleCount {
                let progress = Double(i) / Double(sampleCount - 1)
                let angle = progress * 2 * .pi
                let dLat = radiusDeg * cos(angle)
                let dLon = radiusDeg * sin(angle)
                let ts = startTime.addingTimeInterval(durationSeconds * progress)
                let loc = CLLocation(
                    coordinate: CLLocationCoordinate2D(latitude: centerLat + dLat, longitude: centerLon + dLon),
                    altitude: 10,
                    horizontalAccuracy: 5,
                    verticalAccuracy: 5,
                    course: 0,
                    speed: 1.4,
                    timestamp: ts
                )
                synthetic.append(loc)
            }
            // Append to disk in one shot.
            do {
                if let flowId = activeFlowId {
                    try storage.append(samples: synthetic, to: flowId)
                    totalSamplesCount += synthetic.count
                    lastSampleAt = synthetic.last?.timestamp
                }
            } catch {
                print("[WalkTracker] injectSyntheticRoute append failed: \(error)")
            }
            // Backdate startedAt so HKWorkoutBuilder accepts the duration. Only
            // backdate if we're currently set to a more recent time than the
            // synthetic route's beginning.
            if let started = activeStartedAt, started > startTime {
                activeStartedAt = startTime
                var s = loadState()
                s.startedAt = startTime
                saveState(s)
            }
        }
    }

    /// Cancel using only persisted state. Used by the notification action
    /// handler which may run before the JS bridge is alive (cold launch via
    /// notification action).
    func cancelFromPersistedState() {
        serialQueue.sync {
            let s = loadState()
            if let flowId = s.flowId {
                storage.delete(flowId: flowId)
            }
            activeFlowId = nil
            activeStartedAt = nil
            pendingSamples = []
            totalSamplesCount = 0
            lastFlushAt = nil
            firstFlushedSampleAt = nil
            lastSampleAt = nil
            finishInFlight = false
            var ns = s
            ns.phase = .idle
            ns.startedAt = nil
            saveState(ns)
        }
    }

    /// Read-side: snapshot of current active walk for JS.
    func snapshot() -> WalkSnapshot {
        let s = loadState()
        let dist: Double = {
            // Approximation: in-memory pending + already-flushed (best effort).
            let inMemoryDist = approximateDistance(of: pendingSamples)
            return inMemoryDist
        }()
        let dur: TimeInterval = {
            if let started = s.startedAt {
                return Date().timeIntervalSince(started)
            }
            return 0
        }()
        let iso = ISO8601DateFormatter()
        return WalkSnapshot(
            phase: s.phase.rawValue,
            flowId: s.flowId,
            startedAt: s.startedAt.map { iso.string(from: $0) },
            distanceMeters: dist,
            durationSeconds: dur,
            lastSampleAt: lastSampleAt.map { iso.string(from: $0) }
        )
    }

    // MARK: - Helpers

    /// Internal helper, must be called inside serialQueue.
    private func currentFlowIdOrNew_unsafe() -> String {
        let s = loadState()
        if let id = s.flowId, !id.isEmpty { return id }
        return UUID().uuidString
    }

    private func cleanupAfterSave(flowId: String) {
        storage.delete(flowId: flowId)
        activeFlowId = nil
        activeStartedAt = nil
        pendingSamples = []
        firstFlushedSampleAt = nil
        lastSampleAt = nil
    }

    private func markHKWriteLikelyDenied(if error: Error?) {
        guard let err = error as NSError? else { return }
        if err.domain == HKError.errorDomain, err.code == HKError.errorAuthorizationDenied.rawValue {
            UserDefaults.standard.set(true, forKey: WalkTracker.hkWriteLikelyDeniedKey)
        }
    }

    private func approximateDistance(of samples: [CLLocation]) -> Double {
        guard samples.count >= 2 else { return 0 }
        var total: Double = 0
        for i in 1..<samples.count {
            total += samples[i].distance(from: samples[i - 1])
        }
        return total
    }

    private func totalDistance(samples: [CLLocation]) -> Double {
        approximateDistance(of: samples)
    }

    /// Rough kcal estimate for a 75kg adult walking outdoors. Used only when
    /// no user-specific weight is available — HealthKit will compute its own
    /// energy if not provided, but we add it so the workout shows non-zero.
    private func estimateEnergyKcal(distanceMeters: Double, durationSeconds: TimeInterval) -> Double {
        guard distanceMeters > 0, durationSeconds > 0 else { return 0 }
        let km = distanceMeters / 1000.0
        return km * 60.0  // ~60 kcal/km baseline; intentionally undermeasured to stay conservative
    }
}

// MARK: - WalkSaveError

enum WalkSaveError: Error {
    case notActive
    case healthKitUnavailable
    case noSamples
    case beginCollectionFailed(Error?)
    case finishWorkoutFailed(Error?)
    case routeInsertFailed(Error, workout: HKWorkout?)
}

