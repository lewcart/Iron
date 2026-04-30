'use client';

import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import { uuid as genUUID } from '@/lib/uuid';
import type {
  LocalWorkoutPlan,
  LocalWorkoutRoutine,
  LocalWorkoutRoutineExercise,
  LocalWorkoutRoutineSet,
} from '@/db/local';

// Mutations module for the plans hierarchy. Mirrors the workout mutations
// pattern: write to Dexie, set _synced=false, schedulePush(). Reads happen
// elsewhere via useLiveQuery hooks.
//
// Hierarchy:
//   workout_plans
//     └── workout_routines (FK workout_plan_uuid)
//           └── workout_routine_exercises (FK workout_routine_uuid)
//                 └── workout_routine_sets (FK workout_routine_exercise_uuid)
//
// Cascade deletes are handled client-side: deleting a plan soft-deletes
// every descendant in one transaction so the entire subtree is dirty for
// the next push. The server-side schema also has ON DELETE CASCADE FKs as
// a safety net.

function now() {
  return Date.now();
}

function syncMeta() {
  return { _synced: false as const, _updated_at: now(), _deleted: false as const };
}

// ─── Plans ────────────────────────────────────────────────────────────────────

export async function createPlan(opts: { title?: string | null } = {}): Promise<string> {
  const id = genUUID();
  const max = await db.workout_plans.filter(p => !p._deleted).count();
  const plan: LocalWorkoutPlan = {
    uuid: id,
    title: opts.title?.trim() || null,
    order_index: max,
    is_active: false,
    ...syncMeta(),
  };
  await db.workout_plans.add(plan);
  syncEngine.schedulePush();
  return id;
}

export async function updatePlanTitle(uuid: string, title: string | null): Promise<void> {
  await db.workout_plans.update(uuid, { title: title?.trim() || null, ...syncMeta() });
  syncEngine.schedulePush();
}

export async function deletePlan(uuid: string): Promise<void> {
  // Cascade: soft-delete every descendant atomically. Push order
  // (parents-before-children in sync.ts) means tombstones land on the
  // server in dependency order.
  await db.transaction(
    'rw',
    [db.workout_plans, db.workout_routines, db.workout_routine_exercises, db.workout_routine_sets],
    async () => {
      const routines = await db.workout_routines.where('workout_plan_uuid').equals(uuid).toArray();
      const routineUuids = routines.map(r => r.uuid);
      const exercises = routineUuids.length > 0
        ? await db.workout_routine_exercises.where('workout_routine_uuid').anyOf(routineUuids).toArray()
        : [];
      const exerciseUuids = exercises.map(e => e.uuid);

      if (exerciseUuids.length > 0) {
        await db.workout_routine_sets
          .where('workout_routine_exercise_uuid')
          .anyOf(exerciseUuids)
          .modify({ _deleted: true, _synced: false, _updated_at: now() });
      }
      if (exerciseUuids.length > 0) {
        await db.workout_routine_exercises.where('uuid').anyOf(exerciseUuids).modify({
          _deleted: true, _synced: false, _updated_at: now(),
        });
      }
      if (routineUuids.length > 0) {
        await db.workout_routines.where('uuid').anyOf(routineUuids).modify({
          _deleted: true, _synced: false, _updated_at: now(),
        });
      }
      await db.workout_plans.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
    },
  );
  syncEngine.schedulePush();
}

export async function activatePlan(uuid: string): Promise<void> {
  // Mutually exclusive: at most one plan active at a time. Schema enforces
  // this via UNIQUE INDEX on is_active WHERE is_active = true (migration
  // 006). Locally, deactivate every other plan in the same transaction so
  // useLiveQuery sees the consistent state immediately.
  await db.transaction('rw', db.workout_plans, async () => {
    const others = await db.workout_plans.filter(p => p.uuid !== uuid && p.is_active && !p._deleted).toArray();
    for (const p of others) {
      await db.workout_plans.update(p.uuid, { is_active: false, ...syncMeta() });
    }
    await db.workout_plans.update(uuid, { is_active: true, ...syncMeta() });
  });
  syncEngine.schedulePush();
}

export async function reorderPlans(orderedUuids: string[]): Promise<void> {
  // Caller passes the desired order; we rewrite order_index to match. Push
  // batch goes through schedulePush so the server sees one consistent push
  // for the whole reorder rather than N independent updates.
  await db.transaction('rw', db.workout_plans, async () => {
    for (let i = 0; i < orderedUuids.length; i++) {
      await db.workout_plans.update(orderedUuids[i], { order_index: i, ...syncMeta() });
    }
  });
  syncEngine.schedulePush();
}

// ─── Routines ────────────────────────────────────────────────────────────────

export async function createRoutine(opts: {
  workout_plan_uuid: string;
  title?: string | null;
  comment?: string | null;
}): Promise<string> {
  const id = genUUID();
  const max = await db.workout_routines.filter(r => r.workout_plan_uuid === opts.workout_plan_uuid && !r._deleted).count();
  const routine: LocalWorkoutRoutine = {
    uuid: id,
    workout_plan_uuid: opts.workout_plan_uuid,
    title: opts.title?.trim() || null,
    comment: opts.comment?.trim() || null,
    order_index: max,
    ...syncMeta(),
  };
  await db.workout_routines.add(routine);
  syncEngine.schedulePush();
  return id;
}

export async function updateRoutine(
  uuid: string,
  patch: { title?: string | null; comment?: string | null },
): Promise<void> {
  const changes: Partial<LocalWorkoutRoutine> = { ...syncMeta() };
  if (patch.title !== undefined) changes.title = patch.title?.trim() || null;
  if (patch.comment !== undefined) changes.comment = patch.comment?.trim() || null;
  await db.workout_routines.update(uuid, changes);
  syncEngine.schedulePush();
}

