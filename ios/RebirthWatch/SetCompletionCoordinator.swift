import Foundation
import WatchConnectivity
import WatchKit
import RebirthAppGroup
import RebirthModels
import RebirthWatchLog

/// Coordinates the "approve set + RIR" flow on the watch.
///
/// Flow (post-Day-13 rework — watch is a remote control):
///   1. UI calls `completeSet(in:set:rir:)`
///   2. Optimistically update the App Group snapshot so the watch UI redraws
///      marked-complete immediately
///   3. Send the CDC row to the paired iPhone via WC.transferUserInfo
///      (kind="watchWroteSet"). The iPhone's WatchConnectivityPlugin emits a
///      JS event; WatchInboundBridge applies the row via mutations.updateSet,
///      and the existing phone sync engine pushes to Postgres.
///
/// No outbox, no direct API call, no API key on watch. WC.transferUserInfo
/// has its own delivery queue (persists across reachability), so unreachable-
/// phone scenarios are handled by the OS, not by us.
@MainActor
final class SetCompletionCoordinator: ObservableObject {
    @Published var pendingCount: Int = 0
    @Published var lastError: String?
    @Published var isAuthHalted: Bool = false
    /// Set when the most recent completeSet detected a local PB. UI reads
    /// this to render the "+Δkg PB" pill briefly. Cleared on next confirm.
    @Published var lastPBDeltaKg: Double?

    /// Per-set in-progress edits made via tap-to-dial. Cleared when the set
    /// is completed (or undone). Survives navigation between exercises but
    /// not app cold-launch (intentional — uncommitted edits are ephemeral).
    @Published var edits: [String: SetEdits] = [:]

    struct SetEdits: Equatable {
        var weight: Double?
        var reps: Int?
        var durationSeconds: Int?
    }

    private let appGroup = RebirthAppGroup()
    private let log = RebirthWatchLog.shared

    init() {
        // Watch routes all set-completion writes through the paired iPhone via
        // WatchConnectivity. The phone applies the change to its Dexie store
        // and the existing phone sync engine pushes to the server. This means
        // the phone is the single writer to Postgres, and the watch is a
        // remote control. Lou's case is "phone always present", so the
        // simpler model wins over the original direct-API hybrid.
        cancelStaleTransfers()
        refreshPendingCount()
    }

