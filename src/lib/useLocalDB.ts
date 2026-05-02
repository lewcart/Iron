'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/local';
import type { LocalWorkout, LocalWorkoutExercise, LocalWorkoutSet, LocalBodyweightLog, LocalExercise } from '@/db/local';
import { estimate1RM } from '@/lib/pr';

// ─── Compound type for full workout view ───────────────────────────────────────

export type LocalWorkoutExerciseEntry = LocalWorkoutExercise & {
  exercise: LocalExercise;
  sets: LocalWorkoutSet[];
};

export type LocalWorkoutWithExercises = LocalWorkout & {
  exercises: LocalWorkoutExerciseEntry[];
};

// Module-level cache so the hook returns the most recent value as the
// initial render on every remount. Without this, useLiveQuery returns
// `undefined` on every remount until Dexie reads complete (~50-200ms),
// which is what makes /workout flash "Loading…" on every tab switch.
let _currentWorkoutCache: LocalWorkoutWithExercises | null | undefined = undefined;

/** Returns the active workout with exercises and sets joined from local DB.
 *
 * Optimized as a single async block:
 *   1. Read the active workout (1 round trip)
 *   2. Read its workout_exercises rows (1 round trip)
 *   3. In parallel: load the exercise catalog rows AND the set rows
 *      across all exercises in one bulk anyOf() lookup (1 round trip)
 *   4. Group sets by workout_exercise in memory
 *
 * Total: 3 sequential round trips instead of the previous 4 + N (where
 * N = exercises). On a 6-exercise workout this is 3 reads instead of 9-10.
 */
