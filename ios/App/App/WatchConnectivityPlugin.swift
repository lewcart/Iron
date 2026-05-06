import Foundation
import Capacitor
import WatchConnectivity
import RebirthAppGroup
import RebirthModels
import RebirthWatchLog

/// Capacitor plugin that bridges JS → WatchConnectivity. Phone-side mirror of
/// the watch app.
///
/// Two write modes for outbound (phone → watch):
///   - `pushActiveWorkout(snapshot)` → WCSession.updateApplicationContext
///     (overwrite-only, latest-wins, reaches both reachable and unreachable
///     watches as soon as they wake)
///   - `pushSetMutation(mutation)` → WCSession.transferUserInfo (FIFO queue)
///
/// Inbound (watch → phone) `watchWroteSet`, `stopRest`, `extendRest` messages
/// are handled in TWO places:
///
///   1. `notifyListeners("watchInbound", …)` — the existing JS bridge.
///      `WatchInboundBridge.tsx` consumes and applies set updates to Dexie +
///      drives the rest-timer store. Only fires when JS is alive.
///
///   2. `processInboundNatively` — Swift code that reads the iPhone App
///      Group snapshot, applies the same mutation natively, writes back, and
///      pushes the updated snapshot to the watch via WCSession. This path
///      runs even when the iOS Rebirth app process is asleep / JS layer
///      isn't loaded — iOS wakes the WC delegate briefly on inbound
///      delivery. Without it, the watch ring would never appear when the
///      phone is in the user's pocket.
///
/// JS will eventually process the same message (when the app foregrounds)
/// via the existing notifyListeners path. The store's idempotency guard
/// (same setUuid + same completedAtMs → no-op) prevents double-apply.
///
/// The iPhone App Group snapshot is the canonical state for native
/// processing. JS calls `pushActiveWorkout` and the plugin persists to App
/// Group AND pushes to watch on the same call.
///
/// JS API (see `src/lib/watch.ts`):
///   WatchConnectivity.pushActiveWorkout({ snapshot }) — push + persist
///   WatchConnectivity.pushSetMutation({ mutation })   — outbound queue
///   WatchConnectivity.getWatchPaired()                — pairing state
///   WatchConnectivity.readAppGroupSnapshot()          — JS hydration
@objc(WatchConnectivityPlugin)
public class WatchConnectivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WatchConnectivityPlugin"
    public let jsName = "WatchConnectivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pushActiveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushSetMutation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getWatchPaired", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readAppGroupSnapshot", returnType: CAPPluginReturnPromise),
    ]

    private let coordinator = WCSessionCoordinator()

    public override func load() {
        coordinator.activate()
        // Bridge inbound watch messages → Capacitor event so JS can react.
        NotificationCenter.default.addObserver(
            forName: .watchInboundMessage,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let info = notification.userInfo else { return }
            self?.notifyListeners("watchInbound", data: [
                "kind": info["kind"] ?? "",
                "payload": info["payload"] ?? [:],
            ])
        }
    }

    @objc func pushActiveWorkout(_ call: CAPPluginCall) {
        guard let snapshot = call.getObject("snapshot") else {
            call.reject("missing snapshot")
            return
        }

        // Wrap as { schema_version, body } so the watch's RebirthAppGroup
        // .readSnapshot() can decode the same envelope.
        //
        // CRITICAL: WCSession.updateApplicationContext only accepts property-
        // list types (String/Number/Date/Data/Array/Dictionary/Bool). NSNull
        // (from JS `null` values) is NOT allowed and throws
        // "payload contains unsupported type". Capacitor's getObject preserves
        // JS nulls as NSNull, so we recursively strip NSNull keys before
        // passing to WC. Watch-side decoders use decodeIfPresent for all
        // optionals, so missing keys decode as nil correctly.
        let cleanedBody = (Self.stripNulls(snapshot) as? [String: Any]) ?? [:]
        let envelope: [String: Any] = [
            "schema_version": SchemaVersion.current,
            "body": cleanedBody,
        ]

        // Also persist the snapshot to iPhone App Group so native handlers
        // (e.g., processInboundNatively) can read it when JS isn't alive.
        // Best-effort — failures don't block the WC push.
        Self.persistSnapshotToAppGroup(cleanedBody)

        coordinator.pushApplicationContext(envelope) { result in
            switch result {
            case .success:
                call.resolve(["delivered": true])
            case .failure(let err):
                call.reject("WC application context push failed: \(err.localizedDescription)")
            }
        }
    }

    /// Recursively remove NSNull values so the result is property-list-safe
    /// for WCSession.updateApplicationContext + JSONSerialization.
    fileprivate static func stripNulls(_ value: Any) -> Any? {
        if value is NSNull { return nil }
        if let dict = value as? [String: Any] {
            var result: [String: Any] = [:]
            for (k, v) in dict {
                if let cleaned = stripNulls(v) { result[k] = cleaned }
            }
            return result
        }
        if let arr = value as? [Any] {
            return arr.compactMap { stripNulls($0) }
        }
        return value
    }

    /// Decode + persist a JS-encoded snapshot dict into iPhone App Group.
    /// Best-effort; failures are swallowed.
    fileprivate static func persistSnapshotToAppGroup(_ snapshotDict: [String: Any]) {
        do {
            let data = try JSONSerialization.data(withJSONObject: snapshotDict)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let snapshot = try decoder.decode(ActiveWorkoutSnapshot.self, from: data)
            try RebirthAppGroup().writeSnapshot(snapshot)
        } catch {
            // Silent — App Group persistence is best-effort decoration.
        }
    }

    @objc func pushSetMutation(_ call: CAPPluginCall) {
        guard let mutation = call.getObject("mutation") else {
            call.reject("missing mutation")
            return
        }
        coordinator.transferUserInfo(["kind": "setMutation", "payload": mutation]) { result in
            switch result {
            case .success:
                call.resolve(["queued": true])
            case .failure(let err):
                call.reject("WC transferUserInfo failed: \(err.localizedDescription)")
            }
        }
    }

    @objc func getWatchPaired(_ call: CAPPluginCall) {
        let info = coordinator.pairingInfo()
        call.resolve([
            "isPaired": info.isPaired,
            "isReachable": info.isReachable,
            "isWatchAppInstalled": info.isWatchAppInstalled,
        ])
    }

    /// Returns the iPhone App Group snapshot's `rest_timer` if present, plus
    /// a coarse `pushed_at_ms` so JS can decide which side is fresher. JS
    /// hydrates rest-timer state from this on init so a native-applied rest
    /// (started while JS was asleep) carries forward when the app
    /// foregrounds.
    @objc func readAppGroupSnapshot(_ call: CAPPluginCall) {
        guard let snapshot = (try? RebirthAppGroup().readSnapshot()) else {
            call.resolve(["present": false])
            return
        }
        var result: [String: Any] = [
            "present": true,
            "pushed_at_ms": snapshot.pushedAt.timeIntervalSince1970 * 1000.0,
        ]
        if let hint = snapshot.restTimer {
            var rt: [String: Any] = [
                "end_at_ms": hint.endAtMs,
                "duration_sec": hint.durationSec,
                "set_uuid": hint.setUuid,
            ]
            if let overtime = hint.overtimeStartMs {
                rt["overtime_start_ms"] = overtime
            }
            result["rest_timer"] = rt
        }
        call.resolve(result)
    }
}

