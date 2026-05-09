/**
 * Logged-set per-(exercise, muscle) contributor breakdown for the
 * /feed Volume Contributors drill-down (the "actual" view).
 *
 * Mirrors `computeMuscleContributors` in routine-projection.ts but consumes
 * Dexie's local mirror of `workouts`, `workout_exercises`, `workout_sets`,
 * and `exercises` instead of the routine config. Used by
 * VolumeContributorsSheet when launched from PriorityMusclesTile (or
 * MusclesThisWeek) to show "where did the 29 sets actually come from."
 *
 * Math is intentionally kept identical to volume-math's effectiveSetContribution
 * so the drill-down rows sum to the same number the headline tile shows.
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/local';
import { isoWeekStart } from './api/week-facts';
import { effectiveSetContribution } from './training/volume-math';

export interface LoggedMuscleContributor {
  /** Stable React key. */
  key: string;
  /** Workout date (YYYY-MM-DD local) — drives day_label. */
  date: string;
  /** Day label (workout title or computed). */
  day_label: string;
  exercise_uuid: string;
  exercise_title: string;
  role: 'primary' | 'secondary';
  /** Per-(exercise, muscle) secondary weight from secondary_weights, or
   *  null when role==='primary'. Falls back to 0.5 when null. */
  secondary_weight: number | null;
  set_count: number;
  effective_set_count: number;
  weight_source?: 'audited' | 'inferred' | 'default' | 'manual-override' | null;
}

/**
 * Live-query hook returning per-(workout, exercise) contributor rows for
 * the given muscle within the selected week (relative to current week).
 *
 * Returns undefined while loading; empty array when no contributors.
 */
export function useLoggedMuscleContributors(
  weekOffset: number | null,
  muscleSlug: string | null,
): LoggedMuscleContributor[] | undefined {
  return useLiveQuery(
    async () => {
      if (weekOffset == null || muscleSlug == null) return [];

      const isLateralVirtual = muscleSlug === 'delts_lateral';

      // Resolve week bounds from local time (Brisbane). The user-local
      // anchor avoids the Sunday-night-bucketing bug that hits server-TZ
      // computations.
      const now = new Date();
      const targetMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + weekOffset * 7);
      const weekStartIso = isoWeekStart(targetMonday);
      const weekStartDate = new Date(weekStartIso + 'T00:00:00');
      const weekEndDate = new Date(weekStartDate);
      weekEndDate.setDate(weekEndDate.getDate() + 7);

      // Wrap all four reads in a Dexie read transaction so we get a
      // consistent snapshot even while the sync engine writes in the
      // background. Without this, mid-flight writes can produce torn reads
      // (sets reference workout_exercises that no longer exist in the
      // loaded workouts array → contributors silently drop).
      const { workouts, workoutExercises, sets, exercises } = await db.transaction(
        'r',
        [db.workouts, db.workout_exercises, db.workout_sets, db.exercises],
        async () => {
          const workouts = await db.workouts
            .filter((w) => {
              if (w._deleted || w.is_current) return false;
              if (w.end_time == null) return false;
              const t = new Date(w.start_time);
              return t >= weekStartDate && t < weekEndDate;
            })
            .toArray();
          if (workouts.length === 0) return { workouts, workoutExercises: [], sets: [], exercises: [] };
          const workoutUuids = workouts.map((w) => w.uuid);

          const workoutExercises = await db.workout_exercises
            .where('workout_uuid')
            .anyOf(workoutUuids)
            .filter((we) => !we._deleted)
            .toArray();
          if (workoutExercises.length === 0) return { workouts, workoutExercises, sets: [], exercises: [] };
          const weUuids = workoutExercises.map((we) => we.uuid);

          const sets = await db.workout_sets
            .where('workout_exercise_uuid')
            .anyOf(weUuids)
            .filter((s) =>
              !s._deleted &&
              s.is_completed &&
              ((s.repetitions != null && s.repetitions >= 1) ||
                (s.duration_seconds != null && s.duration_seconds > 0)),
            )
            .toArray();
          if (sets.length === 0) return { workouts, workoutExercises, sets, exercises: [] };

          const exerciseUuids = Array.from(new Set(workoutExercises.map((we) => we.exercise_uuid)));
          const exercises = await db.exercises.where('uuid').anyOf(exerciseUuids).toArray();
          return { workouts, workoutExercises, sets, exercises };
        },
      );
      if (sets.length === 0) return [];

      const exerciseByUuid = new Map(exercises.map((e) => [e.uuid, e]));
      const weByUuid = new Map(workoutExercises.map((we) => [we.uuid, we]));
      const wByUuid = new Map(workouts.map((w) => [w.uuid, w]));

      // Aggregate per (workout, exercise) — multiple sets of the same
      // exercise in the same workout collapse into one row. Different
      // workouts of the same exercise stay as separate rows so cross-day
      // spillover surfaces in the sheet.
      type Bucket = {
        workoutUuid: string;
        exerciseUuid: string;
        date: string;
        dayLabel: string;
        setCount: number;
        effective: number;
        role: 'primary' | 'secondary';
        weight: number | null;
        title: string;
        weightSource: 'audited' | 'inferred' | 'default' | 'manual-override' | null;
      };
      const buckets = new Map<string, Bucket>();

      for (const set of sets) {
        const we = weByUuid.get(set.workout_exercise_uuid);
        if (!we) continue;
        const w = wByUuid.get(we.workout_uuid);
        if (!w) continue;
        const ex = exerciseByUuid.get(we.exercise_uuid);
        if (!ex) continue;

        // Determine role for the muscle on this exercise.
        let role: 'primary' | 'secondary' | null = null;
        let weight: number | null = null;
        if (isLateralVirtual) {
          if (ex.lateral_emphasis) role = 'primary';
          else continue;
        } else {
          if (ex.primary_muscles?.includes(muscleSlug)) {
            role = 'primary';
          } else if (ex.secondary_muscles?.includes(muscleSlug)) {
            role = 'secondary';
            weight = ex.secondary_weights?.[muscleSlug] ?? null;
          } else {
            continue;
          }
        }

        const credit = role === 'primary' ? null : weight;
        const effective = effectiveSetContribution(role, set.rir, credit);

        const key = `${w.uuid}-${ex.uuid}`;
        let b = buckets.get(key);
        if (!b) {
          const date = w.start_time.slice(0, 10);
          const dayLabel = w.title?.trim() || formatDateLabel(new Date(w.start_time));
          b = {
            workoutUuid: w.uuid,
            exerciseUuid: ex.uuid,
            date,
            dayLabel,
            setCount: 0,
            effective: 0,
            role,
            weight,
            title: ex.title,
            weightSource: ex.weight_source ?? null,
          };
          buckets.set(key, b);
        }
        b.setCount += 1;
        b.effective += effective;
      }

      return Array.from(buckets.values()).map<LoggedMuscleContributor>((b) => ({
        key: `${b.workoutUuid}-${b.exerciseUuid}`,
        date: b.date,
        day_label: b.dayLabel,
        exercise_uuid: b.exerciseUuid,
        exercise_title: b.title,
        role: b.role,
        secondary_weight: b.role === 'secondary' ? b.weight : null,
        set_count: b.setCount,
        effective_set_count: b.effective,
        weight_source: b.weightSource,
      }));
    },
    [weekOffset, muscleSlug],
    undefined,
  );
}

function formatDateLabel(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}
