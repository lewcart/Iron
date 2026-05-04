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
    public let orderIndex: Int
    public let isCompleted: Bool
    public let targetWeight: Double?
    public let targetReps: Int?
    public let targetDurationSeconds: Int?
    public let actualWeight: Double?
    public let actualReps: Int?
    public let actualDurationSeconds: Int?
    public let rir: Int?

    public init(
        uuid: String,
        orderIndex: Int,
        isCompleted: Bool,
        targetWeight: Double? = nil,
        targetReps: Int? = nil,
        targetDurationSeconds: Int? = nil,
        actualWeight: Double? = nil,
        actualReps: Int? = nil,
        actualDurationSeconds: Int? = nil,
        rir: Int? = nil
    ) {
        self.uuid = uuid
        self.orderIndex = orderIndex
        self.isCompleted = isCompleted
        self.targetWeight = targetWeight
        self.targetReps = targetReps
        self.targetDurationSeconds = targetDurationSeconds
        self.actualWeight = actualWeight
        self.actualReps = actualReps
        self.actualDurationSeconds = actualDurationSeconds
        self.rir = rir
    }

    enum CodingKeys: String, CodingKey {
        case uuid
        case orderIndex = "order_index"
        case isCompleted = "is_completed"
        case targetWeight = "target_weight"
        case targetReps = "target_reps"
        case targetDurationSeconds = "target_duration_seconds"
        case actualWeight = "actual_weight"
        case actualReps = "actual_reps"
        case actualDurationSeconds = "actual_duration_seconds"
        case rir
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
