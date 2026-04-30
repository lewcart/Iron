import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/db/local';
import {
  createPlan,
  updatePlanTitle,
  deletePlan,
  activatePlan,
  reorderPlans,
  createRoutine,
  deleteRoutine,
  addRoutineExercise,
  addRoutineSet,
  removeRoutineExercise,
  reorderRoutineExercises,
} from './mutations-plans';

// Mock the sync engine — schedulePush is fire-and-forget; tests verify Dexie
// state, not network behavior.
vi.mock('@/lib/sync', () => ({
  syncEngine: { schedulePush: vi.fn() },
}));

describe('mutations-plans', () => {
  beforeEach(async () => {
    await Promise.all([
      db.workout_plans.clear(),
      db.workout_routines.clear(),
      db.workout_routine_exercises.clear(),
      db.workout_routine_sets.clear(),
    ]);
  });

  describe('plans CRUD', () => {
    it('createPlan inserts with order_index = current count, _synced=false', async () => {
      const a = await createPlan({ title: 'Plan A' });
      const b = await createPlan({ title: 'Plan B' });

      const plans = await db.workout_plans.orderBy('order_index').toArray();
      expect(plans.map(p => p.uuid)).toEqual([a, b]);
      expect(plans[0].order_index).toBe(0);
      expect(plans[1].order_index).toBe(1);
      expect(plans[0]._synced).toBe(false);
      expect(plans[0].is_active).toBe(false);
    });

    it('updatePlanTitle trims and persists; null/empty strings normalize to null', async () => {
      const id = await createPlan({ title: 'Original' });
      await updatePlanTitle(id, '  New Title  ');
      let p = await db.workout_plans.get(id);
      expect(p!.title).toBe('New Title');

      await updatePlanTitle(id, '');
      p = await db.workout_plans.get(id);
      expect(p!.title).toBeNull();
    });

    it('deletePlan cascades soft-delete to routines, exercises, sets', async () => {
      const planId = await createPlan({ title: 'Cascade' });
      const routineId = await createRoutine({ workout_plan_uuid: planId, title: 'Push' });
      const reId = await addRoutineExercise({ workout_routine_uuid: routineId, exercise_uuid: 'ex-1' });
      const setId = await addRoutineSet({ workout_routine_exercise_uuid: reId, min_repetitions: 8, max_repetitions: 12 });

      await deletePlan(planId);

      // Every row in the subtree must be _deleted=true and _synced=false
      // so the next push tombstones the whole subtree.
      const plan = await db.workout_plans.get(planId);
      const routine = await db.workout_routines.get(routineId);
      const re = await db.workout_routine_exercises.get(reId);
      const set = await db.workout_routine_sets.get(setId);

      expect(plan!._deleted).toBe(true);
      expect(plan!._synced).toBe(false);
      expect(routine!._deleted).toBe(true);
      expect(routine!._synced).toBe(false);
      expect(re!._deleted).toBe(true);
      expect(re!._synced).toBe(false);
      expect(set!._deleted).toBe(true);
      expect(set!._synced).toBe(false);
    });

    it('activatePlan flips one active and deactivates all others atomically', async () => {
      const a = await createPlan({ title: 'A' });
      const b = await createPlan({ title: 'B' });
      const c = await createPlan({ title: 'C' });

      await activatePlan(a);
      await activatePlan(b); // switching active

      const plans = await db.workout_plans.toArray();
      const byUuid = new Map(plans.map(p => [p.uuid, p]));
      expect(byUuid.get(a)!.is_active).toBe(false);
      expect(byUuid.get(b)!.is_active).toBe(true);
      expect(byUuid.get(c)!.is_active).toBe(false);

      // Both touched plans must be unsynced for the next push to propagate
      // the deactivation alongside the activation.
      expect(byUuid.get(a)!._synced).toBe(false);
      expect(byUuid.get(b)!._synced).toBe(false);
    });

    it('reorderPlans rewrites order_index to match the requested order', async () => {
      const a = await createPlan({ title: 'A' });
      const b = await createPlan({ title: 'B' });
      const c = await createPlan({ title: 'C' });

      await reorderPlans([c, a, b]);

      const ordered = await db.workout_plans.orderBy('order_index').toArray();
      expect(ordered.map(p => p.uuid)).toEqual([c, a, b]);
      expect(ordered.map(p => p.order_index)).toEqual([0, 1, 2]);
    });
  });

  describe('routine + exercise + set CRUD', () => {
    it('createRoutine appends to a plan with order_index = current count', async () => {
      const planId = await createPlan({ title: 'Plan' });
      const r1 = await createRoutine({ workout_plan_uuid: planId, title: 'Push' });
      const r2 = await createRoutine({ workout_plan_uuid: planId, title: 'Pull' });

      const routines = await db.workout_routines.where('workout_plan_uuid').equals(planId).sortBy('order_index');
      expect(routines.map(r => r.uuid)).toEqual([r1, r2]);
      expect(routines[0].order_index).toBe(0);
      expect(routines[1].order_index).toBe(1);
    });

    it('addRoutineExercise lowercases exercise_uuid for case-stable lookups', async () => {
      const planId = await createPlan({});
      const routineId = await createRoutine({ workout_plan_uuid: planId });
      const reId = await addRoutineExercise({
        workout_routine_uuid: routineId,
        exercise_uuid: 'F5C74593-13F3-4BF7-877A-223CCD9395C7', // mixed case
      });

      const re = await db.workout_routine_exercises.get(reId);
      expect(re!.exercise_uuid).toBe('f5c74593-13f3-4bf7-877a-223ccd9395c7');
    });

    it('removeRoutineExercise cascades to its sets', async () => {
      const planId = await createPlan({});
      const routineId = await createRoutine({ workout_plan_uuid: planId });
      const reId = await addRoutineExercise({ workout_routine_uuid: routineId, exercise_uuid: 'ex-1' });
      const setA = await addRoutineSet({ workout_routine_exercise_uuid: reId });
      const setB = await addRoutineSet({ workout_routine_exercise_uuid: reId });

      await removeRoutineExercise(reId);

      const re = await db.workout_routine_exercises.get(reId);
      const sA = await db.workout_routine_sets.get(setA);
      const sB = await db.workout_routine_sets.get(setB);
      expect(re!._deleted).toBe(true);
      expect(sA!._deleted).toBe(true);
      expect(sB!._deleted).toBe(true);
    });

    it('deleteRoutine cascades through exercises -> sets', async () => {
      const planId = await createPlan({});
      const routineId = await createRoutine({ workout_plan_uuid: planId });
      const re1 = await addRoutineExercise({ workout_routine_uuid: routineId, exercise_uuid: 'ex-1' });
      const re2 = await addRoutineExercise({ workout_routine_uuid: routineId, exercise_uuid: 'ex-2' });
      const set1 = await addRoutineSet({ workout_routine_exercise_uuid: re1 });
      const set2 = await addRoutineSet({ workout_routine_exercise_uuid: re2 });

      await deleteRoutine(routineId);

      const r = await db.workout_routines.get(routineId);
      const e1 = await db.workout_routine_exercises.get(re1);
      const e2 = await db.workout_routine_exercises.get(re2);
      const s1 = await db.workout_routine_sets.get(set1);
      const s2 = await db.workout_routine_sets.get(set2);

      expect(r!._deleted).toBe(true);
      expect(e1!._deleted).toBe(true);
      expect(e2!._deleted).toBe(true);
      expect(s1!._deleted).toBe(true);
      expect(s2!._deleted).toBe(true);
    });

    it('reorderRoutineExercises only renumbers within the specified routine', async () => {
      const planId = await createPlan({});
      const r1 = await createRoutine({ workout_plan_uuid: planId, title: 'A' });
      const r2 = await createRoutine({ workout_plan_uuid: planId, title: 'B' });
      const a1 = await addRoutineExercise({ workout_routine_uuid: r1, exercise_uuid: 'ex-1' });
      const a2 = await addRoutineExercise({ workout_routine_uuid: r1, exercise_uuid: 'ex-2' });
      const b1 = await addRoutineExercise({ workout_routine_uuid: r2, exercise_uuid: 'ex-3' });

      // Swap order in r1 only.
      await reorderRoutineExercises(r1, [a2, a1]);

      const inR1 = await db.workout_routine_exercises.where('workout_routine_uuid').equals(r1).sortBy('order_index');
      const inR2 = await db.workout_routine_exercises.where('workout_routine_uuid').equals(r2).sortBy('order_index');

      expect(inR1.map(e => e.uuid)).toEqual([a2, a1]);
      expect(inR2.map(e => e.uuid)).toEqual([b1]); // untouched
      expect(inR2[0].order_index).toBe(0);
    });
  });
});
