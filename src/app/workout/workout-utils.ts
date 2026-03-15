import type { WorkoutExercise, WorkoutSet, Exercise } from '@/types';

export interface WorkoutExerciseEntry extends WorkoutExercise {
  exercise: Exercise;
  sets: WorkoutSet[];
}

/**
 * Format a duration given in seconds to HH:MM:SS (hours omitted when < 1h).
 */
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Count the total number of completed sets across all exercises in a workout.
 */
export function calcCompletedSets(exercises: WorkoutExerciseEntry[]): number {
  return exercises.reduce(
    (acc, we) => acc + we.sets.filter(s => s.is_completed).length,
    0,
  );
}

/**
 * Sum weight × reps for every completed set across all exercises (total volume in kg).
 */
export function calcTotalVolume(exercises: WorkoutExerciseEntry[]): number {
  return exercises.reduce((acc, we) => {
    return (
      acc +
      we.sets
        .filter(s => s.is_completed)
        .reduce((setAcc, s) => setAcc + (s.weight ?? 0) * (s.repetitions ?? 0), 0)
    );
  }, 0);
}
