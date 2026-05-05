import Foundation

public enum TrackingMode: String, Codable, Sendable {
    case reps
    case time
}

public struct RepWindow: Codable, Sendable, Equatable {
    public let goal: String
    public let minReps: Int
    public let maxReps: Int

    public init(goal: String, minReps: Int, maxReps: Int) {
        self.goal = goal
        self.minReps = minReps
        self.maxReps = maxReps
    }

    enum CodingKeys: String, CodingKey {
        case goal
        case minReps = "min_reps"
        case maxReps = "max_reps"
    }
}

public struct WorkoutSet: Codable, Sendable, Equatable {
    public let uuid: String
    public let workoutExerciseUUID: String?
    public let orderIndex: Int
    public let isCompleted: Bool
    public let targetWeight: Double?
    public let targetReps: Int?
    public let targetDurationSeconds: Int?
    public let actualWeight: Double?
    public let actualReps: Int?
    public let actualDurationSeconds: Int?
    public let rir: Int?
    /// Round-trip fields — the watch doesn't render these but echoes them in
    /// the CDC payload so /api/sync/push doesn't NULL out server columns the
    /// watch didn't touch.
    public let minTargetReps: Int?
    public let maxTargetReps: Int?
    public let rpe: Double?
    public let tag: String?
    public let comment: String?
    public let isPr: Bool
    public let excludedFromPb: Bool

    public init(
        uuid: String,
        workoutExerciseUUID: String? = nil,
        orderIndex: Int,
        isCompleted: Bool,
        targetWeight: Double? = nil,
        targetReps: Int? = nil,
        targetDurationSeconds: Int? = nil,
        actualWeight: Double? = nil,
        actualReps: Int? = nil,
        actualDurationSeconds: Int? = nil,
        rir: Int? = nil,
        minTargetReps: Int? = nil,
        maxTargetReps: Int? = nil,
        rpe: Double? = nil,
        tag: String? = nil,
        comment: String? = nil,
        isPr: Bool = false,
        excludedFromPb: Bool = false
    ) {
        self.uuid = uuid
        self.workoutExerciseUUID = workoutExerciseUUID
        self.orderIndex = orderIndex
        self.isCompleted = isCompleted
        self.targetWeight = targetWeight
        self.targetReps = targetReps
        self.targetDurationSeconds = targetDurationSeconds
        self.actualWeight = actualWeight
        self.actualReps = actualReps
        self.actualDurationSeconds = actualDurationSeconds
        self.rir = rir
        self.minTargetReps = minTargetReps
        self.maxTargetReps = maxTargetReps
        self.rpe = rpe
        self.tag = tag
        self.comment = comment
        self.isPr = isPr
        self.excludedFromPb = excludedFromPb
    }

    enum CodingKeys: String, CodingKey {
        case uuid
        case workoutExerciseUUID = "workout_exercise_uuid"
        case orderIndex = "order_index"
        case isCompleted = "is_completed"
        case targetWeight = "target_weight"
        case targetReps = "target_reps"
        case targetDurationSeconds = "target_duration_seconds"
        case actualWeight = "actual_weight"
        case actualReps = "actual_reps"
        case actualDurationSeconds = "actual_duration_seconds"
        case rir
        case minTargetReps = "min_target_reps"
        case maxTargetReps = "max_target_reps"
        case rpe
        case tag
        case comment
        case isPr = "is_pr"
        case excludedFromPb = "excluded_from_pb"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        uuid = try c.decode(String.self, forKey: .uuid)
        workoutExerciseUUID = try c.decodeIfPresent(String.self, forKey: .workoutExerciseUUID)
        orderIndex = try c.decode(Int.self, forKey: .orderIndex)
        isCompleted = try c.decode(Bool.self, forKey: .isCompleted)
        targetWeight = try c.decodeIfPresent(Double.self, forKey: .targetWeight)
        targetReps = try c.decodeIfPresent(Int.self, forKey: .targetReps)
        targetDurationSeconds = try c.decodeIfPresent(Int.self, forKey: .targetDurationSeconds)
        actualWeight = try c.decodeIfPresent(Double.self, forKey: .actualWeight)
        actualReps = try c.decodeIfPresent(Int.self, forKey: .actualReps)
        actualDurationSeconds = try c.decodeIfPresent(Int.self, forKey: .actualDurationSeconds)
        rir = try c.decodeIfPresent(Int.self, forKey: .rir)
        minTargetReps = try c.decodeIfPresent(Int.self, forKey: .minTargetReps)
        maxTargetReps = try c.decodeIfPresent(Int.self, forKey: .maxTargetReps)
        rpe = try c.decodeIfPresent(Double.self, forKey: .rpe)
        tag = try c.decodeIfPresent(String.self, forKey: .tag)
        comment = try c.decodeIfPresent(String.self, forKey: .comment)
        isPr = try c.decodeIfPresent(Bool.self, forKey: .isPr) ?? false
        excludedFromPb = try c.decodeIfPresent(Bool.self, forKey: .excludedFromPb) ?? false
    }
}

public struct ExerciseHistoryHint: Codable, Sendable, Equatable {
    public let lastSessionDate: String?
    public let sets: [WorkoutSet]

    public init(lastSessionDate: String?, sets: [WorkoutSet]) {
        self.lastSessionDate = lastSessionDate
        self.sets = sets
    }

    enum CodingKeys: String, CodingKey {
        case lastSessionDate = "last_session_date"
        case sets
    }
}

