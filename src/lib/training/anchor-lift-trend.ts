/**
 * Anchor-lift e1RM time series + week-over-week delta.
 *
 * REUSES `estimate1RM` from `src/lib/pr.ts` (Epley formula). Do not write a
 * new e1RM helper here.
 *
 * Inputs are deliberately raw (sets + workout date map) so the caller can
 * source them from Dexie or the server bundle interchangeably.
 */

import { estimate1RM } from '../pr';

export interface AnchorLiftSetInput {
  /** Working-set criteria from plan: is_completed=true AND repetitions>=1
   *  AND weight>0 AND NOT excluded_from_pb. Caller is responsible for
   *  filtering — we do it again defensively. */
  is_completed: boolean;
  /** True if Lou flagged this set as bad-form / partial. Excluded sets are
   *  skipped for trend points the same way pre-completed sets are skipped. */
  excluded_from_pb: boolean;
  repetitions: number | null;
  weight: number | null;
  /** workout_exercise_uuid — resolved to a date via the workouts map. */
  workout_exercise_uuid: string;
}

export interface AnchorLiftSessionPoint {
  /** YYYY-MM-DD of the workout this session represents. */
  date: string;
  /** Best (highest) e1RM observed in any working set on that date. */
  e1rm: number;
  /** The weight × reps that produced the e1rm — for sparkline tooltip. */
  best_weight: number;
  best_reps: number;
}

export type AnchorLiftTrend =
  | {
      status: 'ok';
      sessions: AnchorLiftSessionPoint[];
      /** Latest e1RM minus the earliest e1RM in the window (kg). */
      delta_kg: number;
      /** Same delta as a percentage of the earliest e1RM. */
      delta_pct: number;
    }
  | {
      status: 'needs-data';
      reason: string;
    };

/**
 * Build a per-anchor-lift e1RM trend from a flat list of sets and a map of
 * workout_exercise_uuid → date.
 *
 * Filtering: only rows where is_completed AND reps>=1 AND weight>0 are
 * considered. Each calendar date contributes ONE point — the highest e1RM
 * across all working sets on that date.
 *
 * Returns `needs-data` when fewer than `minSessions` sessions exist in the
 * window (default 3 — enough to draw a meaningful trend line).
 */
export function buildAnchorLiftTrend(
  sets: readonly AnchorLiftSetInput[],
  workoutExerciseDates: ReadonlyMap<string, string>,
  opts: { minSessions?: number; anchorDisplayName?: string } = {},
): AnchorLiftTrend {
  const minSessions = opts.minSessions ?? 3;

  // Group qualifying sets by date, keeping the best (highest e1rm) per date.
  const bestPerDate = new Map<string, AnchorLiftSessionPoint>();

  for (const s of sets) {
    if (!s.is_completed) continue;
    if (s.excluded_from_pb) continue;
    const reps = s.repetitions ?? 0;
    const weight = s.weight ?? 0;
    if (reps < 1 || weight <= 0) continue;

    const date = workoutExerciseDates.get(s.workout_exercise_uuid);
    if (!date) continue;
    const isoDate = date.slice(0, 10);

    const e1rm = estimate1RM(weight, reps);
    const existing = bestPerDate.get(isoDate);
    if (!existing || e1rm > existing.e1rm) {
      bestPerDate.set(isoDate, {
        date: isoDate,
        e1rm: Math.round(e1rm * 10) / 10,
        best_weight: weight,
        best_reps: reps,
      });
    }
  }

  const sessions = Array.from(bestPerDate.values()).sort((a, b) => a.date.localeCompare(b.date));

  if (sessions.length < minSessions) {
    const need = minSessions - sessions.length;
    // Short copy — must fit the right-hand column of the tile on a 375px
    // viewport (iPhone 13 mini) without truncating mid-word.
    return {
      status: 'needs-data',
      reason:
        sessions.length === 0
          ? `no recent log`
          : `${need} more session${need === 1 ? '' : 's'} needed`,
    };
  }

  const first = sessions[0].e1rm;
  const last = sessions[sessions.length - 1].e1rm;
  const delta_kg = Math.round((last - first) * 10) / 10;
  const delta_pct = first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : 0;

  return { status: 'ok', sessions, delta_kg, delta_pct };
}
