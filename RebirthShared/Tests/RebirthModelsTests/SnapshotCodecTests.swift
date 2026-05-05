import Foundation
import Testing
@testable import RebirthModels

@Suite("Snapshot codec")
struct SnapshotCodecTests {

    @Test("Round-trips an empty workout")
    func emptyWorkoutRoundTrip() throws {
        let snapshot = ActiveWorkoutSnapshot(
            workoutUUID: "00000000-0000-0000-0000-000000000001",
            pushedAt: Date(timeIntervalSince1970: 1_700_000_000),
            currentExerciseIndex: 0,
            exercises: [],
            restTimerDefaultSeconds: 90
        )
        let payload = VersionedPayload(snapshot)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(payload)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(VersionedPayload<ActiveWorkoutSnapshot>.self, from: data)
        #expect(decoded.body == snapshot)
        #expect(decoded.schemaVersion == SchemaVersion.current)
    }

    @Test("Worst-case snapshot fits under 50KB")
    func worstCaseSize() throws {
        // 10 exercises × 6 sets each + history hint with 6 sets each.
        let sets: [WorkoutSet] = (0..<6).map { i in
            WorkoutSet(
                uuid: "set-\(i)-\(UUID().uuidString)",
                orderIndex: i,
                isCompleted: false,
                targetWeight: 100.0,
                targetReps: 10
            )
        }
        let history = ExerciseHistoryHint(lastSessionDate: "2026-05-01", sets: sets)
        let exercises: [ActiveExercise] = (0..<10).map { i in
            ActiveExercise(
                routineExerciseUUID: "rex-\(i)-\(UUID().uuidString)",
                workoutExerciseUUID: "wex-\(i)-\(UUID().uuidString)",
                name: "Exercise With A Reasonably Long Name \(i)",
                trackingMode: .reps,
                repWindow: RepWindow(goal: "build", minReps: 8, maxReps: 12),
                sets: sets,
                history: history
            )
        }
        let snapshot = ActiveWorkoutSnapshot(
            workoutUUID: UUID().uuidString,
            pushedAt: Date(),
            currentExerciseIndex: 0,
            exercises: exercises,
            restTimerDefaultSeconds: 90
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(VersionedPayload(snapshot))
        #expect(data.count < 50_000, "Worst-case snapshot was \(data.count) bytes, should be <50_000")
    }

    @Test("Decoder accepts a v2 snapshot with extra unknown fields")
    func forwardCompatV2() throws {
        // Synthetic v2 — extra `body.future_field` key.
        let json = """
        {
            "schema_version": 2,
            "body": {
                "workout_uuid": "abc",
                "pushed_at": "2026-05-04T12:00:00Z",
                "current_exercise_index": 0,
                "exercises": [],
                "rest_timer_default_seconds": 90,
                "future_field": { "anything": [1,2,3] }
            }
        }
        """.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        // Future-field tolerance: should not throw; unknown keys are ignored by Codable by default.
        let decoded = try decoder.decode(VersionedPayload<ActiveWorkoutSnapshot>.self, from: json)
        #expect(decoded.schemaVersion == 2)
        #expect(decoded.body.exercises.isEmpty)
    }

    @Test("Decoder back-compat: snapshot without rest_timer field decodes with restTimer = nil")
    func restTimerBackCompat() throws {
        // A pre-rest_timer phone (or a phone with no active rest) emits a body
        // that lacks the rest_timer key entirely. Watch must accept this.
        let json = """
        {
            "schema_version": 1,
            "body": {
                "workout_uuid": "w1",
                "pushed_at": "2026-05-05T08:00:00Z",
                "current_exercise_index": 0,
                "exercises": [],
                "rest_timer_default_seconds": 90
            }
        }
        """.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(VersionedPayload<ActiveWorkoutSnapshot>.self, from: json)
        #expect(decoded.body.restTimer == nil)
    }

    @Test("Decoder accepts rest_timer with overtime_start_ms")
    func restTimerWithOvertime() throws {
        let json = """
        {
            "schema_version": 1,
            "body": {
                "workout_uuid": "w1",
                "pushed_at": "2026-05-05T08:00:00Z",
                "current_exercise_index": 0,
                "exercises": [],
                "rest_timer_default_seconds": 90,
                "rest_timer": {
                    "end_at_ms": 1714896000000,
                    "duration_sec": 90,
                    "overtime_start_ms": 1714896090000,
                    "set_uuid": "set-abc"
                }
            }
        }
        """.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(VersionedPayload<ActiveWorkoutSnapshot>.self, from: json)
        let hint = try #require(decoded.body.restTimer)
        #expect(hint.endAtMs == 1714896000000)
        #expect(hint.durationSec == 90)
        #expect(hint.overtimeStartMs == 1714896090000)
        #expect(hint.setUuid == "set-abc")
    }

    @Test("Round-trips a snapshot with active rest timer (no overtime)")
    func restTimerRoundTrip() throws {
        let snapshot = ActiveWorkoutSnapshot(
            workoutUUID: "w1",
            pushedAt: Date(timeIntervalSince1970: 1_700_000_000),
            currentExerciseIndex: 0,
            exercises: [],
            restTimerDefaultSeconds: 90,
            restTimer: RestTimerHint(endAtMs: 1_700_000_090_000, durationSec: 90, setUuid: "set-1")
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(VersionedPayload(snapshot))
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(VersionedPayload<ActiveWorkoutSnapshot>.self, from: data)
        #expect(decoded.body == snapshot)
        #expect(decoded.body.restTimer?.overtimeStartMs == nil)
    }
}
