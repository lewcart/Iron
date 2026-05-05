import Foundation

/// CDC row matching the shape `/api/sync/push` expects under
/// `body.workout_sets[]`. Mirrors the SQL upsert column list in
/// `src/app/api/sync/push/route.ts:pushWorkoutSet`. Server stamps
/// `updated_at`; client must echo every column that exists on the row, NOT
/// just the ones it edited — the upsert is full-row, not patch-style, so
/// any column the client omits gets overwritten with NULL.
public struct WorkoutSetCDCRow: Codable, Sendable, Equatable {
    public let uuid: String
    public let workoutExerciseUUID: String
    public let weight: Double?
    public let repetitions: Int?
    public let minTargetReps: Int?
    public let maxTargetReps: Int?
    public let rpe: Double?
    public let rir: Int?
    public let tag: String?
    public let comment: String?
    public let isCompleted: Bool
    public let isPr: Bool
    public let excludedFromPb: Bool
    public let orderIndex: Int
    public let durationSeconds: Int?

    /// Client-generated. Used by the outbox for idempotency. Sent in the
    /// payload but the route doesn't read it; server-side dedup happens via
    /// the table's UPSERT on `uuid`.
    public let mutationId: String

    public init(
        uuid: String,
        workoutExerciseUUID: String,
        weight: Double?,
        repetitions: Int?,
        minTargetReps: Int?,
        maxTargetReps: Int?,
        rpe: Double?,
        rir: Int?,
        tag: String?,
        comment: String?,
        isCompleted: Bool,
        isPr: Bool,
        excludedFromPb: Bool,
        orderIndex: Int,
        durationSeconds: Int?,
        mutationId: String = UUID().uuidString
    ) {
        self.uuid = uuid
        self.workoutExerciseUUID = workoutExerciseUUID
        self.weight = weight
        self.repetitions = repetitions
        self.minTargetReps = minTargetReps
        self.maxTargetReps = maxTargetReps
        self.rpe = rpe
        self.rir = rir
        self.tag = tag
        self.comment = comment
        self.isCompleted = isCompleted
        self.isPr = isPr
        self.excludedFromPb = excludedFromPb
        self.orderIndex = orderIndex
        self.durationSeconds = durationSeconds
        self.mutationId = mutationId
    }

    /// Build a CDC row from a snapshot WorkoutSet, applying user-edited
    /// completion fields (weight, reps/duration, rir). Preserves all other
    /// columns from the snapshot so the server upsert doesn't NULL them.
    public static func fromCompletion(
        snapshotSet: WorkoutSet,
        workoutExerciseUUID: String,
        editedWeight: Double?,
        editedRepetitions: Int?,
        editedDurationSeconds: Int?,
        editedRir: Int?
    ) -> WorkoutSetCDCRow {
        WorkoutSetCDCRow(
            uuid: snapshotSet.uuid,
            workoutExerciseUUID: workoutExerciseUUID,
            weight: editedWeight ?? snapshotSet.targetWeight,
            repetitions: editedRepetitions ?? snapshotSet.targetReps,
            minTargetReps: snapshotSet.minTargetReps,
            maxTargetReps: snapshotSet.maxTargetReps,
            rpe: snapshotSet.rpe,
            rir: editedRir,
            tag: snapshotSet.tag,
            comment: snapshotSet.comment,
            isCompleted: true,
            isPr: snapshotSet.isPr,
            excludedFromPb: snapshotSet.excludedFromPb,
            orderIndex: snapshotSet.orderIndex,
            durationSeconds: editedDurationSeconds ?? snapshotSet.targetDurationSeconds
        )
    }

    enum CodingKeys: String, CodingKey {
        case uuid
        case workoutExerciseUUID = "workout_exercise_uuid"
        case weight
        case repetitions
        case minTargetReps = "min_target_reps"
        case maxTargetReps = "max_target_reps"
        case rpe
        case rir
        case tag
        case comment
        case isCompleted = "is_completed"
        case isPr = "is_pr"
        case excludedFromPb = "excluded_from_pb"
        case orderIndex = "order_index"
        case durationSeconds = "duration_seconds"
        case mutationId = "mutation_id"
    }
}