public struct ActiveExercise: Codable, Sendable, Equatable {
    public let routineExerciseUUID: String
    public let workoutExerciseUUID: String
    public let name: String
    public let trackingMode: TrackingMode
    public let repWindow: RepWindow?
    public let sets: [WorkoutSet]
    public let history: ExerciseHistoryHint?

    public init(
        routineExerciseUUID: String,
        workoutExerciseUUID: String,
        name: String,
        trackingMode: TrackingMode,
        repWindow: RepWindow?,
        sets: [WorkoutSet],
        history: ExerciseHistoryHint?
    ) {
        self.routineExerciseUUID = routineExerciseUUID
        self.workoutExerciseUUID = workoutExerciseUUID
        self.name = name
        self.trackingMode = trackingMode
        self.repWindow = repWindow
        self.sets = sets
        self.history = history
    }

    enum CodingKeys: String, CodingKey {
        case routineExerciseUUID = "routine_exercise_uuid"
        case workoutExerciseUUID = "workout_exercise_uuid"
        case name
        case trackingMode = "tracking_mode"
        case repWindow = "rep_window"
        case sets
        case history
    }
}

public struct HRVHint: Codable, Sendable, Equatable {
    public let currentMs: Double
    public let baselineMeanMs: Double
    public let baselineStdevMs: Double

    public init(currentMs: Double, baselineMeanMs: Double, baselineStdevMs: Double) {
        self.currentMs = currentMs
        self.baselineMeanMs = baselineMeanMs
        self.baselineStdevMs = baselineStdevMs
    }

    /// Returns deviation from baseline in standard deviations. Negative = below.
    public var sigma: Double {
        guard baselineStdevMs > 0 else { return 0 }
        return (currentMs - baselineMeanMs) / baselineStdevMs
    }

    enum CodingKeys: String, CodingKey {
        case currentMs = "current_ms"
        case baselineMeanMs = "baseline_mean_ms"
        case baselineStdevMs = "baseline_stdev_ms"
    }
}

/// Active rest timer projected from the phone-side store. The phone is the
/// single writer; the watch reads remaining time as `endAtMs - Date()`. The
/// `setUuid` anchors idempotency across duplicate WC delivery and acts as a
/// natural identity for the rest period that follows that set.
public struct RestTimerHint: Codable, Sendable, Equatable {
    /// Phone-authored absolute epoch millisecond at which the timer expires.
    /// Watch and phone compute remaining = endAtMs - now-epoch-ms locally;
    /// using a phone-authored absolute eliminates clock-skew arithmetic.
    public let endAtMs: Int64
    /// Original duration in seconds. Used by the watch ring to render
    /// progress (sweep = (endAtMs - now) / (durationSec * 1000)).
    public let durationSec: Int
    /// Phone stamps this when the timer crosses zero — watch uses it to
    /// switch ring colour and stop decrementing.
    public let overtimeStartMs: Int64?
    /// Anchors idempotency on duplicate WC delivery and identifies which
    /// set this rest follows.
    public let setUuid: String

    public init(endAtMs: Int64, durationSec: Int, overtimeStartMs: Int64? = nil, setUuid: String) {
        self.endAtMs = endAtMs
        self.durationSec = durationSec
        self.overtimeStartMs = overtimeStartMs
        self.setUuid = setUuid
    }

    enum CodingKeys: String, CodingKey {
        case endAtMs = "end_at_ms"
        case durationSec = "duration_sec"
        case overtimeStartMs = "overtime_start_ms"
        case setUuid = "set_uuid"
    }
}

public struct ActiveWorkoutSnapshot: Codable, Sendable, Equatable {
    public let workoutUUID: String
    public let pushedAt: Date
    public let currentExerciseIndex: Int
    public let exercises: [ActiveExercise]
    public let restTimerDefaultSeconds: Int
    public let hrvHint: HRVHint?
    public let restTimer: RestTimerHint?

    public init(
        workoutUUID: String,
        pushedAt: Date,
        currentExerciseIndex: Int,
        exercises: [ActiveExercise],
        restTimerDefaultSeconds: Int,
        hrvHint: HRVHint? = nil,
        restTimer: RestTimerHint? = nil
    ) {
        self.workoutUUID = workoutUUID
        self.pushedAt = pushedAt
        self.currentExerciseIndex = currentExerciseIndex
        self.exercises = exercises
        self.restTimerDefaultSeconds = restTimerDefaultSeconds
        self.hrvHint = hrvHint
        self.restTimer = restTimer
    }

    enum CodingKeys: String, CodingKey {
        case workoutUUID = "workout_uuid"
        case pushedAt = "pushed_at"
        case currentExerciseIndex = "current_exercise_index"
        case exercises
        case restTimerDefaultSeconds = "rest_timer_default_seconds"
        case hrvHint = "hrv_hint"
        case restTimer = "rest_timer"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workoutUUID = try c.decode(String.self, forKey: .workoutUUID)
        pushedAt = try c.decode(Date.self, forKey: .pushedAt)
        currentExerciseIndex = try c.decode(Int.self, forKey: .currentExerciseIndex)
        exercises = try c.decode([ActiveExercise].self, forKey: .exercises)
        restTimerDefaultSeconds = try c.decode(Int.self, forKey: .restTimerDefaultSeconds)
        hrvHint = try c.decodeIfPresent(HRVHint.self, forKey: .hrvHint)
        restTimer = try c.decodeIfPresent(RestTimerHint.self, forKey: .restTimer)
    }
}
