import Foundation

/// CDC row for `/api/sync/push` — a single `workout_sets` mutation.
/// Mirrors the row shape the phone Dexie sync produces. Server stamps `updated_at`.
public struct WorkoutSetCDCRow: Codable, Sendable, Equatable {
    public let mutationId: String
    public let setUUID: String
    public let workoutExerciseUUID: String
    public let weight: Double?
    public let repetitions: Int?
    public let durationSeconds: Int?
    public let rir: Int?
    public let isCompleted: Bool
    public let clientUpdatedAt: Date

    public init(
        mutationId: String = UUID().uuidString,
        setUUID: String,
        workoutExerciseUUID: String,
        weight: Double?,
        repetitions: Int?,
        durationSeconds: Int?,
        rir: Int?,
        isCompleted: Bool,
        clientUpdatedAt: Date = Date()
    ) {
        self.mutationId = mutationId
        self.setUUID = setUUID
        self.workoutExerciseUUID = workoutExerciseUUID
        self.weight = weight
        self.repetitions = repetitions
        self.durationSeconds = durationSeconds
        self.rir = rir
        self.isCompleted = isCompleted
        self.clientUpdatedAt = clientUpdatedAt
    }

    enum CodingKeys: String, CodingKey {
        case mutationId = "mutation_id"
        case setUUID = "set_uuid"
        case workoutExerciseUUID = "workout_exercise_uuid"
        case weight
        case repetitions
        case durationSeconds = "duration_seconds"
        case rir
        case isCompleted = "is_completed"
        case clientUpdatedAt = "client_updated_at"
    }
}
