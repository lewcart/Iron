/**
 * Week-page fact merger.
 *
 * Source-of-truth shape consumed by `resolveWeekTiles()`. Composes
 * Dexie-backed local data (bodyweight, vision, this-week sets) with
 * server-bundle data (`/api/feed` summary + `/api/health/snapshot`) into a
 * single typed object.
 *
 * Pure data type — no React, no fetching. The Week page composes hooks +
 * passes the result here for resolution.
 *
 * Timezone convention: every "week start" / "today" / "day-of-week"
 * computation in this module and in feed/page.tsx uses the *local*
 * timezone (which for this single-user app is Australia/Brisbane — see
 * CLAUDE.md "Sleep workflow"). This was inconsistent in earlier drafts:
 * `isoWeekStart` was computed in UTC while feed/page.tsx used local
 * `setHours(0,0,0,0)` for the same week-start. Near midnight that
 * disagreed (one source said this week, the other still said last week).
 * All 5 sites now agree on local time.
 */

import type { SetsByMuscleRow } from './feed-types';
import type { CatalogExercise, ExerciseLogSignal } from '../training/anchor-lifts';
import type { HrvDailyPoint } from '../training/hrv-balance';

export interface WeekFactsBodyweightPoint {
  /** YYYY-MM-DD logged_at date. */
  date: string;
  /** Weight in kg. */
  weight: number;
}

export interface WeekFactsAnchorSetInput {
  exercise_uuid: string;
  workout_exercise_uuid: string;
  is_completed: boolean;
  /** True if Lou flagged this set as bad-form / partial. Excluded sets stay
   *  in workout history but never anchor a PB or e1RM trend point. */
  excluded_from_pb: boolean;
  weight: number | null;
  repetitions: number | null;
  rir: number | null;
  /** YYYY-MM-DD of the workout this set belongs to. */
  workout_date: string;
}

export interface WeekFactsVision {
  build_emphasis: string[];
  deemphasize: string[];
}

export interface WeekFactsRecovery {
  status: 'connected' | 'not_connected' | 'unknown';
  /** Daily HRV samples covering the baseline window. */
  hrv_daily: HrvDailyPoint[];
  /** Most recent night sleep summary (if available). */
  last_night_sleep: {
    date: string;
    asleep_min: number | null;
    in_bed_min: number | null;
  } | null;
  /** Sleep window mean from the API (averaged over 7 nights), if computed. */
  sleep_avg_min_7d: number | null;
  /** 28-day baseline mean sleep, for comparison. */
  sleep_baseline_min_28d: number | null;
  /** Number of nights with sleep data in last 7. */
  sleep_nights_7d: number;
}

export interface WeekFacts {
  /** ISO YYYY-MM-DD for this week's Monday. */
  week_start: string;
  /** ISO YYYY-MM-DD for the reference "today". */
  today: string;
  /** Day-of-week 1..7 (Mon=1, Sun=7). */
  day_of_week: number;

  /** Per-muscle weekly volume from /api/feed. Empty array when not loaded. */
  setsByMuscle: SetsByMuscleRow[];

  /** All RIR values logged this week, plus the count of working sets. Used
   *  by Tile 2 (effective-set quality). */
  rirThisWeek: {
    /** Number of working sets this week (RIR-relevant set total). */
    total_sets: number;
    /** Number of working sets with RIR logged. */
    rir_logged_sets: number;
    /** Number of working sets at RIR ≤ 3 (stimulating). */
    rir_quality_sets: number;
  };

  /** Per-week aggregates used for Tile 2's 8-week sparkline. */
  rirByWeek: { week_start: string; quality_pct: number; n_sets: number }[];

  /** Catalog exercises (Dexie). Used to resolve anchor lifts. */
  catalog: CatalogExercise[];

  /** Anchor-lift sets covering the trend window (last ~8 weeks). */
  anchorSets: WeekFactsAnchorSetInput[];

  /** Per-exercise log signal (last ~8 weeks) used by the anchor-lift
   *  resolver to prefer exercises Lou actually trains. Empty array means
   *  the resolver falls back to substring matching. */
  exerciseLogSignals: ExerciseLogSignal[];

  /** Bodyweight points sorted ASC by date, last ~14 days. */
  bodyweight: WeekFactsBodyweightPoint[];

  /** Recovery / HealthKit-derived facts. */
  recovery: WeekFactsRecovery;

  /** Vision (priority muscles). null when no active vision. */
  vision: WeekFactsVision | null;

  /** Number of distinct strength sessions logged this week — used to pick
   *  the binding MRV column for each muscle. */
  sessions_this_week: number;

  /** Number of distinct strength sessions in the rolling last-14-day window.
   *  Drives the RIR-quality "wait" gate: tile 2 stays silent (or shows a
   *  muted "waiting for more sessions" line) until ≥3 sessions exist. */
  sessions_last_14d: number;
}

/** Returns the YYYY-MM-DD for the Monday of the ISO week containing `date`,
 *  computed in the LOCAL timezone (Australia/Brisbane for this single-user app).
 *  Uses local time to stay consistent with the rest of feed/page.tsx,
 *  which uses `setHours(0,0,0,0)` (local) for week boundaries. Using UTC
 *  here previously caused near-midnight disagreement with those sites. */
export function isoWeekStart(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay(); // 0=Sun..6=Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + mondayOffset);
  return localIsoDate(d);
}

/** Day-of-week 1..7 (Mon=1, Sun=7) for `date` in LOCAL timezone. */
export function isoDayOfWeek(date: Date): number {
  const dow = date.getDay();
  return dow === 0 ? 7 : dow;
}

/** YYYY-MM-DD for `date` in LOCAL timezone (avoids `toISOString().slice(0,10)`
 *  which silently shifts to UTC near midnight). */
function localIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Empty WeekFacts shell — used as a placeholder while fetches are in flight. */
export function emptyWeekFacts(now: Date = new Date()): WeekFacts {
  return {
    week_start: isoWeekStart(now),
    today: localIsoDate(now),
    day_of_week: isoDayOfWeek(now),
    setsByMuscle: [],
    rirThisWeek: { total_sets: 0, rir_logged_sets: 0, rir_quality_sets: 0 },
    rirByWeek: [],
    catalog: [],
    anchorSets: [],
    exerciseLogSignals: [],
    bodyweight: [],
    recovery: {
      status: 'unknown',
      hrv_daily: [],
      last_night_sleep: null,
      sleep_avg_min_7d: null,
      sleep_baseline_min_28d: null,
      sleep_nights_7d: 0,
    },
    vision: null,
    sessions_this_week: 0,
    sessions_last_14d: 0,
  };
}