// MARK: - Coordinator

private final class WCSessionCoordinator: NSObject, WCSessionDelegate {
    private var pendingSnapshot: [String: Any]?
    private var pendingTransfers: [(payload: [String: Any], completion: (Result<Void, Error>) -> Void)] = []
    private var activated = false
    private let lock = NSLock()

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    func pairingInfo() -> (isPaired: Bool, isReachable: Bool, isWatchAppInstalled: Bool) {
        guard WCSession.isSupported() else { return (false, false, false) }
        let session = WCSession.default
        return (session.isPaired, session.isReachable, session.isWatchAppInstalled)
    }

    func pushApplicationContext(_ context: [String: Any], completion: @escaping (Result<Void, Error>) -> Void) {
        lock.lock()
        if !activated {
            pendingSnapshot = context
            lock.unlock()
            completion(.success(()))   // optimistic — flushed on activation
            return
        }
        lock.unlock()
        do {
            try WCSession.default.updateApplicationContext(context)
            completion(.success(()))
        } catch {
            completion(.failure(error))
        }
    }

    func transferUserInfo(_ payload: [String: Any], completion: @escaping (Result<Void, Error>) -> Void) {
        lock.lock()
        if !activated {
            pendingTransfers.append((payload, completion))
            lock.unlock()
            return
        }
        lock.unlock()
        WCSession.default.transferUserInfo(payload)
        completion(.success(()))
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        lock.lock()
        activated = (activationState == .activated)
        let snapshot = pendingSnapshot
        let transfers = pendingTransfers
        pendingSnapshot = nil
        pendingTransfers.removeAll()
        lock.unlock()

        if activated {
            if let snapshot {
                try? WCSession.default.updateApplicationContext(snapshot)
            }
            for transfer in transfers {
                WCSession.default.transferUserInfo(transfer.payload)
                transfer.completion(.success(()))
            }
        } else {
            for transfer in transfers {
                transfer.completion(.failure(error ?? NSError(domain: "WatchConnectivityPlugin", code: -1)))
            }
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        // Re-activate to support multi-watch pairing changes.
        WCSession.default.activate()
    }

    /// Inbound: watch messages (set completion, stopRest, extendRest).
    /// Forwarded TWO ways:
    ///   1. NotificationCenter event consumed by JS bridge (existing)
    ///   2. Native processing via NativeInboundProcessor — applies the same
    ///      mutation to App Group + pushes back to watch, so the rest sheet
    ///      appears even when JS isn't alive.
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let kind = userInfo["kind"] as? String else { return }
        var payload = userInfo
        payload.removeValue(forKey: "kind")
        NotificationCenter.default.post(
            name: .watchInboundMessage,
            object: nil,
            userInfo: ["kind": kind, "payload": payload]
        )

        // Native processing — best-effort, idempotent against the eventual
        // JS handling via the rest-timer-state store's dedup window.
        NativeInboundProcessor.handle(kind: kind, userInfo: userInfo)
    }
}

