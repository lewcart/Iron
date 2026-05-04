#if WATCH_MOCK_SNAPSHOT
import Foundation
import RebirthModels

/// Compile-time fixtures for fast iteration on the watch UI without going
/// through paired sim → phone → WC. Built only when WATCH_MOCK_SNAPSHOT is
/// set in the watch target's Other Swift Flags.
enum MockSnapshot {
    static let midStrengthSession: ActiveWorkoutSnapshot = ActiveWorkoutSnapshot(
        workoutUUID: "mock-workout-uuid",
        pushedAt: Date(),
        currentExerciseIndex: 0,
        exercises: [
            ActiveExercise(
                routineExerciseUUID: "mock-rex-1",
                workoutExerciseUUID: "mock-wex-1",
                name: "Romanian Deadlift",
                trackingMode: .reps,
                repWindow: RepWindow(goal: "build", minReps: 8, maxReps: 12),
                sets: [
                    WorkoutSet(uuid: "s1", workoutExerciseUUID: "mock-wex-1", orderIndex: 0, isCompleted: true,  targetWeight: 100, targetReps: 10, actualWeight: 100, actualReps: 11, rir: 2, minTargetReps: 8, maxTargetReps: 12),
                    WorkoutSet(uuid: "s2", workoutExerciseUUID: "mock-wex-1", orderIndex: 1, isCompleted: true,  targetWeight: 100, targetReps: 10, actualWeight: 100, actualReps: 10, rir: 2, minTargetReps: 8, maxTargetReps: 12),
                    WorkoutSet(uuid: "s3", workoutExerciseUUID: "mock-wex-1", orderIndex: 2, isCompleted: false, targetWeight: 100, targetReps: 10, minTargetReps: 8, maxTargetReps: 12),
                    WorkoutSet(uuid: "s4", workoutExerciseUUID: "mock-wex-1", orderIndex: 3, isCompleted: false, targetWeight: 100, targetReps: 10, minTargetReps: 8, maxTargetReps: 12),
                ],
                history: ExerciseHistoryHint(
                    lastSessionDate: "2026-04-30",
                    sets: [
                        WorkoutSet(uuid: "h1", orderIndex: 0, isCompleted: true, targetWeight: 95, targetReps: 10, actualWeight: 95, actualReps: 11, rir: 2, minTargetReps: 8, maxTargetReps: 12),
                    ]
                )
            ),
            ActiveExercise(
                routineExerciseUUID: "mock-rex-2",
                workoutExerciseUUID: "mock-wex-2",
                name: "Bulgarian Split Squat",
                trackingMode: .reps,
                repWindow: RepWindow(goal: "build", minReps: 8, maxReps: 12),
                sets: [
                    WorkoutSet(uuid: "s5", workoutExerciseUUID: "mock-wex-2", orderIndex: 0, isCompleted: false, targetWeight: 22.5, targetReps: 10, minTargetReps: 8, maxTargetReps: 12),
                    WorkoutSet(uuid: "s6", workoutExerciseUUID: "mock-wex-2", orderIndex: 1, isCompleted: false, targetWeight: 22.5, targetReps: 10, minTargetReps: 8, maxTargetReps: 12),
                    WorkoutSet(uuid: "s7", workoutExerciseUUID: "mock-wex-2", orderIndex: 2, isCompleted: false, targetWeight: 22.5, targetReps: 10, minTargetReps: 8, maxTargetReps: 12),
                ],
                history: nil
            ),
            ActiveExercise(
                routineExerciseUUID: "mock-rex-3",
                workoutExerciseUUID: "mock-wex-3",
                name: "Plank",
                trackingMode: .time,
                repWindow: nil,
                sets: [
                    WorkoutSet(uuid: "s8", workoutExerciseUUID: "mock-wex-3", orderIndex: 0, isCompleted: false, targetDurationSeconds: 60),
                    WorkoutSet(uuid: "s9", workoutExerciseUUID: "mock-wex-3", orderIndex: 1, isCompleted: false, targetDurationSeconds: 60),
                ],
                history: nil
            ),
        ],
        restTimerDefaultSeconds: 90
    )
}
#endif
