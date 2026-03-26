'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/local';
import type { LocalWorkout, LocalWorkoutExercise, LocalWorkoutSet, LocalBodyweightLog, LocalExercise } from '@/db/local';

// ─── Compound type for full workout view ───────────────────────────────────────

export type LocalWorkoutExerciseEntry = LocalWorkoutExercise & {
  exercise: LocalExercise;
  sets: LocalWorkoutSet[];
};

export type LocalWorkoutWithExercises = LocalWorkout & {
  exercises: LocalWorkoutExerciseEntry[];
};

/** Returns the active workout with exercises and sets joined from local DB. */
export function useCurrentWorkoutFull(): LocalWorkoutWithExercises | null | undefined {
  return useLiveQuery(async () => {
    const workout = await db.workouts
      .where('is_current')
      .equals(1)
      .filter(w => !w._deleted)
      .first();

    if (!workout) return null;

    const wes = await db.workout_exercises
      .where('workout_uuid')
      .equals(workout.uuid)
      .filter(e => !e._deleted)
      .sortBy('order_index');

    const exercises = await Promise.all(
      wes.map(async we => {
        const [exercise, sets] = await Promise.all([
          db.exercises.get(we.exercise_uuid),
          db.workout_sets
            .where('workout_exercise_uuid')
            .equals(we.uuid)
            .filter(s => !s._deleted)
            .sortBy('order_index'),
        ]);
        return { ...we, exercise: exercise!, sets };
      }),
    );

    return { ...workout, exercises };
  });
}

// ─── Workouts ──────────────────────────────────────────────────────────────────

/** Returns all non-deleted workouts, most recent first. */
export function useWorkouts(limit = 50): LocalWorkout[] {
  return useLiveQuery(
    () =>
      db.workouts
        .where('_deleted')
        .equals(0)
        .reverse()
        .sortBy('start_time')
        .then(rows => rows.slice(0, limit)),
    [],
    [],
  );
}

/** Returns the currently active workout (is_current = true). */
export function useCurrentWorkout(): LocalWorkout | undefined {
  return useLiveQuery(
    async () => db.workouts.where('is_current').equals(1).filter(w => !w._deleted).first(),
    [],
  );
}

/** Returns a single workout by UUID. */
export function useWorkout(uuid: string | null): LocalWorkout | undefined {
  return useLiveQuery(
    async () => (uuid ? db.workouts.get(uuid) : undefined),
    [uuid],
  );
}

// ─── Workout exercises ─────────────────────────────────────────────────────────

/** Returns exercises for a given workout, ordered by order_index. */
export function useWorkoutExercises(workout_uuid: string | null): LocalWorkoutExercise[] {
  return useLiveQuery(
    async () => {
      if (!workout_uuid) return [] as LocalWorkoutExercise[];
      return db.workout_exercises
        .where('workout_uuid')
        .equals(workout_uuid)
        .filter(e => !e._deleted)
        .sortBy('order_index');
    },
    [workout_uuid],
    [],
  );
}

// ─── Workout sets ──────────────────────────────────────────────────────────────

/** Returns sets for a given workout exercise, ordered by order_index. */
export function useWorkoutSets(workout_exercise_uuid: string | null): LocalWorkoutSet[] {
  return useLiveQuery(
    async () => {
      if (!workout_exercise_uuid) return [] as LocalWorkoutSet[];
      return db.workout_sets
        .where('workout_exercise_uuid')
        .equals(workout_exercise_uuid)
        .filter(s => !s._deleted)
        .sortBy('order_index');
    },
    [workout_exercise_uuid],
    [],
  );
}

// ─── Exercises ─────────────────────────────────────────────────────────────────

/** Returns all visible exercises, optionally filtered. */
export function useExercises(opts: {
  search?: string;
  muscleGroup?: string;
  equipment?: string;
} = {}): LocalExercise[] {
  return useLiveQuery(
    () =>
      db.exercises
        .filter(ex => {
          if (ex.is_hidden) return false;
          if (opts.muscleGroup && !ex.primary_muscles.includes(opts.muscleGroup)) return false;
          if (opts.equipment && !ex.equipment.includes(opts.equipment)) return false;
          if (opts.search) {
            const q = opts.search.toLowerCase();
            return (
              ex.title.toLowerCase().includes(q) ||
              ex.alias.some(a => a.toLowerCase().includes(q))
            );
          }
          return true;
        })
        .sortBy('title'),
    [opts.search, opts.muscleGroup, opts.equipment],
    [],
  );
}

/** Returns a single exercise by UUID. */
export function useExercise(uuid: string | null): LocalExercise | undefined {
  return useLiveQuery(
    async () => (uuid ? db.exercises.get(uuid) : undefined),
    [uuid],
  );
}

// ─── Bodyweight logs ───────────────────────────────────────────────────────────

/** Returns bodyweight logs, most recent first. */
export function useBodyweightLogs(limit = 30): LocalBodyweightLog[] {
  return useLiveQuery(
    () =>
      db.bodyweight_logs
        .where('_deleted')
        .equals(0)
        .reverse()
        .sortBy('logged_at')
        .then(rows => rows.slice(0, limit)),
    [],
    [],
  );
}
