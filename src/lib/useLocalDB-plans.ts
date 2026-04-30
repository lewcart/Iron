'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/local';
import type {
  LocalWorkoutPlan,
  LocalWorkoutRoutine,
  LocalWorkoutRoutineExercise,
  LocalWorkoutRoutineSet,
  LocalExercise,
} from '@/db/local';

// Local-first hooks for the plans hierarchy. Mirrors the workout hook
// pattern in useLocalDB.ts: useLiveQuery returns reactively as Dexie
// changes. All hooks default to an empty array so first render is
// non-undefined and non-loading.

// ─── Compound types (joined views) ───────────────────────────────────────────

export type LocalRoutineSetEntry = LocalWorkoutRoutineSet;

export type LocalRoutineExerciseEntry = LocalWorkoutRoutineExercise & {
  exercise: LocalExercise | undefined;
  sets: LocalRoutineSetEntry[];
};

export type LocalRoutineWithExercises = LocalWorkoutRoutine & {
  exercises: LocalRoutineExerciseEntry[];
};

export type LocalPlanWithRoutines = LocalWorkoutPlan & {
  routines: LocalRoutineWithExercises[];
};

// ─── Plans (flat list) ──────────────────────────────────────────────────────

/** All non-deleted plans, ordered by order_index ascending. */
export function usePlans(): LocalWorkoutPlan[] {
  return useLiveQuery(
    () => db.workout_plans.filter(p => !p._deleted).sortBy('order_index'),
    [],
    [],
  );
}

/** Active plan, if any (mutually exclusive — at most one). */
export function useActivePlan(): LocalWorkoutPlan | undefined {
  return useLiveQuery(
    () => db.workout_plans.filter(p => p.is_active && !p._deleted).first(),
    [],
  );
}

/** Single plan by uuid. */
export function usePlan(uuid: string | null): LocalWorkoutPlan | undefined {
  return useLiveQuery(
    async () => (uuid ? db.workout_plans.get(uuid) : undefined),
    [uuid],
  );
}

// ─── Plans with full nesting (plan → routines → exercises → sets) ───────────

/**
 * Every plan with all its routines, each routine's exercises (joined to
 * exercise catalog), and each exercise's sets. This is what /plans page
 * renders.
 *
 * Performance note: this issues four bulk queries against Dexie tables
 * (one per level) and joins in-memory. For ~5 plans × ~5 routines ×
 * ~6 exercises × ~3 sets that's ~450 rows — sub-millisecond on Dexie.
 */
export function usePlansFull(): LocalPlanWithRoutines[] {
  return useLiveQuery(
    async () => {
      const [plans, routines, routineExercises, routineSets, exercises] = await Promise.all([
        db.workout_plans.filter(p => !p._deleted).sortBy('order_index'),
        db.workout_routines.filter(r => !r._deleted).toArray(),
        db.workout_routine_exercises.filter(e => !e._deleted).toArray(),
        db.workout_routine_sets.filter(s => !s._deleted).toArray(),
        db.exercises.toArray(),
      ]);

      const exerciseByUuid = new Map(exercises.map(e => [e.uuid, e]));

      const setsByRoutineExercise = new Map<string, LocalWorkoutRoutineSet[]>();
      for (const s of routineSets) {
        if (!setsByRoutineExercise.has(s.workout_routine_exercise_uuid)) {
          setsByRoutineExercise.set(s.workout_routine_exercise_uuid, []);
        }
        setsByRoutineExercise.get(s.workout_routine_exercise_uuid)!.push(s);
      }

      const exercisesByRoutine = new Map<string, LocalRoutineExerciseEntry[]>();
      for (const re of routineExercises) {
        if (!exercisesByRoutine.has(re.workout_routine_uuid)) {
          exercisesByRoutine.set(re.workout_routine_uuid, []);
        }
        const sets = (setsByRoutineExercise.get(re.uuid) ?? []).sort((a, b) => a.order_index - b.order_index);
        exercisesByRoutine.get(re.workout_routine_uuid)!.push({
          ...re,
          exercise: exerciseByUuid.get(re.exercise_uuid.toLowerCase()),
          sets,
        });
      }

      const routinesByPlan = new Map<string, LocalRoutineWithExercises[]>();
      for (const r of routines) {
        if (!routinesByPlan.has(r.workout_plan_uuid)) {
          routinesByPlan.set(r.workout_plan_uuid, []);
        }
        const planExercises = (exercisesByRoutine.get(r.uuid) ?? []).sort(
          (a, b) => a.order_index - b.order_index,
        );
        routinesByPlan.get(r.workout_plan_uuid)!.push({ ...r, exercises: planExercises });
      }

      return plans.map(p => {
        const planRoutines = (routinesByPlan.get(p.uuid) ?? []).sort(
          (a, b) => a.order_index - b.order_index,
        );
        return { ...p, routines: planRoutines };
      });
    },
    [],
    [],
  );
}

