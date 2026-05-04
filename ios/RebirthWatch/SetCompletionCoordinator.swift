import Foundation
import Network
import RebirthAppGroup
import RebirthAPI
import RebirthModels
import RebirthOutbox
import RebirthWatchLog

/// Coordinates the "approve set + RIR" flow on the watch.
///
/// Flow:
///   1. UI calls `completeSet(in:set:rir:)`
///   2. Build a `WorkoutSetCDCRow` from the snapshot's row + edits
///   3. Optimistically update the App Group snapshot so UI redraws marked-complete
///   4. Enqueue in outbox (always — single source of truth)
///   5. Try POST `/api/sync/push` immediately; on 200, drop from outbox
///      On 4xx, log + drop (validation error — won't succeed on retry)
///      On 401, halt outbox (key bad — Day 4 wires the banner)
///      On 5xx/network, leave queued for next reachability change
@MainActor
final class SetCompletionCoordinator: ObservableObject {
    /// Drop a non-completion (edit-only) mutation after this many failed
    /// attempts. Completion mutations (is_completed=true) retry indefinitely
    /// — that's the data the user explicitly captured.
    private static let maxAttemptsForNonCompletion = 3

    @Published var pendingCount: Int = 0
    @Published var lastError: String?
    @Published var isAuthHalted: Bool = false

    private let appGroup = RebirthAppGroup()
    private let log = RebirthWatchLog.shared
    private let outbox: RebirthOutbox?
    private let api: RebirthAPIClient
    private let pathMonitor = NWPathMonitor()
    private var monitorStarted = false

    init(baseURL: URL = URL(string: "https://rebirth.app")!) {
        self.api = RebirthAPIClient(baseURL: baseURL)
        do {
            self.outbox = try RebirthOutbox(appGroup: appGroup)
        } catch {
            self.outbox = nil
            log.error("Outbox init failed: \(error)")
        }
        refreshPendingCount()
        startPathMonitor()
    }

    /// Auto-flush outbox when network reachability flips to satisfied.
    private func startPathMonitor() {
        guard !monitorStarted else { return }
        monitorStarted = true
        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in
                guard let self else { return }
                if !self.isAuthHalted {
                    await self.flush()
                }
            }
        }
        pathMonitor.start(queue: .global(qos: .utility))
    }

    func refreshPendingCount() {
        guard let outbox else { return }
        do {
            pendingCount = try outbox.count()
        } catch {
            log.error("Outbox count failed: \(error)")
        }
    }

    /// Mark a set complete with the given RIR. RIR may be nil (user dismissed
    /// the picker without confirming).
    func completeSet(
        in exercise: ActiveExercise,
        set: WorkoutSet,
        rir: Int?
    ) async {
        let row = WorkoutSetCDCRow.fromCompletion(
            snapshotSet: set,
            workoutExerciseUUID: exercise.workoutExerciseUUID,
            editedWeight: nil,            // Day 5 wires inline weight/rep dial
            editedRepetitions: nil,
            editedDurationSeconds: nil,
            editedRir: rir
        )

        // 1. Optimistic snapshot update
        applyOptimistic(setUUID: set.uuid, rir: rir)

        // 2. Enqueue
        let payload: Data
        do {
            let envelope = SyncPushPayload(rows: [row])
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            payload = try encoder.encode(envelope)
        } catch {
            log.error("Failed to encode CDC row: \(error)")
            lastError = "encode failed"
            return
        }
        do {
            try outbox?.enqueue(mutationId: row.mutationId, endpoint: "/api/sync/push", body: payload)
            refreshPendingCount()
        } catch {
            log.error("Outbox enqueue failed: \(error)")
            lastError = "outbox full?"
            return
        }

        // 3. Best-effort immediate flush
        await flush()
    }

    /// Drains outbox. Stops on first 401 (auth halted). Removes 200 + 4xx rows.
    /// 5xx/network errors are retried, with non-completion mutations dropping
    /// after `maxAttemptsForNonCompletion`.
    func flush() async {
        guard let outbox else { return }
        if isAuthHalted { return }
        let pending: [PendingMutation]
        do {
            pending = try outbox.pending(limit: 50)
        } catch {
            log.error("Outbox read failed: \(error)")
            return
        }
        for mutation in pending {
            do {
                try await api.rawPost(path: mutation.endpoint, body: mutation.bodyJSON)
                try? outbox.remove(mutationId: mutation.mutationId)
            } catch APIError.unauthorized {
                log.error("Outbox flush halted on 401")
                lastError = "Re-auth from phone"
                isAuthHalted = true
                break
            } catch APIError.clientError(let code, let body) {
                log.error("Outbox dropping \(mutation.mutationId) on \(code): \(body)")
                try? outbox.remove(mutationId: mutation.mutationId)
                lastError = "Server rejected: \(code)"
            } catch {
                let errStr = String(describing: error)
                try? outbox.recordAttempt(mutationId: mutation.mutationId, error: errStr)
                if !isCompletionMutation(mutation) && mutation.attemptCount + 1 >= Self.maxAttemptsForNonCompletion {
                    log.error("Outbox dead-lettering \(mutation.mutationId) after \(mutation.attemptCount + 1) attempts: \(errStr)")
                    try? outbox.remove(mutationId: mutation.mutationId)
                }
                // Otherwise leave queued for next reachability change.
            }
        }
        refreshPendingCount()
    }

    /// Heuristic: a mutation that contains `"is_completed":true` somewhere in
    /// its body is treated as a completion (retried forever). Edit-only
    /// mutations (weight/rep dial without is_completed change) drop after
    /// `maxAttemptsForNonCompletion`. Cheap string check — no need to decode.
    private func isCompletionMutation(_ mutation: PendingMutation) -> Bool {
        guard let body = String(data: mutation.bodyJSON, encoding: .utf8) else { return false }
        return body.contains("\"is_completed\":true")
    }

    /// Manually clear the auth-halted state. Called after Lou re-pastes the
    /// API key (Day 4 wires the banner action; Day 3 leaves this method
    /// callable from anywhere a recovery flow is needed).
    func clearAuthHalt() {
        isAuthHalted = false
        lastError = nil
    }

    private func applyOptimistic(setUUID: String, rir: Int?) {
        guard var current = (try? appGroup.readSnapshot()) else { return }
        var newExercises: [ActiveExercise] = []
        for ex in current.exercises {
            var newSets: [WorkoutSet] = []
            for s in ex.sets {
                if s.uuid == setUUID {
                    newSets.append(WorkoutSet(
                        uuid: s.uuid,
                        workoutExerciseUUID: s.workoutExerciseUUID,
                        orderIndex: s.orderIndex,
                        isCompleted: true,
                        targetWeight: s.targetWeight,
                        targetReps: s.targetReps,
                        targetDurationSeconds: s.targetDurationSeconds,
                        actualWeight: s.targetWeight,
                        actualReps: s.targetReps,
                        actualDurationSeconds: s.targetDurationSeconds,
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
            restTimerDefaultSeconds: current.restTimerDefaultSeconds
        )
        try? appGroup.writeSnapshot(current)
    }
}

// MARK: - Encoding helpers

private struct SyncPushPayload: Encodable {
    let workout_sets: [WorkoutSetCDCRow]

    init(rows: [WorkoutSetCDCRow]) {
        self.workout_sets = rows
    }
}
