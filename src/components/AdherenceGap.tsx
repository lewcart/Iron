'use client';

/**
 * AdherenceGap — /feed component that surfaces ROUTINE adherence (planned
 * vs delivered) WHEN safe-cap conditions are met, with date-shift goal-
 * timeline framing.
 *
 * Rules:
 *   - Only renders for priority muscles with 3+ consecutive shortfall weeks
 *   - Date-shift framing ("hip 100cm slips Jan→Mar") not "+N weeks"
 *   - Always carries low-confidence framing
 *   - Retrospective copy ("you've been delivering 57%") not prescription
 */

import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type LocalExercise } from '@/db/local';
import { useActivePlan } from '@/lib/useLocalDB-plans';
import { useActiveVision, useActivePlan as useActiveBodyPlan } from '@/lib/useLocalDB-strategy';
import { MUSCLE_DEFS, MUSCLE_SLUGS } from '@/lib/muscles';
import {
  projectWeeklyVolume,
  type ProjectionInputs,
} from '@/lib/training/routine-projection';
import {
  computeAdherence,
  deliveredFromSets,
  LOU_MUSCLE_TARGET_WEIGHTS,
  type AdherenceVerdict,
  type DeliveredWeek,
} from '@/lib/training/adherence-engine';
import type { SetForAggregation } from '@/lib/training/volume-math';

// ─── Hooks ──────────────────────────────────────────────────────────────

function useVisionOverrides(visionUuid: string | undefined | null) {
  return useLiveQuery(
    async () => {
      if (!visionUuid) return [];
      return db.vision_muscle_overrides
        .where('vision_uuid').equals(visionUuid)
        .filter((o) => !o._deleted)
        .toArray();
    },
    [visionUuid],
    [],
  );
}

function useActivePlanFull() {
  const activePlan = useActivePlan();
  return useLiveQuery(
    async () => {
      if (!activePlan) return undefined;
      const [routines, routineExercises, routineSets, exercises] = await Promise.all([
        db.workout_routines.filter(r => !r._deleted && r.workout_plan_uuid === activePlan.uuid).toArray(),
        db.workout_routine_exercises.filter(e => !e._deleted).toArray(),
        db.workout_routine_sets.filter(s => !s._deleted).toArray(),
        db.exercises.toArray(),
      ]);
      const exerciseByUuid = new Map(exercises.map(e => [e.uuid, e]));
      const setsByRE = new Map<string, typeof routineSets>();
      for (const s of routineSets) {
        if (!setsByRE.has(s.workout_routine_exercise_uuid)) setsByRE.set(s.workout_routine_exercise_uuid, []);
        setsByRE.get(s.workout_routine_exercise_uuid)!.push(s);
      }
      const exsByRoutine = new Map<string, Array<typeof routineExercises[0] & { sets: typeof routineSets; exercise: LocalExercise | undefined }>>();
      for (const re of routineExercises) {
        if (!exsByRoutine.has(re.workout_routine_uuid)) exsByRoutine.set(re.workout_routine_uuid, []);
        const sets = (setsByRE.get(re.uuid) ?? []).sort((a, b) => a.order_index - b.order_index);
        exsByRoutine.get(re.workout_routine_uuid)!.push({
          ...re,
          exercise: exerciseByUuid.get(re.exercise_uuid.toLowerCase()),
          sets,
        });
      }
      return {
        ...activePlan,
        routines: routines.sort((a, b) => a.order_index - b.order_index).map(r => ({
          ...r,
          exercises: (exsByRoutine.get(r.uuid) ?? []).sort((a, b) => a.order_index - b.order_index),
        })),
      };
    },
    [activePlan?.uuid],
  );
}

/**
 * Trailing N weeks of logged-set delivered volume from Dexie.
 * Returns newest-first list. Brisbane week boundary (ISO Monday).
 */
function useTrailingDeliveredWeeks(weeks: number = 4): DeliveredWeek[] | undefined {
  return useLiveQuery(
    async () => {
      const [workouts, workoutExercises, workoutSets, exercises] = await Promise.all([
        db.workouts.filter(w => !w._deleted && w.end_time != null && !w.is_current).toArray(),
        db.workout_exercises.filter(e => !e._deleted).toArray(),
        db.workout_sets.filter(s => !s._deleted && s.is_completed).toArray(),
        db.exercises.toArray(),
      ]);
      const exerciseByUuid = new Map(exercises.map(e => [e.uuid, e]));
      const weByUuid = new Map(workoutExercises.map(e => [e.uuid, e]));
      const wByUuid = new Map(workouts.map(w => [w.uuid, w]));

      // Compute Brisbane week boundaries (Mon 00:00) for the last N weeks.
      const now = new Date();
      const boundaries: Array<{ start: number; end: number; offset: number }> = [];
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      // Brisbane = UTC+10 always. Local Monday boundary.
      const localDay = (todayUTC.getUTCDay() + 6) % 7; // 0=Mon ... 6=Sun
      const thisWeekStartUTC = todayUTC.getTime() - localDay * 86_400_000 - 10 * 3_600_000;
      for (let i = 0; i < weeks; i++) {
        const weekStart = thisWeekStartUTC - i * 7 * 86_400_000;
        boundaries.push({
          start: weekStart,
          end: weekStart + 7 * 86_400_000,
          offset: -i,
        });
      }

      const out: DeliveredWeek[] = [];
      for (const b of boundaries) {
        const setsThisWeek: SetForAggregation[] = [];
        for (const s of workoutSets) {
          // Skip incomplete (no rep/duration content)
          const isWorking = (s.repetitions != null && s.repetitions >= 1) ||
                            (s.duration_seconds != null && s.duration_seconds > 0);
          if (!isWorking) continue;
          const we = weByUuid.get(s.workout_exercise_uuid);
          if (!we) continue;
          const w = wByUuid.get(we.workout_uuid);
          if (!w) continue;
          const startMs = Date.parse(w.start_time);
          if (Number.isNaN(startMs) || startMs < b.start || startMs >= b.end) continue;
          const ex = exerciseByUuid.get(we.exercise_uuid.toLowerCase());
          if (!ex) continue;
          setsThisWeek.push({
            set_uuid: s.uuid,
            rir: s.rir,
            weight: s.weight,
            repetitions: s.repetitions,
            primary_muscles: ex.primary_muscles ?? [],
            secondary_muscles: ex.secondary_muscles ?? [],
          });
        }
        out.push(deliveredFromSets(setsThisWeek, b.offset));
      }
      return out;
    },
    [weeks],
  );
}

