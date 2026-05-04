'use client';

import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import type { LocalWorkout, LocalWorkoutExercise, LocalWorkoutSet, LocalBodyweightLog } from '@/db/local';
import { uuid as genUUID } from '@/lib/uuid';
import { saveWorkoutToHealthKit } from '@/lib/healthkit';
import { resolveCanonicalExerciseUuids } from '@/lib/useLocalDB';

function now() {
  return Date.now();
}

function syncMeta() {
  return { _synced: false as const, _updated_at: now(), _deleted: false as const };
}

// ─── Workouts ──────────────────────────────────────────────────────────────────

export async function startWorkout(opts: {
  title?: string;
  workout_routine_uuid?: string;
} = {}): Promise<string> {
  // End any currently active workout first
  const current = await db.workouts.filter(w => w.is_current === true).first();
  if (current) {
    await db.workouts.update(current.uuid, {
      is_current: false,
      end_time: new Date().toISOString(),
      ...syncMeta(),
    });
  }

  const id = genUUID();
  const workout: LocalWorkout = {
    uuid: id,
    start_time: new Date().toISOString(),
    end_time: null,
    title: opts.title ?? null,
    comment: null,
    is_current: true,
    workout_routine_uuid: opts.workout_routine_uuid ?? null,
    ...syncMeta(),
  };
  await db.workouts.add(workout);
  syncEngine.schedulePush();
  return id;
}

export async function finishWorkout(uuid: string): Promise<void> {
  const workout = await db.workouts.get(uuid);
  const endTime = new Date().toISOString();

  await db.workouts.update(uuid, {
    is_current: false,
    end_time: endTime,
    ...syncMeta(),
  });
  syncEngine.schedulePush();

  if (workout?.start_time) {
    saveWorkoutToHealthKit({
      uuid,
      startTime: workout.start_time,
      endTime,
      title: workout.title,
    });
  }
}

