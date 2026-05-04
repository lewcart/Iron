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

public struct ActiveWorkoutSnapshot: Codable, Sendable, Equatable {
    public let workoutUUID: String
    public let pushedAt: Date
    public let currentExerciseIndex: Int
    public let exercises: [ActiveExercise]
    public let restTimerDefaultSeconds: Int

    public init(
        workoutUUID: String,
        pushedAt: Date,
        currentExerciseIndex: Int,
        exercises: [ActiveExercise],
        restTimerDefaultSeconds: Int
    ) {
        self.workoutUUID = workoutUUID
        self.pushedAt = pushedAt
        self.currentExerciseIndex = currentExerciseIndex
        self.exercises = exercises
        self.restTimerDefaultSeconds = restTimerDefaultSeconds
    }

    enum CodingKeys: String, CodingKey {
        case workoutUUID = "workout_uuid"
        case pushedAt = "pushed_at"
        case currentExerciseIndex = "current_exercise_index"
        case exercises
        case restTimerDefaultSeconds = "rest_timer_default_seconds"
    }
}