// ─── Component ──────────────────────────────────────────────────────────

export function AdherenceGap() {
  const vision = useActiveVision();
  const plan = useActivePlanFull();
  const bodyPlan = useActiveBodyPlan();
  const overrides = useVisionOverrides(vision?.uuid);
  const trailingWeeks = useTrailingDeliveredWeeks(4);

  const verdict: AdherenceVerdict | undefined = useMemo(() => {
    if (!plan || !vision || !overrides || !trailingWeeks) return undefined;

    // Project planned volume from the active plan.
    const inputs: ProjectionInputs = {
      routines: plan.routines.map((r) => ({
        uuid: r.uuid,
        cycle_length_days: r.cycle_length_days,
        frequency_per_week: r.frequency_per_week,
        exercises: r.exercises.map((e) => ({
          uuid: e.uuid,
          exercise: e.exercise
            ? {
                uuid: e.exercise.uuid,
                primary_muscles: e.exercise.primary_muscles,
                secondary_muscles: e.exercise.secondary_muscles,
                lateral_emphasis: e.exercise.lateral_emphasis ?? false,
              }
            : undefined,
          sets: e.sets.map((s) => ({
            uuid: s.uuid,
            target_rir: s.target_rir,
            max_repetitions: s.max_repetitions,
            target_duration_seconds: s.target_duration_seconds,
          })),
        })),
      })),
      vision: vision ?? null,
      overrides: overrides.map((o) => ({
        muscle_slug: o.muscle_slug,
        override_sets_min: o.override_sets_min,
        override_sets_max: o.override_sets_max,
        override_freq_min: o.override_freq_min,
        evidence: o.evidence,
      })),
      muscleDefs: MUSCLE_SLUGS.map((slug) => ({
        slug,
        display_name: MUSCLE_DEFS[slug].display_name,
        optimal_sets_min: MUSCLE_DEFS[slug].optimal_sets_min,
        optimal_sets_max: MUSCLE_DEFS[slug].optimal_sets_max,
        display_order: MUSCLE_DEFS[slug].display_order,
      })),
    };
    const projected = projectWeeklyVolume(inputs);

    // Build target_dates from active body plan's north_star_metrics. If
    // body_plan isn't synced yet, this is empty and goal_impacts will be
    // empty too — adherence rows still render without date framing.
    const targetDates = new Map<string, string>();
    if (bodyPlan?.north_star_metrics) {
      for (const nsm of bodyPlan.north_star_metrics) {
        if (nsm.target_date) targetDates.set(nsm.metric_key, nsm.target_date);
      }
    }

    return computeAdherence({
      planned: projected,
      delivered_weeks: trailingWeeks,
      muscle_weights: LOU_MUSCLE_TARGET_WEIGHTS,
      target_dates: targetDates,
      plan_start_date: bodyPlan?.start_date ?? '2026-04-30',
    });
  }, [plan, vision, bodyPlan, overrides, trailingWeeks]);

  if (!verdict) return null;

  const warranting = verdict.rows.filter((r) => r.consequence_warranted);
  if (warranting.length === 0) return null; // silent when no panel warranted

  return (
    <div className="rounded-2xl bg-card border border-border shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Adherence gap</span>
        <span className="text-[10px] text-muted-foreground">low confidence</span>
      </div>

      <div className="space-y-2">
        {warranting.map((row) => (
          <div key={row.muscle_slug} className="text-sm space-y-0.5">
            <p className="text-foreground capitalize">
              <span className="text-rose-400 font-medium">{row.display_name}</span>
              {' '}
              <span className="text-muted-foreground">
                — planned {row.planned.toFixed(0)}/wk, delivered {row.delivered_avg.toFixed(0)}
                {' '}
                <span className="tabular-nums">({Math.round(row.adherence_pct * 100)}%, {row.consecutive_shortfall_weeks} weeks running)</span>
              </span>
            </p>
          </div>
        ))}
      </div>

      {verdict.goal_impacts.length > 0 && (
        <div className="rounded-md bg-rose-500/5 border border-rose-500/10 p-2.5 space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-rose-300/80 font-medium">
            If this 4-week pattern continues
          </p>
          {verdict.goal_impacts.map((impact) => (
            <p key={impact.metric_key} className="text-xs text-foreground">
              <span className="capitalize">{impact.metric_key.replace(/_/g, ' ')}</span>
              {': '}
              <span className="text-muted-foreground tabular-nums">
                {formatDate(impact.baseline_date)} → {formatDate(impact.projected_date)}
              </span>
              {' '}
              <span className="text-rose-400">(+{impact.slip_days}d)</span>
            </p>
          ))}
          <p className="text-[10px] text-muted-foreground pt-1">
            Based on dose-response averages and HRT context — your real response varies.
          </p>
        </div>
      )}
    </div>
  );
}

function formatDate(yyyymmdd: string): string {
  const [y, m] = yyyymmdd.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[Number(m) - 1] ?? '???'} ${y}`;
}