// MARK: - Native inbound processor

/// Processes watch → phone messages natively (without JS) so the user sees
/// the rest sheet on their watch even when iPhone Rebirth is closed.
///
/// All three operations:
///   1. Read the iPhone App Group snapshot
///   2. Apply the mutation (set complete + rest_timer / null / extended)
///   3. Write back to App Group
///   4. Push the updated snapshot to the watch via WCSession
///
/// JS will eventually receive the same message via notifyListeners and apply
/// it to Dexie. The rest-timer-state store's idempotency guard prevents
/// double-applying.
private enum NativeInboundProcessor {
    static func handle(kind: String, userInfo: [String: Any]) {
        switch kind {
        case "watchWroteSet":
            handleWatchWroteSet(userInfo)
        case "stopRest":
            handleStopRest(userInfo)
        case "extendRest":
            handleExtendRest(userInfo)
        default:
            break
        }
    }

    private static func handleWatchWroteSet(_ payload: [String: Any]) {
        guard let row = payload["row"] as? [String: Any],
              let setUuid = row["uuid"] as? String,
              let isCompleted = row["is_completed"] as? Bool else { return }
        let now = Date()
        let nowMs = Int64(now.timeIntervalSince1970 * 1000)
        let completedAtMs = (payload["completed_at_ms"] as? Double).map { Int64($0) } ?? nowMs

        guard var snapshot = (try? RebirthAppGroup().readSnapshot()) else { return }

        // Mark the matching set as completed; if not found, ignore.
        var foundSet = false
        let newExercises = snapshot.exercises.map { ex -> ActiveExercise in
            let newSets = ex.sets.map { s -> WorkoutSet in
                guard s.uuid == setUuid else { return s }
                foundSet = true
                let weight = (row["weight"] as? Double) ?? s.targetWeight
                let reps = (row["repetitions"] as? Int) ?? s.targetReps
                let durationSeconds = (row["duration_seconds"] as? Int) ?? s.targetDurationSeconds
                let rir = row["rir"] as? Int ?? s.rir
                return WorkoutSet(
                    uuid: s.uuid,
                    workoutExerciseUUID: s.workoutExerciseUUID,
                    orderIndex: s.orderIndex,
                    isCompleted: isCompleted,
                    targetWeight: s.targetWeight,
                    targetReps: s.targetReps,
                    targetDurationSeconds: s.targetDurationSeconds,
                    actualWeight: weight,
                    actualReps: reps,
                    actualDurationSeconds: durationSeconds,
                    rir: rir,
                    minTargetReps: s.minTargetReps,
                    maxTargetReps: s.maxTargetReps,
                    rpe: s.rpe,
                    tag: s.tag,
                    comment: s.comment,
                    isPr: s.isPr,
                    excludedFromPb: s.excludedFromPb
                )
            }
            return ActiveExercise(
                routineExerciseUUID: ex.routineExerciseUUID,
                workoutExerciseUUID: ex.workoutExerciseUUID,
                name: ex.name,
                trackingMode: ex.trackingMode,
                repWindow: ex.repWindow,
                sets: newSets,
                history: ex.history
            )
        }
        guard foundSet else { return }

        // Compute rest_timer using snapshot.restTimerDefaultSeconds. Per-
        // exercise last-used isn't accessible to native code (it lives in
        // localStorage in the JS layer), so this is a graceful fallback —
        // strictly better than no rest timer at all when JS is asleep.
        let restSec = isCompleted ? snapshot.restTimerDefaultSeconds : 0
        let newRestTimer: RestTimerHint? = isCompleted
            ? RestTimerHint(
                endAtMs: completedAtMs + Int64(restSec * 1000),
                durationSec: restSec,
                overtimeStartMs: nil,
                setUuid: setUuid
            )
            : snapshot.restTimer

        snapshot = ActiveWorkoutSnapshot(
            workoutUUID: snapshot.workoutUUID,
            pushedAt: now,
            currentExerciseIndex: snapshot.currentExerciseIndex,
            exercises: newExercises,
            restTimerDefaultSeconds: snapshot.restTimerDefaultSeconds,
            hrvHint: snapshot.hrvHint,
            restTimer: newRestTimer
        )

        try? RebirthAppGroup().writeSnapshot(snapshot)
        pushSnapshotToWatch(snapshot)
    }