export async function deleteRoutine(uuid: string): Promise<void> {
  // Cascade through routine_exercises -> routine_sets.
  await db.transaction(
    'rw',
    [db.workout_routines, db.workout_routine_exercises, db.workout_routine_sets],
    async () => {
      const exercises = await db.workout_routine_exercises.where('workout_routine_uuid').equals(uuid).toArray();
      const exerciseUuids = exercises.map(e => e.uuid);
      if (exerciseUuids.length > 0) {
        await db.workout_routine_sets
          .where('workout_routine_exercise_uuid')
          .anyOf(exerciseUuids)
          .modify({ _deleted: true, _synced: false, _updated_at: now() });
        await db.workout_routine_exercises.where('uuid').anyOf(exerciseUuids).modify({
          _deleted: true, _synced: false, _updated_at: now(),
        });
      }
      await db.workout_routines.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
    },
  );
  syncEngine.schedulePush();
}

export async function reorderRoutines(planUuid: string, orderedUuids: string[]): Promise<void> {
  await db.transaction('rw', db.workout_routines, async () => {
    for (let i = 0; i < orderedUuids.length; i++) {
      const r = await db.workout_routines.get(orderedUuids[i]);
      if (r && r.workout_plan_uuid === planUuid) {
        await db.workout_routines.update(orderedUuids[i], { order_index: i, ...syncMeta() });
      }
    }
  });
  syncEngine.schedulePush();
}

// ─── Routine exercises ───────────────────────────────────────────────────────

export async function addRoutineExercise(opts: {
  workout_routine_uuid: string;
  exercise_uuid: string;
  comment?: string | null;
}): Promise<string> {
  const id = genUUID();
  const max = await db.workout_routine_exercises.filter(e => e.workout_routine_uuid === opts.workout_routine_uuid && !e._deleted).count();
  const re: LocalWorkoutRoutineExercise = {
    uuid: id,
    workout_routine_uuid: opts.workout_routine_uuid,
    exercise_uuid: opts.exercise_uuid.toLowerCase(),
    comment: opts.comment ?? null,
    order_index: max,
    ...syncMeta(),
  };
  await db.workout_routine_exercises.add(re);
  syncEngine.schedulePush();
  return id;
}

export async function updateRoutineExerciseComment(uuid: string, comment: string | null): Promise<void> {
  await db.workout_routine_exercises.update(uuid, { comment, ...syncMeta() });
  syncEngine.schedulePush();
}

export async function removeRoutineExercise(uuid: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.workout_routine_exercises, db.workout_routine_sets],
    async () => {
      await db.workout_routine_sets
        .where('workout_routine_exercise_uuid')
        .equals(uuid)
        .modify({ _deleted: true, _synced: false, _updated_at: now() });
      await db.workout_routine_exercises.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
    },
  );
  syncEngine.schedulePush();
}

export async function reorderRoutineExercises(routineUuid: string, orderedUuids: string[]): Promise<void> {
  await db.transaction('rw', db.workout_routine_exercises, async () => {
    for (let i = 0; i < orderedUuids.length; i++) {
      const e = await db.workout_routine_exercises.get(orderedUuids[i]);
      if (e && e.workout_routine_uuid === routineUuid) {
        await db.workout_routine_exercises.update(orderedUuids[i], { order_index: i, ...syncMeta() });
      }
    }
  });
  syncEngine.schedulePush();
}

// ─── Routine sets ────────────────────────────────────────────────────────────

export async function addRoutineSet(opts: {
  workout_routine_exercise_uuid: string;
  min_repetitions?: number | null;
  max_repetitions?: number | null;
  tag?: 'dropSet' | null;
  comment?: string | null;
}): Promise<string> {
  const id = genUUID();
  const max = await db.workout_routine_sets.filter(s => s.workout_routine_exercise_uuid === opts.workout_routine_exercise_uuid && !s._deleted).count();
  const set: LocalWorkoutRoutineSet = {
    uuid: id,
    workout_routine_exercise_uuid: opts.workout_routine_exercise_uuid,
    min_repetitions: opts.min_repetitions ?? null,
    max_repetitions: opts.max_repetitions ?? null,
    tag: opts.tag ?? null,
    comment: opts.comment ?? null,
    order_index: max,
    target_duration_seconds: null,
    ...syncMeta(),
  };
  await db.workout_routine_sets.add(set);
  syncEngine.schedulePush();
  return id;
}

export async function updateRoutineSet(
  uuid: string,
  patch: {
    min_repetitions?: number | null;
    max_repetitions?: number | null;
    tag?: 'dropSet' | null;
    comment?: string | null;
  },
): Promise<void> {
  const changes: Partial<LocalWorkoutRoutineSet> = { ...syncMeta() };
  if (patch.min_repetitions !== undefined) changes.min_repetitions = patch.min_repetitions;
  if (patch.max_repetitions !== undefined) changes.max_repetitions = patch.max_repetitions;
  if (patch.tag !== undefined) changes.tag = patch.tag;
  if (patch.comment !== undefined) changes.comment = patch.comment;
  await db.workout_routine_sets.update(uuid, changes);
  syncEngine.schedulePush();
}

export async function deleteRoutineSet(uuid: string): Promise<void> {
  await db.workout_routine_sets.update(uuid, { _deleted: true, _synced: false, _updated_at: now() });
  syncEngine.schedulePush();
}
