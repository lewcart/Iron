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
      .filter(w => w.is_current === true && !w._deleted)
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
          db.exercises.get(we.exercise_uuid.toLowerCase()),
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
        .filter(r => !r._deleted)
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
    async () => db.workouts.filter(w => w.is_current === true && !w._deleted).first(),
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

// ─── Workout summaries (for history list) ──────────────────────────────────────

export type LocalWorkoutSummary = LocalWorkout & {
  exercise_count: number;
  total_volume: number;
};

/**
 * Returns finished workouts with computed exercise_count and total_volume,
 * most recent first. Supports optional date-range and exercise-UUID filtering.
 */
export function useWorkoutSummaries(opts: {
  limit?: number;
  fromDate?: string;
  toDate?: string;
  exerciseUuid?: string | null;
} = {}): LocalWorkoutSummary[] {
  const { limit = 200, fromDate, toDate, exerciseUuid } = opts;

  return useLiveQuery(
    async () => {
      // Three bulk queries — much faster than N per-workout queries
      const [allWorkouts, allExercises, allSets] = await Promise.all([
        db.workouts.filter(w => !w._deleted && !w.is_current).toArray(),
        db.workout_exercises.filter(e => !e._deleted).toArray(),
        db.workout_sets.filter(s => !s._deleted && s.is_completed).toArray(),
      ]);

      // Build lookup maps
      const exercisesByWorkout = new Map<string, LocalWorkoutExercise[]>();
      for (const e of allExercises) {
        if (!exercisesByWorkout.has(e.workout_uuid)) exercisesByWorkout.set(e.workout_uuid, []);
        exercisesByWorkout.get(e.workout_uuid)!.push(e);
      }

      const setsByExercise = new Map<string, LocalWorkoutSet[]>();
      for (const s of allSets) {
        if (!setsByExercise.has(s.workout_exercise_uuid)) setsByExercise.set(s.workout_exercise_uuid, []);
        setsByExercise.get(s.workout_exercise_uuid)!.push(s);
      }

      // Resolve exercise filter
      let exerciseWorkoutUuids: Set<string> | null = null;
      if (exerciseUuid) {
        exerciseWorkoutUuids = new Set(
          allExercises
            .filter(e => e.exercise_uuid === exerciseUuid)
            .map(e => e.workout_uuid),
        );
      }

      // Filter and sort
      const filtered = allWorkouts
        .filter(w => {
          if (fromDate && w.start_time < fromDate) return false;
          if (toDate && w.start_time > toDate + 'T23:59:59') return false;
          if (exerciseWorkoutUuids && !exerciseWorkoutUuids.has(w.uuid)) return false;
          return true;
        })
        .sort((a, b) => b.start_time.localeCompare(a.start_time))
        .slice(0, limit);

      return filtered.map(w => {
        const exercises = exercisesByWorkout.get(w.uuid) ?? [];
        let total_volume = 0;
        for (const e of exercises) {
          for (const s of setsByExercise.get(e.uuid) ?? []) {
            total_volume += (s.weight ?? 0) * (s.repetitions ?? 0);
          }
        }
        return { ...w, exercise_count: exercises.length, total_volume };
      });
    },
    [fromDate, toDate, exerciseUuid, limit],
    [],
  );
}

/** Returns a full workout detail (exercises + sets + exercise metadata) from local DB. */
export function useWorkoutFull(uuid: string | null): LocalWorkoutWithExercises | null | undefined {
  return useLiveQuery(
    async () => {
      if (!uuid) return null;
      const workout = await db.workouts.get(uuid);
      if (!workout || workout._deleted) return null;

      const wes = await db.workout_exercises
        .where('workout_uuid')
        .equals(uuid)
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
    },
    [uuid],
  );
}

// ─── Bodyweight logs ───────────────────────────────────────────────────────────

/** Returns bodyweight logs, most recent first. */
export function useBodyweightLogs(limit = 30): LocalBodyweightLog[] {
  return useLiveQuery(
    () =>
      db.bodyweight_logs
        .filter(r => !r._deleted)
        .reverse()
        .sortBy('logged_at')
        .then(rows => rows.slice(0, limit)),
    [],
    [],
  );
}

// ─── Autofill helpers ─────────────────────────────────────────────────────────

/** Returns weight/reps to prefill a new set from the current workout's existing sets,
 *  or from the most recent previous workout for this exercise. */
export async function getAutoFillValues(
  exerciseUuid: string,
  currentSets: LocalWorkoutSet[],
): Promise<{ weight: number | null; repetitions: number | null }> {
  // Prefer last completed set in the current workout
  const lastCompleted = [...currentSets]
    .reverse()
    .find(s => s.is_completed && !s._deleted);
  if (lastCompleted) {
    return { weight: lastCompleted.weight, repetitions: lastCompleted.repetitions };
  }

  // Fall back to most recent set from a previous workout
  const allWe = await db.workout_exercises
    .filter(e => e.exercise_uuid.toLowerCase() === exerciseUuid.toLowerCase() && !e._deleted)
    .toArray();

  for (const we of allWe.reverse()) {
    const sets = await db.workout_sets
      .where('workout_exercise_uuid')
      .equals(we.uuid)
      .filter(s => s.is_completed && !s._deleted)
      .sortBy('order_index');
    if (sets.length > 0) {
      const last = sets[sets.length - 1];
      return { weight: last.weight, repetitions: last.repetitions };
    }
  }

  return { weight: null, repetitions: null };
}