    /// Cancel any leftover outstandingUserInfoTransfers from previous builds.
    /// WC keeps queued transfers across app reinstalls, so a refactor that
    /// changed payload shape can leave undeliverable messages stuck forever.
    /// Lou should see pendingCount drop to 0 immediately after this runs.
    func cancelStaleTransfers() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        let stale = session.outstandingUserInfoTransfers
        for transfer in stale {
            transfer.cancel()
        }
        if !stale.isEmpty {
            log.info("Cancelled \(stale.count) stale WC transfers from previous build")
        }
    }

    // NWPathMonitor removed — WC.transferUserInfo handles its own retry +
    // queueing across reachability transitions. Nothing for us to flush.

    func refreshPendingCount() {
        // No watch-side outbox under WC-routed model — WC.transferUserInfo
        // owns its own delivery queue (persists across reachability).
        pendingCount = WCSession.default.outstandingUserInfoTransfers.count
    }

    func setEditWeight(setUUID: String, weight: Double) {
        var current = edits[setUUID] ?? SetEdits()
        current.weight = weight
        edits[setUUID] = current
    }

    func setEditReps(setUUID: String, reps: Int) {
        var current = edits[setUUID] ?? SetEdits()
        current.reps = reps
        edits[setUUID] = current
    }

    func setEditDuration(setUUID: String, durationSeconds: Int) {
        var current = edits[setUUID] ?? SetEdits()
        current.durationSeconds = durationSeconds
        edits[setUUID] = current
    }

    func clearEdits(setUUID: String) {
        edits.removeValue(forKey: setUUID)
    }

    /// Mark a set complete with the given RIR. RIR may be nil (user dismissed
    /// the picker without confirming). Pulls in any in-progress edits the
    /// user dialed in via tap-to-dial.
    func completeSet(
        in exercise: ActiveExercise,
        set: WorkoutSet,
        rir: Int?
    ) async {
        let edit = edits[set.uuid]
        let row = WorkoutSetCDCRow.fromCompletion(
            snapshotSet: set,
            workoutExerciseUUID: exercise.workoutExerciseUUID,
            editedWeight: edit?.weight,
            editedRepetitions: edit?.reps,
            editedDurationSeconds: edit?.durationSeconds,
            editedRir: rir
        )
        clearEdits(setUUID: set.uuid)

        // PB detection — fire haptic immediately on confirm for a direct
        // emotional cue. Server-side PR recompute may flip is_pr later;
        // this is the optimistic, local-cache-only check.
        let (isPB, deltaKg) = PBDetector.detect(
            candidate: set,
            completedWeight: edit?.weight ?? set.targetWeight,
            completedReps: edit?.reps ?? set.targetReps,
            history: exercise.history
        )
        if isPB {
            WKInterfaceDevice.current().play(.success)
            lastPBDeltaKg = deltaKg
            // Auto-clear the pill after 4s.
            Task {
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                await MainActor.run { self.lastPBDeltaKg = nil }
            }
        } else {
            lastPBDeltaKg = nil
        }

        // 1. Optimistic snapshot update — watch UI flips to "complete" instantly
        applyOptimistic(setUUID: set.uuid, rir: rir, editedWeight: edit?.weight, editedReps: edit?.reps, editedDurationSeconds: edit?.durationSeconds)

        // 2. Send the CDC row to the paired iPhone via WC.transferUserInfo.
        //    The iPhone applies it via Dexie mutations.updateSet and pushes
        //    to Postgres via the existing sync engine.
        sendRowToPhone(row)
    }

    /// No-op kept for UI compat — re-auth banner still binds to this.
    func clearAuthHalt() {
        isAuthHalted = false
        lastError = nil
    }

    private func sendRowToPhone(_ row: WorkoutSetCDCRow) {
        guard WCSession.isSupported() else {
            lastError = "WC unavailable"
            return
        }
        let session = WCSession.default
        guard session.activationState == .activated else {
            lastError = "WC not activated"
            return
        }
        // Encode row → JSON → dictionary so transferUserInfo accepts it
        // (property-list types only; NSNull would throw).
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        do {
            let data = try encoder.encode(row)
            guard let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                lastError = "encode shape error"
                return
            }
            let cleaned = stripNulls(dict)
            // completed_at_ms anchors the queued-stale guard on the phone
            // bridge — if the watch is out of range, this transfer queues
            // and may deliver minutes later. Phone skips rest auto-start
            // when (now - completed_at_ms) > 30s.
            let completedAtMs = Date().timeIntervalSince1970 * 1000.0
            session.transferUserInfo([
                "kind": "watchWroteSet",
                "row": cleaned,
                "completed_at_ms": completedAtMs,
            ])
            refreshPendingCount()
            log.info("Sent setCompletion via WC: \(row.uuid)")
        } catch {
            log.error("Failed to encode/send set completion: \(error)")
            lastError = "send failed"
        }
    }

    // MARK: - Rest-timer remote control (separate user gestures)

    /// Skip / Done — phone applies, snapshot pushes back with rest_timer = nil,
    /// watch sheet auto-dismisses.
    func sendStopRest(setUuid: String) {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        session.transferUserInfo([
            "kind": "stopRest",
            "set_uuid": setUuid,
        ])
        WKInterfaceDevice.current().play(.stop)
        log.info("Sent stopRest via WC: \(setUuid)")
        refreshPendingCount()
    }

    /// +30s — phone bumps end_at_ms, snapshot pushes back, watch ring redraws.
    func sendExtendRest(seconds: Int, setUuid: String) {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        session.transferUserInfo([
            "kind": "extendRest",
            "seconds": seconds,
            "set_uuid": setUuid,
        ])
        WKInterfaceDevice.current().play(.start)
        log.info("Sent extendRest via WC: +\(seconds)s for \(setUuid)")
        refreshPendingCount()
    }

    /// Recursively drop NSNull values so the result is property-list-safe for
    /// WCSession.transferUserInfo. Mirrors the iOS plugin's stripNulls.
    private func stripNulls(_ value: Any) -> Any {
        if value is NSNull { return [String: Any]() }   // unreachable at top-level
        if let dict = value as? [String: Any] {
            var result: [String: Any] = [:]
            for (k, v) in dict {
                if v is NSNull { continue }
                result[k] = stripNulls(v)
            }
            return result
        }
        if let arr = value as? [Any] {
            return arr.compactMap { v -> Any? in v is NSNull ? nil : stripNulls(v) }
        }
        return value
    }

    private func applyOptimistic(
        setUUID: String,
        rir: Int?,
        editedWeight: Double?,
        editedReps: Int?,
        editedDurationSeconds: Int?
    ) {
        guard var current = (try? appGroup.readSnapshot()) else { return }
        var newExercises: [ActiveExercise] = []
        for ex in current.exercises {
            var newSets: [WorkoutSet] = []
            for s in ex.sets {
                if s.uuid == setUUID {
                    let actualWeight = editedWeight ?? s.targetWeight
                    let actualReps = editedReps ?? s.targetReps
                    let actualDuration = editedDurationSeconds ?? s.targetDurationSeconds
                    newSets.append(WorkoutSet(
                        uuid: s.uuid,
                        workoutExerciseUUID: s.workoutExerciseUUID,
                        orderIndex: s.orderIndex,
                        isCompleted: true,
                        targetWeight: editedWeight ?? s.targetWeight,
                        targetReps: editedReps ?? s.targetReps,
                        targetDurationSeconds: editedDurationSeconds ?? s.targetDurationSeconds,
                        actualWeight: actualWeight,
                        actualReps: actualReps,
                        actualDurationSeconds: actualDuration,
                        rir: rir,
                        minTargetReps: s.minTargetReps,
                        maxTargetReps: s.maxTargetReps,
                        rpe: s.rpe,
                        tag: s.tag,
                        comment: s.comment,
                        isPr: s.isPr,
                        excludedFromPb: s.excludedFromPb
                    ))
                } else {
                    newSets.append(s)
                }
            }
            newExercises.append(ActiveExercise(
                routineExerciseUUID: ex.routineExerciseUUID,
                workoutExerciseUUID: ex.workoutExerciseUUID,
                name: ex.name,
                trackingMode: ex.trackingMode,
                repWindow: ex.repWindow,
                sets: newSets,
                history: ex.history
            ))
        }
        current = ActiveWorkoutSnapshot(
            workoutUUID: current.workoutUUID,
            pushedAt: Date(),
            currentExerciseIndex: current.currentExerciseIndex,
            exercises: newExercises,
            restTimerDefaultSeconds: current.restTimerDefaultSeconds,
            hrvHint: current.hrvHint,
            restTimer: current.restTimer
        )
        try? appGroup.writeSnapshot(current)
    }
}