export function useCurrentWorkoutFull(): LocalWorkoutWithExercises | null | undefined {
  const result = useLiveQuery(
    async () => {
      const workout = await db.workouts
        .filter(w => w.is_current === true && !w._deleted)
        .first();

      if (!workout) {
        _currentWorkoutCache = null;
        return null;
      }

      const wes = await db.workout_exercises
        .where('workout_uuid')
        .equals(workout.uuid)
        .filter(e => !e._deleted)
        .sortBy('order_index');

      const weUuids = wes.map(we => we.uuid);
      const exerciseUuids = wes.map(we => we.exercise_uuid.toLowerCase());

      const [allExercises, allSets] = await Promise.all([
        db.exercises.where('uuid').anyOf(exerciseUuids).toArray(),
        weUuids.length > 0
          ? db.workout_sets.where('workout_exercise_uuid').anyOf(weUuids).filter(s => !s._deleted).toArray()
          : Promise.resolve([] as LocalWorkoutSet[]),
      ]);

      const exerciseMap = new Map(allExercises.map(e => [e.uuid, e]));
      const setsByWe = new Map<string, LocalWorkoutSet[]>();
      for (const s of allSets) {
        if (!setsByWe.has(s.workout_exercise_uuid)) setsByWe.set(s.workout_exercise_uuid, []);
        setsByWe.get(s.workout_exercise_uuid)!.push(s);
      }
      // Sort sets per exercise by order_index in memory.
      for (const arr of setsByWe.values()) arr.sort((a, b) => a.order_index - b.order_index);

      const exercises = wes.map(we => ({
        ...we,
        exercise: exerciseMap.get(we.exercise_uuid.toLowerCase())!,
        sets: setsByWe.get(we.uuid) ?? [],
      }));

      const out = { ...workout, exercises };
      _currentWorkoutCache = out;
      return out;
    },
    [],
    _currentWorkoutCache,
  );
  return result;
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

      const neededUuids = wes.map(we => we.exercise_uuid.toLowerCase());
      const allExercises = await db.exercises.where('uuid').anyOf(neededUuids).toArray();
      const exerciseMap = new Map(allExercises.map(e => [e.uuid, e]));

      const exercises = await Promise.all(
        wes.map(async we => {
          const exercise = exerciseMap.get(we.exercise_uuid.toLowerCase());
          const sets = await db.workout_sets
            .where('workout_exercise_uuid')
            .equals(we.uuid)
            .filter(s => !s._deleted)
            .sortBy('order_index');
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

/** Returns the all-time best estimated 1RM (Epley) for an exercise, excluding the
 *  given workout. Returns 0 if no historical sets exist.
 *
 *  Single-pass: collect candidate workout_exercise UUIDs, then do ONE
 *  bulk anyOf() lookup across all sets. Avoids N+1 round trips that
 *  accumulated against IndexedDB on long histories. */
export async function getAllTimeBest1RM(
  exerciseUuid: string,
  excludeWorkoutUuid: string,
): Promise<number> {
  const allWe = await db.workout_exercises
    .filter(we => we.exercise_uuid.toLowerCase() === exerciseUuid.toLowerCase()
      && !we._deleted
      && we.workout_uuid !== excludeWorkoutUuid)
    .toArray();

  if (allWe.length === 0) return 0;

  const weUuids = allWe.map(we => we.uuid);
  const sets = await db.workout_sets
    .where('workout_exercise_uuid')
    .anyOf(weUuids)
    .filter(s => s.is_completed && !s._deleted && s.weight != null && s.repetitions != null)
    .toArray();

  let best = 0;
  for (const s of sets) {
    const orm = estimate1RM(s.weight!, s.repetitions!);
    if (orm > best) best = orm;
  }
  return best;
}

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

/** Returns the working sets from the most recent completed session for this
 *  exercise (canonical group), excluding the in-progress workout. Used by the
 *  progression cue on the next session's exercise card. Returns [] if there's
 *  no prior session. Sets keep min/max_target_reps + rir so the rule fn can
 *  compare reps to range and average RIR. */
export async function getLastSessionSetsForExercise(
  exerciseUuid: string,
  excludeWorkoutUuid: string,
): Promise<LocalWorkoutSet[]> {
  const groupUuids = await resolveCanonicalExerciseUuids(exerciseUuid, 'any');
  if (groupUuids.size === 0) return [];

  const allWes = await db.workout_exercises
    .filter(we => groupUuids.has(we.exercise_uuid.toLowerCase())
      && !we._deleted
      && we.workout_uuid !== excludeWorkoutUuid)
    .toArray();
  if (allWes.length === 0) return [];

  const allWorkouts = await db.workouts.toArray();
  const workoutByUuid = new Map(allWorkouts.map(w => [w.uuid, w]));

  const candidates = allWes
    .map(we => ({ we, wo: workoutByUuid.get(we.workout_uuid) }))
    .filter(({ wo }) => wo && !wo._deleted && wo.end_time != null)
    .sort((a, b) =>
      new Date(b.wo!.start_time).getTime() - new Date(a.wo!.start_time).getTime(),
    );
  if (candidates.length === 0) return [];

  const lastWe = candidates[0].we;
  return await db.workout_sets
    .where('workout_exercise_uuid')
    .equals(lastWe.uuid)
    .filter(s => !s._deleted)
    .sortBy('order_index');
}

// ─── Exercise history (Dexie-side, used by the in-workout [i] modal) ─────────
//
// These mirror the server-side queries in src/db/queries.ts but read from
// IndexedDB so the modal works offline. Server endpoints become an
// enrichment fallback for sessions that haven't synced down yet.
//
// Canonical-key dedup: for catalog exercises (everkinetic_id > 0) we group
// by everkinetic_id; for custom exercises (everkinetic_id = 0) we fall back
// to title equality. Mirrors exerciseGroupMatch in queries.ts.
//
// Time-mode exclusion: sets attached to time-mode exercises never enter the
// 1RM/heaviest/most-reps stats. PR-D₂ enables time-mode UI; the filter is
// already in place here so no later refactor is needed.

export interface ExerciseSessionGroup {
  workout_uuid: string;
  date: string;
  workout_title: string | null;
  sets: Array<{
    uuid: string;
    weight: number | null;
    repetitions: number | null;
    duration_seconds: number | null;
    rpe: number | null;
    tag: string | null;
    order_index: number;
  }>;
}

export interface ExerciseProgressLocal {
  progress: Array<{
    date: string;
    workoutUuid: string;
    maxWeight: number;
    totalVolume: number;
    estimated1RM: number;
  }>;
  prs: {
    estimated1RM: { weight: number; repetitions: number; estimated_1rm: number; date: string; workout_uuid: string } | null;
    heaviestWeight: { weight: number; repetitions: number; estimated_1rm: number; date: string; workout_uuid: string } | null;
    mostReps: { weight: number; repetitions: number; estimated_1rm: number; date: string; workout_uuid: string } | null;
  };
  volumeTrend: Array<{ date: string; totalVolume: number }>;
}

/** Returns the canonical group of exercise UUIDs that match the given UUID,
 *  per the same dedup rules as the server (everkinetic_id when > 0, title
 *  fallback otherwise).
 *
 *  modeFilter:
 *    - 'reps' (default): used by 1RM-eligible queries (chart/PR/volume).
 *      Time-mode duplicates are excluded so plank reps can never bleed into
 *      bench-press 1RM stats.
 *    - 'any': used by session-history reads, where time-mode exercises need
 *      to merge their own duplicates (e.g. two "Plank" rows from catalog +
 *      custom both contribute their hold history). */
async function resolveCanonicalExerciseUuids(
  exerciseUuid: string,
  modeFilter: 'reps' | 'any' = 'reps',
): Promise<Set<string>> {
  const target = await db.exercises.get(exerciseUuid.toLowerCase());
  if (!target) return new Set([exerciseUuid.toLowerCase()]);

  const targetMode = target.tracking_mode ?? 'reps';
  const all = await db.exercises.toArray();
  const out = new Set<string>();
  for (const e of all) {
    const mode = e.tracking_mode ?? 'reps';
    if (modeFilter === 'reps' && mode !== 'reps') continue;
    // For 'any' mode, group by mode parity so a reps-mode "Plank" never
    // merges with a time-mode "Plank" — they're conceptually different.
    if (modeFilter === 'any' && mode !== targetMode) continue;
    if (target.everkinetic_id > 0 && e.everkinetic_id === target.everkinetic_id) {
      out.add(e.uuid.toLowerCase());
    } else if (target.everkinetic_id === 0 && e.title === target.title) {
      out.add(e.uuid.toLowerCase());
    }
  }
  if (out.size === 0) out.add(target.uuid.toLowerCase());
  return out;
}

/** Local-first equivalent of getExerciseProgress + getExercisePRs +
 *  getExerciseVolumeTrend rolled into one bulk read. The modal needs all
 *  three at once; one Dexie pass beats three. */
export async function getExerciseProgressLocal(
  exerciseUuid: string,
  since?: Date,
): Promise<ExerciseProgressLocal> {
  const groupUuids = await resolveCanonicalExerciseUuids(exerciseUuid);
  if (groupUuids.size === 0) {
    return {
      progress: [],
      prs: { estimated1RM: null, heaviestWeight: null, mostReps: null },
      volumeTrend: [],
    };
  }

  // All workout_exercises that map to any UUID in our canonical group.
  const allWes = await db.workout_exercises
    .filter(we => groupUuids.has(we.exercise_uuid.toLowerCase()) && !we._deleted)
    .toArray();
  if (allWes.length === 0) {
    return {
      progress: [],
      prs: { estimated1RM: null, heaviestWeight: null, mostReps: null },
      volumeTrend: [],
    };
  }

  const weUuids = allWes.map(we => we.uuid);
  const allSets = weUuids.length > 0
    ? await db.workout_sets
        .where('workout_exercise_uuid')
        .anyOf(weUuids)
        .filter(s => s.is_completed && !s._deleted && s.weight != null && s.repetitions != null)
        .toArray()
    : [];

  // Index workouts by uuid for joining on workout_uuid.
  const allWorkouts = await db.workouts.toArray();
  const workoutByUuid = new Map(allWorkouts.map(w => [w.uuid, w]));
  const weToWorkout = new Map(allWes.map(we => [we.uuid, we.workout_uuid]));

  const sinceMs = since?.getTime();

  // Annotate each set with its workout context.
  type AnnotatedSet = {
    weight: number;
    repetitions: number;
    workout_uuid: string;
    date: string;
  };
  const annotated: AnnotatedSet[] = [];
  for (const s of allSets) {
    const woUuid = weToWorkout.get(s.workout_exercise_uuid);
    if (!woUuid) continue;
    const wo = workoutByUuid.get(woUuid);
    if (!wo || wo._deleted) continue;
    if (sinceMs != null && new Date(wo.start_time).getTime() < sinceMs) continue;
    annotated.push({
      weight: s.weight!,
      repetitions: s.repetitions!,
      workout_uuid: wo.uuid,
      date: wo.start_time,
    });
  }

  // Group by workout for the chart's per-session aggregation.
  type Bucket = { date: string; workoutUuid: string; sets: AnnotatedSet[] };
  const byWorkout = new Map<string, Bucket>();
  for (const s of annotated) {
    if (!byWorkout.has(s.workout_uuid)) {
      byWorkout.set(s.workout_uuid, { date: s.date, workoutUuid: s.workout_uuid, sets: [] });
    }
    byWorkout.get(s.workout_uuid)!.sets.push(s);
  }

  const progress = [...byWorkout.values()]
    .map(b => {
      const maxWeight = b.sets.reduce((m, s) => Math.max(m, s.weight), 0);
      const totalVolume = b.sets.reduce((sum, s) => sum + s.weight * s.repetitions, 0);
      const repsAtMax = b.sets
        .filter(s => s.weight === maxWeight)
        .reduce((m, s) => Math.max(m, s.repetitions), 1);
      return {
        date: b.date,
        workoutUuid: b.workoutUuid,
        maxWeight,
        totalVolume,
        estimated1RM: estimate1RM(maxWeight, repsAtMax),
      };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // PRs across all annotated sets.
  let best1rm: AnnotatedSet | null = null; let best1rmVal = -Infinity;
  let heaviest: AnnotatedSet | null = null; let heaviestVal = -Infinity;
  let mostReps: AnnotatedSet | null = null; let mostRepsVal = -Infinity;
  for (const s of annotated) {
    const orm = estimate1RM(s.weight, s.repetitions);
    if (orm > best1rmVal) { best1rmVal = orm; best1rm = s; }
    if (s.weight > heaviestVal) { heaviestVal = s.weight; heaviest = s; }
    if (s.repetitions > mostRepsVal) { mostRepsVal = s.repetitions; mostReps = s; }
  }
  const toRecord = (s: AnnotatedSet | null) => s ? {
    weight: s.weight,
    repetitions: s.repetitions,
    estimated_1rm: estimate1RM(s.weight, s.repetitions),
    date: s.date,
    workout_uuid: s.workout_uuid,
  } : null;

  const volumeTrend = progress.map(p => ({ date: p.date, totalVolume: p.totalVolume }));

  return {
    progress,
    prs: {
      estimated1RM: toRecord(best1rm),
      heaviestWeight: toRecord(heaviest),
      mostReps: toRecord(mostReps),
    },
    volumeTrend,
  };
}

/** Local-first paginated session history. Reverse-chrono, keyset cursor.
 *  When the local store is exhausted, return nextCursor=null so the UI can
 *  optionally fetch from /api/exercises/[uuid]/sessions for older data. */
export async function getExerciseSessionHistoryLocal(
  exerciseUuid: string,
  cursor: string | null,
  limit = 10,
): Promise<{ sessions: ExerciseSessionGroup[]; nextCursor: string | null }> {
  // Session-history reads use 'any' mode: a time-mode plank's history needs
  // to merge across duplicate plank rows even though they're not 1RM-eligible.
  const groupUuids = await resolveCanonicalExerciseUuids(exerciseUuid, 'any');
  if (groupUuids.size === 0) return { sessions: [], nextCursor: null };

  let cursorTime: number | null = null;
  let cursorUuid: string | null = null;
  if (cursor) {
    const idx = cursor.indexOf('|');
    if (idx > 0) {
      cursorTime = new Date(cursor.slice(0, idx)).getTime();
      cursorUuid = cursor.slice(idx + 1);
    }
  }

  const allWes = await db.workout_exercises
    .filter(we => groupUuids.has(we.exercise_uuid.toLowerCase()) && !we._deleted)
    .toArray();
  if (allWes.length === 0) return { sessions: [], nextCursor: null };

  const weUuids = allWes.map(we => we.uuid);
  const allSets = await db.workout_sets
    .where('workout_exercise_uuid')
    .anyOf(weUuids)
    .filter(s => s.is_completed && !s._deleted)
    .toArray();
  if (allSets.length === 0) return { sessions: [], nextCursor: null };

  const allWorkouts = await db.workouts.toArray();
  const workoutByUuid = new Map(allWorkouts.map(w => [w.uuid, w]));
  const weToWorkout = new Map(allWes.map(we => [we.uuid, we.workout_uuid]));

  const setsByWorkout = new Map<string, typeof allSets>();
  for (const s of allSets) {
    const woUuid = weToWorkout.get(s.workout_exercise_uuid);
    if (!woUuid) continue;
    const wo = workoutByUuid.get(woUuid);
    if (!wo || wo._deleted) continue;
    if (!setsByWorkout.has(woUuid)) setsByWorkout.set(woUuid, []);
    setsByWorkout.get(woUuid)!.push(s);
  }

  // Build reverse-chronological session list, applying cursor.
  let sessionEntries = [...setsByWorkout.entries()]
    .map(([woUuid, sets]) => {
      const wo = workoutByUuid.get(woUuid)!;
      return {
        workout_uuid: wo.uuid,
        date: wo.start_time,
        workout_title: wo.title,
        sets: [...sets].sort((a, b) => a.order_index - b.order_index).map(s => ({
          uuid: s.uuid,
          weight: s.weight,
          repetitions: s.repetitions,
          duration_seconds: s.duration_seconds ?? null,
          rpe: s.rpe,
          tag: s.tag,
          order_index: s.order_index,
        })),
      };
    })
    .sort((a, b) => {
      // Reverse chrono with workout_uuid as tiebreaker (matches server keyset).
      const t = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (t !== 0) return t;
      return a.workout_uuid < b.workout_uuid ? 1 : -1;
    });

  if (cursorTime != null && cursorUuid != null) {
    sessionEntries = sessionEntries.filter(s => {
      const t = new Date(s.date).getTime();
      if (t < cursorTime!) return true;
      if (t === cursorTime && s.workout_uuid < cursorUuid!) return true;
      return false;
    });
  }

  const page = sessionEntries.slice(0, limit);
  const nextCursor = page.length === limit
    ? `${page[page.length - 1].date}|${page[page.length - 1].workout_uuid}`
    : null;

  return { sessions: page, nextCursor };
}

// ─── Time-mode PRs (longest hold) ────────────────────────────────────────────
//
// Mirror of getExerciseProgressLocal but for time-mode exercises. The 1RM
// helpers and chart treat time-mode exercises as ineligible; this provides
// the ExerciseDetail hero with a meaningful PB for them: longest single hold.

export interface ExerciseTimePRsLocal {
  longestHold: {
    duration_seconds: number;
    date: string;
    workout_uuid: string;
  } | null;
  totalSeconds: number;
  /** Sessions where this exercise was logged with at least one time set. Used
   *  for an analogue of the 1RM chart that plots longest-hold per session. */
  progress: Array<{
    date: string;
    workoutUuid: string;
    longestHold: number;
    totalSeconds: number;
  }>;
}

export async function getExerciseTimePRsLocal(
  exerciseUuid: string,
  since?: Date,
): Promise<ExerciseTimePRsLocal> {
  // 'any' mode: time-mode exercise's history merges across duplicate rows.
  const groupUuids = await resolveCanonicalExerciseUuids(exerciseUuid, 'any');
  const empty: ExerciseTimePRsLocal = { longestHold: null, totalSeconds: 0, progress: [] };
  if (groupUuids.size === 0) return empty;

  const allWes = await db.workout_exercises
    .filter(we => groupUuids.has(we.exercise_uuid.toLowerCase()) && !we._deleted)
    .toArray();
  if (allWes.length === 0) return empty;

  const weUuids = allWes.map(we => we.uuid);
  const allSets = await db.workout_sets
    .where('workout_exercise_uuid')
    .anyOf(weUuids)
    .filter(s => s.is_completed && !s._deleted && s.duration_seconds != null && s.duration_seconds > 0)
    .toArray();
  if (allSets.length === 0) return empty;

  const allWorkouts = await db.workouts.toArray();
  const workoutByUuid = new Map(allWorkouts.map(w => [w.uuid, w]));
  const weToWorkout = new Map(allWes.map(we => [we.uuid, we.workout_uuid]));
  const sinceMs = since?.getTime();

  type AnnotatedTimeSet = {
    duration_seconds: number;
    workout_uuid: string;
    date: string;
  };
  const annotated: AnnotatedTimeSet[] = [];
  for (const s of allSets) {
    const woUuid = weToWorkout.get(s.workout_exercise_uuid);
    if (!woUuid) continue;
    const wo = workoutByUuid.get(woUuid);
    if (!wo || wo._deleted) continue;
    if (sinceMs != null && new Date(wo.start_time).getTime() < sinceMs) continue;
    annotated.push({
      duration_seconds: s.duration_seconds!,
      workout_uuid: wo.uuid,
      date: wo.start_time,
    });
  }
  if (annotated.length === 0) return empty;

  // Group by workout for the chart.
  const byWorkout = new Map<string, AnnotatedTimeSet[]>();
  for (const s of annotated) {
    if (!byWorkout.has(s.workout_uuid)) byWorkout.set(s.workout_uuid, []);
    byWorkout.get(s.workout_uuid)!.push(s);
  }
  const progress = [...byWorkout.values()]
    .map(sets => {
      const longest = sets.reduce((m, s) => Math.max(m, s.duration_seconds), 0);
      const total = sets.reduce((sum, s) => sum + s.duration_seconds, 0);
      return {
        date: sets[0].date,
        workoutUuid: sets[0].workout_uuid,
        longestHold: longest,
        totalSeconds: total,
      };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // All-time bests.
  let longest: AnnotatedTimeSet | null = null;
  let longestVal = -Infinity;
  let total = 0;
  for (const s of annotated) {
    if (s.duration_seconds > longestVal) {
      longestVal = s.duration_seconds;
      longest = s;
    }
    total += s.duration_seconds;
  }

  return {
    longestHold: longest ? {
      duration_seconds: longest.duration_seconds,
      date: longest.date,
      workout_uuid: longest.workout_uuid,
    } : null,
    totalSeconds: total,
    progress,
  };
}