    private static func handleStopRest(_ payload: [String: Any]) {
        guard var snapshot = (try? RebirthAppGroup().readSnapshot()) else { return }
        guard snapshot.restTimer != nil else { return }
        snapshot = ActiveWorkoutSnapshot(
            workoutUUID: snapshot.workoutUUID,
            pushedAt: Date(),
            currentExerciseIndex: snapshot.currentExerciseIndex,
            exercises: snapshot.exercises,
            restTimerDefaultSeconds: snapshot.restTimerDefaultSeconds,
            hrvHint: snapshot.hrvHint,
            restTimer: nil
        )
        try? RebirthAppGroup().writeSnapshot(snapshot)
        pushSnapshotToWatch(snapshot)
    }

    private static func handleExtendRest(_ payload: [String: Any]) {
        guard var snapshot = (try? RebirthAppGroup().readSnapshot()) else { return }
        guard let oldHint = snapshot.restTimer else { return }
        let seconds = (payload["seconds"] as? Int) ?? 30
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        // Clamp to "now" when extending out of overtime so the new end-time
        // is genuinely seconds from this moment (mirrors JS store).
        let baseEnd = max(oldHint.endAtMs, nowMs)
        let newHint = RestTimerHint(
            endAtMs: baseEnd + Int64(seconds * 1000),
            durationSec: oldHint.durationSec,
            overtimeStartMs: nil,
            setUuid: oldHint.setUuid
        )
        snapshot = ActiveWorkoutSnapshot(
            workoutUUID: snapshot.workoutUUID,
            pushedAt: Date(),
            currentExerciseIndex: snapshot.currentExerciseIndex,
            exercises: snapshot.exercises,
            restTimerDefaultSeconds: snapshot.restTimerDefaultSeconds,
            hrvHint: snapshot.hrvHint,
            restTimer: newHint
        )
        try? RebirthAppGroup().writeSnapshot(snapshot)
        pushSnapshotToWatch(snapshot)
    }

    private static func pushSnapshotToWatch(_ snapshot: ActiveWorkoutSnapshot) {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(snapshot),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }
        let cleaned = (WatchConnectivityPlugin.stripNulls(dict) as? [String: Any]) ?? [:]
        let envelope: [String: Any] = [
            "schema_version": SchemaVersion.current,
            "body": cleaned,
        ]
        try? session.updateApplicationContext(envelope)
    }
}

extension Notification.Name {
    public static let watchInboundMessage = Notification.Name("app.rebirth.watch.inbound")
}