// ─── Routines (single-plan view) ────────────────────────────────────────────

export function useRoutines(planUuid: string | null): LocalWorkoutRoutine[] {
  return useLiveQuery(
    async () => {
      if (!planUuid) return [] as LocalWorkoutRoutine[];
      return db.workout_routines
        .where('workout_plan_uuid')
        .equals(planUuid)
        .filter(r => !r._deleted)
        .sortBy('order_index');
    },
    [planUuid],
    [],
  );
}

export function useRoutine(uuid: string | null): LocalWorkoutRoutine | undefined {
  return useLiveQuery(
    async () => (uuid ? db.workout_routines.get(uuid) : undefined),
    [uuid],
  );
}

// ─── Routine exercises ──────────────────────────────────────────────────────

export function useRoutineExercises(routineUuid: string | null): LocalRoutineExerciseEntry[] {
  return useLiveQuery(
    async () => {
      if (!routineUuid) return [] as LocalRoutineExerciseEntry[];
      const exercisesInRoutine = await db.workout_routine_exercises
        .where('workout_routine_uuid')
        .equals(routineUuid)
        .filter(e => !e._deleted)
        .sortBy('order_index');

      const exerciseUuids = exercisesInRoutine.map(re => re.exercise_uuid.toLowerCase());
      const catalog = await db.exercises.where('uuid').anyOf(exerciseUuids).toArray();
      const catalogByUuid = new Map(catalog.map(e => [e.uuid, e]));

      const reUuids = exercisesInRoutine.map(re => re.uuid);
      const setsForAll = reUuids.length > 0
        ? await db.workout_routine_sets.where('workout_routine_exercise_uuid').anyOf(reUuids).filter(s => !s._deleted).toArray()
        : [];
      const setsByRe = new Map<string, LocalWorkoutRoutineSet[]>();
      for (const s of setsForAll) {
        if (!setsByRe.has(s.workout_routine_exercise_uuid)) setsByRe.set(s.workout_routine_exercise_uuid, []);
        setsByRe.get(s.workout_routine_exercise_uuid)!.push(s);
      }

      return exercisesInRoutine.map(re => ({
        ...re,
        exercise: catalogByUuid.get(re.exercise_uuid.toLowerCase()),
        sets: (setsByRe.get(re.uuid) ?? []).sort((a, b) => a.order_index - b.order_index),
      }));
    },
    [routineUuid],
    [],
  );
}

// ─── Routine sets ───────────────────────────────────────────────────────────

export function useRoutineSets(routineExerciseUuid: string | null): LocalWorkoutRoutineSet[] {
  return useLiveQuery(
    async () => {
      if (!routineExerciseUuid) return [] as LocalWorkoutRoutineSet[];
      return db.workout_routine_sets
        .where('workout_routine_exercise_uuid')
        .equals(routineExerciseUuid)
        .filter(s => !s._deleted)
        .sortBy('order_index');
    },
    [routineExerciseUuid],
    [],
  );
}