export async function deleteWorkout(uuid: string): Promise<void> {
  // Cascade: mark exercises and sets as deleted too
  const exercises = await db.workout_exercises.where('workout_uuid').equals(uuid).toArray();
  for (const ex of exercises) {
    await db.workout_sets
      .where('workout_exercise_uuid')
      .equals(ex.uuid)
      .modify({ _deleted: true, _synced: false, _updated_at: now() });
  }
  await db.workout_exercises
    .where('workout_uuid')
    .equals(uuid)
    .modify({ _deleted: true, _synced: false, _updated_at: now() });
  await db.workouts.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

export async function updateWorkoutTitle(uuid: string, title: string): Promise<void> {
  await db.workouts.update(uuid, { title, ...syncMeta() });
  syncEngine.schedulePush();
}

// ─── Workout exercises ─────────────────────────────────────────────────────────

export async function addExerciseToWorkout(
  workout_uuid: string,
  exercise_uuid: string,
  order_index: number,
): Promise<string> {
  const id = genUUID();
  const row: LocalWorkoutExercise = {
    uuid: id,
    workout_uuid,
    exercise_uuid,
    comment: null,
    order_index,
    ...syncMeta(),
  };
  await db.workout_exercises.add(row);
  syncEngine.schedulePush();
  return id;
}

export async function removeExerciseFromWorkout(uuid: string): Promise<void> {
  await db.workout_sets
    .where('workout_exercise_uuid')
    .equals(uuid)
    .modify({ _deleted: true, _synced: false, _updated_at: now() });
  await db.workout_exercises.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

// ─── Workout sets ──────────────────────────────────────────────────────────────

export async function addSet(
  workout_exercise_uuid: string,
  data: Partial<Pick<LocalWorkoutSet, 'weight' | 'repetitions' | 'min_target_reps' | 'max_target_reps' | 'rpe' | 'rir' | 'tag'>>,
  order_index: number,
): Promise<string> {
  const id = genUUID();
  const row: LocalWorkoutSet = {
    uuid: id,
    workout_exercise_uuid,
    weight: data.weight ?? null,
    repetitions: data.repetitions ?? null,
    min_target_reps: data.min_target_reps ?? null,
    max_target_reps: data.max_target_reps ?? null,
    rpe: data.rpe ?? null,
    rir: data.rir ?? null,
    tag: data.tag ?? null,
    comment: null,
    is_completed: false,
    is_pr: false,
    excluded_from_pb: false,
    order_index,
    duration_seconds: null,
    ...syncMeta(),
  };
  await db.workout_sets.add(row);
  syncEngine.schedulePush();
  return id;
}

export async function updateSet(
  uuid: string,
  changes: Partial<Omit<LocalWorkoutSet, 'uuid' | 'workout_exercise_uuid' | '_synced' | '_updated_at' | '_deleted'>>,
): Promise<void> {
  await db.workout_sets.update(uuid, { ...changes, ...syncMeta() });
  syncEngine.schedulePush();
}

export async function deleteSet(uuid: string): Promise<void> {
  await db.workout_sets.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

/**
 * Toggle the `excluded_from_pb` flag on a set. Used by the per-set action
 * sheet ("Doesn't count (form)") and the per-exercise bulk reset path.
 *
 * The set stays in workout history and continues to count toward volume /
 * set-counts; it just becomes invisible to PR / PB calculations. Server
 * recomputes is_pr flags on the next sync push (slice 7 wires that in).
 */
export async function excludeSetFromPb(uuid: string, excluded: boolean): Promise<void> {
  await db.workout_sets.update(uuid, {
    excluded_from_pb: excluded,
    // Optimistic: clear the local is_pr badge immediately so the UI doesn't
    // flicker between "PR" and "EX" while the server-side recompute lands.
    // The server's next pull will overwrite is_pr with the recomputed truth.
    ...(excluded ? { is_pr: false } : {}),
    ...syncMeta(),
  });
  syncEngine.schedulePush();
}

export interface BulkPbExclusionResult {
  /** Set uuids that were not excluded before and are now (or were excluded
   *  and are now restored, depending on `excluded`). Caller hangs onto this
   *  for the snackbar undo. */
  affected_set_uuids: string[];
  newly_changed_count: number;
  /** Sets that were already in the target state — counted but no-op. */
  already_in_target_state_count: number;
  /** Distinct workouts whose sets were touched. Used in the success copy. */
  workouts_affected_count: number;
}

/**
 * Bulk-toggle `excluded_from_pb` for every completed set in the canonical
 * exercise group whose workout date is on or before `throughDate` (inclusive,
 * `YYYY-MM-DD` in local timezone).
 *
 * Used by the "Adjust PB history" sheet on ExerciseDetail. The sheet's main
 * use case: "I was doing this exercise wrong before [date]" — Lou flips
 * every set on or before that day to excluded, current PRs recompute from
 * the post-cutoff sets only.
 *
 * Returns the list of affected set uuids so the caller can offer a snackbar
 * undo (call again with `excluded=false`, restricted to that uuid list).
 */
export async function excludeSetsForExerciseThroughDate(
  exerciseUuid: string,
  throughDate: string,
  excluded = true,
): Promise<BulkPbExclusionResult> {
  const groupUuids = await resolveCanonicalExerciseUuids(exerciseUuid, 'any');
  if (groupUuids.size === 0) {
    return { affected_set_uuids: [], newly_changed_count: 0, already_in_target_state_count: 0, workouts_affected_count: 0 };
  }

  // Walk workout_exercises in the canonical group, then their sets, joining
  // workouts to filter by start_time. Inclusive of the cutoff date.
  const cutoffMs = parseLocalDateEndOfDay(throughDate);
  const allWes = await db.workout_exercises
    .filter(we => groupUuids.has(we.exercise_uuid.toLowerCase()) && !we._deleted)
    .toArray();
  if (allWes.length === 0) {
    return { affected_set_uuids: [], newly_changed_count: 0, already_in_target_state_count: 0, workouts_affected_count: 0 };
  }
  const weUuids = allWes.map(we => we.uuid);
  const weToWorkout = new Map(allWes.map(we => [we.uuid, we.workout_uuid]));

  const allWorkouts = await db.workouts.toArray();
  const workoutByUuid = new Map(allWorkouts.map(w => [w.uuid, w]));

  const candidateSets = await db.workout_sets
    .where('workout_exercise_uuid')
    .anyOf(weUuids)
    .filter(s => s.is_completed && !s._deleted)
    .toArray();

  const targetSets: typeof candidateSets = [];
  let already = 0;
  const workoutsTouched = new Set<string>();
  for (const s of candidateSets) {
    const woUuid = weToWorkout.get(s.workout_exercise_uuid);
    if (!woUuid) continue;
    const wo = workoutByUuid.get(woUuid);
    if (!wo || wo._deleted) continue;
    const startMs = new Date(wo.start_time).getTime();
    if (startMs > cutoffMs) continue;
    if (s.excluded_from_pb === excluded) {
      already += 1;
      continue;
    }
    targetSets.push(s);
    workoutsTouched.add(woUuid);
  }

  if (targetSets.length === 0) {
    return {
      affected_set_uuids: [],
      newly_changed_count: 0,
      already_in_target_state_count: already,
      workouts_affected_count: 0,
    };
  }

  // Single Dexie transaction so all rows flip atomically locally before any
  // sync push fires. One schedulePush() at the end batches the lot into one
  // /api/sync/push round-trip.
  const meta = syncMeta();
  await db.transaction('rw', db.workout_sets, async () => {
    for (const s of targetSets) {
      await db.workout_sets.update(s.uuid, {
        excluded_from_pb: excluded,
        // Same optimistic is_pr clear as the per-set toggle, so PR badges
        // don't linger on excluded sets while the server recomputes.
        ...(excluded ? { is_pr: false } : {}),
        ...meta,
      });
    }
  });
  syncEngine.schedulePush();

  return {
    affected_set_uuids: targetSets.map(s => s.uuid),
    newly_changed_count: targetSets.length,
    already_in_target_state_count: already,
    workouts_affected_count: workoutsTouched.size,
  };
}

/** Restore a previous bulk exclusion by uuid list. Used for snackbar undo. */
export async function restorePbForSets(setUuids: string[]): Promise<number> {
  if (setUuids.length === 0) return 0;
  const meta = syncMeta();
  await db.transaction('rw', db.workout_sets, async () => {
    for (const uuid of setUuids) {
      await db.workout_sets.update(uuid, {
        excluded_from_pb: false,
        ...meta,
      });
    }
  });
  syncEngine.schedulePush();
  return setUuids.length;
}

/** Parse a YYYY-MM-DD local-timezone date and return its ms-at-end-of-day
 *  (23:59:59.999 local). Used for inclusive cutoff comparisons against
 *  workout start_time. */
function parseLocalDateEndOfDay(yyyyMmDd: string): number {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
  return date.getTime();
}

// ─── Bodyweight logs ───────────────────────────────────────────────────────────

export async function logBodyweight(weight_kg: number, note?: string): Promise<string> {
  const id = genUUID();
  const row: LocalBodyweightLog = {
    uuid: id,
    weight_kg,
    logged_at: new Date().toISOString(),
    note: note ?? null,
    ...syncMeta(),
  };
  await db.bodyweight_logs.add(row);
  syncEngine.schedulePush();
  return id;
}

export async function deleteBodyweightLog(uuid: string): Promise<void> {
  await db.bodyweight_logs.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}

// ─── Exercise reordering ──────────────────────────────────────────────────────

export async function reorderExercises(orderedUuids: string[]): Promise<void> {
  await Promise.all(
    orderedUuids.map((uuid, index) =>
      db.workout_exercises.update(uuid, {
        order_index: index,
        ...syncMeta(),
      }),
    ),
  );
  syncEngine.schedulePush();
}
