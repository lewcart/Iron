/**
 * Adherence engine — compares planned weekly volume (from active plan
 * projection) against trailing-week delivered volume (from logged data),
 * surfaces an "ADHERENCE GAP" verdict ONLY when the safe-cap conditions
 * are met, and projects goal-timeline consequences in date-shift terms.
 *
 * Hard caps Lou specified to prevent catastrophizing:
 *   - 3+ weeks of <80% adherence on the SAME priority muscle
 *   - The muscle must be in vision.build_emphasis
 *   - Single bad week → no consequence framing, raw stats only
 *
 * Don't double-prescribe with /feed prescription engine. This is
 * RETROSPECTIVE ("you've delivered 57% — here's what continues if it
 * doesn't change"); /feed is PROSPECTIVE ("PUSH glutes +2 next week").
 */

import { aggregateMuscleHits, type SetForAggregation } from './volume-math';
import type { ProjectedSetsByMuscleRow } from './routine-projection';

// ─── Public API ────────────────────────────────────────────────────────

export interface DeliveredWeek {
  /** Week offset (0=current, -1=last week). */
  week_offset: number;
  /** Per-muscle effective set count this week. */
  by_muscle: ReadonlyMap<string, number>;
}

export interface MuscleTargetWeight {
  /** Canonical or virtual muscle slug. */
  muscle_slug: string;
  /** Weighted contributions to headline targets. Sum across muscles
   *  doesn't have to total to 1.0 — these are per-muscle elasticities. */
  contributes_to: ReadonlyArray<{
    /** Headline metric_key from active plan's north_star_metrics. */
    metric_key: string;
    /** Approximate elasticity: 1.0 = full credit, 0.5 = half, etc.
     *  Rough by Lou's permission — better than nothing. */
    weight: number;
  }>;
}

export interface AdherenceConfig {
  /** Minimum trailing weeks below threshold before consequence framing
   *  fires. Default 3. */
  min_window_weeks: number;
  /** Adherence ratio below which a week counts as "shortfall." Default 0.8. */
  shortfall_threshold: number;
  /** Multiplier applied to consequence calculations on HRT (Lou ≈1.3-1.5x).
   *  1.0 = off. */
  hrt_compounding_multiplier: number;
}

export const DEFAULT_ADHERENCE_CONFIG: AdherenceConfig = {
  min_window_weeks: 3,
  shortfall_threshold: 0.8,
  hrt_compounding_multiplier: 1.4,
};

export interface AdherenceVerdictRow {
  muscle_slug: string;
  display_name: string;
  /** Planned weekly effective set count from active routine projection. */
  planned: number;
  /** Trailing N-week average delivered effective set count. */
  delivered_avg: number;
  /** Adherence ratio: delivered / planned (clamped 0–1.5 for sanity). */
  adherence_pct: number;
  /** Number of consecutive weeks with adherence < threshold (back from
   *  current week). 0 if none. */
  consecutive_shortfall_weeks: number;
  /** True if rendering the consequence panel is warranted. Cheap predicate
   *  for the UI: if false, the row should NOT show date-shift framing. */
  consequence_warranted: boolean;
  /** Per-muscle contribution-weighted effective shortfall (sets/week). */
  effective_shortfall_per_week: number;
}

export interface GoalTimelineImpact {
  metric_key: string;
  /** Originally projected completion date. */
  baseline_date: string;
  /** Adjusted date if shortfall pattern persists 4 more weeks. */
  projected_date: string;
  /** Slip in days (positive = later than baseline). */
  slip_days: number;
  /** Confidence — always 'low' until per-muscle elasticity model has more data. */
  confidence: 'low';
}

export interface AdherenceVerdict {
  rows: AdherenceVerdictRow[];
  /** Aggregated date-shift consequences across all warranting muscles.
   *  Each entry projects what happens if THE PATTERN continues 4 more weeks. */
  goal_impacts: GoalTimelineImpact[];
}

export interface AdherenceInputs {
  /** Per-priority-muscle planned weekly volume (subset of projection rows). */
  planned: ReadonlyArray<Pick<ProjectedSetsByMuscleRow, 'slug' | 'display_name' | 'effective_set_count' | 'is_priority'>>;
  /** Trailing weeks of delivered volume, newest first (week 0 = current). */
  delivered_weeks: ReadonlyArray<DeliveredWeek>;
  /** Per-muscle weight toward each headline target. */
  muscle_weights: ReadonlyArray<MuscleTargetWeight>;
  /** Active plan target dates, keyed by metric_key. */
  target_dates: ReadonlyMap<string, string>;
  /** Plan start_date — used to compute baseline rate. */
  plan_start_date: string;
  config?: Partial<AdherenceConfig>;
}

// ─── Implementation ────────────────────────────────────────────────────

/**
 * Compute the per-priority-muscle adherence verdict + goal-timeline
 * consequence impacts.
 */
export function computeAdherence(inputs: AdherenceInputs): AdherenceVerdict {
  const cfg: AdherenceConfig = { ...DEFAULT_ADHERENCE_CONFIG, ...(inputs.config ?? {}) };
  const rows: AdherenceVerdictRow[] = [];

  // Only process priority muscles — adherence verdict is silent on
  // non-priority muscles (per scope: "non-priority slipping doesn't move
  // the headline").
  for (const planned of inputs.planned) {
    if (!planned.is_priority) continue;
    if (planned.effective_set_count <= 0) continue;

    // Trailing weeks of delivered for this muscle (sorted newest first).
    const weeks = inputs.delivered_weeks.map(
      (w) => w.by_muscle.get(planned.slug) ?? 0,
    );

    const deliveredAvg = weeks.length > 0
      ? weeks.reduce((a, b) => a + b, 0) / weeks.length
      : 0;
    const adherence = clamp01p5(deliveredAvg / planned.effective_set_count);

    // Count consecutive shortfall weeks back from week 0 (current).
    let consecutive = 0;
    for (const wkSets of weeks) {
      const wkAdherence = wkSets / planned.effective_set_count;
      if (wkAdherence < cfg.shortfall_threshold) consecutive++;
      else break;
    }

    const consequenceWarranted =
      consecutive >= cfg.min_window_weeks &&
      planned.effective_set_count > 0;

    const effectiveShortfall = Math.max(0, planned.effective_set_count - deliveredAvg);

    rows.push({
      muscle_slug: planned.slug,
      display_name: planned.display_name,
      planned: planned.effective_set_count,
      delivered_avg: deliveredAvg,
      adherence_pct: adherence,
      consecutive_shortfall_weeks: consecutive,
      consequence_warranted: consequenceWarranted,
      effective_shortfall_per_week: effectiveShortfall,
    });
  }

  // Goal-timeline impacts. Aggregate across warranting muscles weighted by
  // contribution-to-target.
  const goalImpacts = computeGoalTimelineImpacts(rows, inputs, cfg);

  return { rows, goal_impacts: goalImpacts };
}

// ─── Goal-timeline projection ──────────────────────────────────────────

function computeGoalTimelineImpacts(
  rows: ReadonlyArray<AdherenceVerdictRow>,
  inputs: AdherenceInputs,
  cfg: AdherenceConfig,
): GoalTimelineImpact[] {
  const warranting = rows.filter((r) => r.consequence_warranted);
  if (warranting.length === 0) return [];

  // Aggregate per metric_key: sum (muscle's contribution × shortfall ratio).
  // Each warranting muscle hits its weighted targets proportional to
  // (1 - adherence_pct).
  const shortfallByMetric = new Map<string, number>();
  for (const row of warranting) {
    const muscleW = inputs.muscle_weights.find((m) => m.muscle_slug === row.muscle_slug);
    if (!muscleW) continue;
    const stimulusShortfall = 1 - row.adherence_pct; // 0..1
    for (const c of muscleW.contributes_to) {
      const prev = shortfallByMetric.get(c.metric_key) ?? 0;
      shortfallByMetric.set(c.metric_key, prev + c.weight * stimulusShortfall);
    }
  }

  const impacts: GoalTimelineImpact[] = [];
  for (const [metric_key, aggShortfall] of shortfallByMetric) {
    const targetDate = inputs.target_dates.get(metric_key);
    if (!targetDate) continue;

    // Apply HRT compounding multiplier: shortfall hurts harder on HRT
    // because MPS ceiling is lower (Lou plan note).
    const compounded = Math.min(0.95, aggShortfall * cfg.hrt_compounding_multiplier);

    // Rate slip translates to date slip. We treat the slip as
    // proportional to TOTAL plan horizon — a 13% rate shortfall over
    // the remaining time pushes the completion date out by ~13% of
    // remaining months, conservatively assumed to be 4 weeks of pattern
    // continuation.
    //
    // Rough math by Lou's permission: hold the horizon shortfall to ~4
    // weeks to bound catastrophizing. If the pattern persists longer
    // the compute would scale linearly — but for the consequence panel
    // we project "if this 4-week pattern continues 4 more weeks."
    const remainingDaysAtBaseline = daysBetween(new Date().toISOString().slice(0, 10), targetDate);
    if (remainingDaysAtBaseline <= 0) continue; // already past target — different problem

    // 4 weeks of pattern × shortfall = projected slip
    const slipDays = Math.round(28 * compounded);

    impacts.push({
      metric_key,
      baseline_date: targetDate,
      projected_date: addDays(targetDate, slipDays),
      slip_days: slipDays,
      confidence: 'low',
    });
  }

  // Sort by largest slip first so the UI surfaces worst case top.
  impacts.sort((a, b) => b.slip_days - a.slip_days);
  return impacts;
}

// ─── Default per-muscle target contribution model ─────────────────────

/**
 * Lou-specific muscle → target elasticity table. Rough by design:
 * better than nothing. Update once we have per-muscle InBody-segment
 * trend data.
 *
 * Elasticities are "fraction of this target's monthly delta attributable
 * to this muscle's stimulus." They don't have to sum to 1.0 — gains
 * also come from compound work, HRT-driven redistribution, etc.
 */
export const LOU_MUSCLE_TARGET_WEIGHTS: ReadonlyArray<MuscleTargetWeight> = [
  {
    muscle_slug: 'glutes',
    contributes_to: [
      { metric_key: 'hip_circumference_cm', weight: 0.4 },
      { metric_key: 'smm_kg', weight: 0.25 },
      { metric_key: 'whr', weight: 0.2 },
    ],
  },
  {
    muscle_slug: 'delts_lateral',
    contributes_to: [
      { metric_key: 'shoulder_width_cm', weight: 0.6 },
      { metric_key: 'shoulder_circumference_cm', weight: 0.5 },
      { metric_key: 'smm_kg', weight: 0.15 },
    ],
  },
  {
    muscle_slug: 'hip_abductors',
    contributes_to: [
      { metric_key: 'hip_circumference_cm', weight: 0.2 },
      { metric_key: 'whr', weight: 0.15 },
    ],
  },
  {
    muscle_slug: 'core',
    contributes_to: [
      { metric_key: 'smm_kg', weight: 0.05 },
    ],
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────

function clamp01p5(v: number): number {
  if (Number.isNaN(v) || !Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1.5) return 1.5;
  return v;
}

/** Days between two YYYY-MM-DD dates (inclusive of fractional UTC days). */
function daysBetween(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  return Math.round((toMs - fromMs) / 86_400_000);
}

/** YYYY-MM-DD + N days. */
function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

// ─── Trailing-week aggregation from Dexie sets ─────────────────────────

/**
 * Compute per-muscle weekly effective set count from a flat list of
 * logged sets that happened in a specific week. Mirrors the SQL in
 * getWeekSetsPerMuscle but driven from Dexie rows.
 *
 * Caller is responsible for pre-filtering sets to the week.
 */
export function deliveredFromSets(
  sets: ReadonlyArray<SetForAggregation>,
  weekOffset: number,
): DeliveredWeek {
  const aggregates = aggregateMuscleHits(sets);
  const byMuscle = new Map<string, number>();
  for (const a of aggregates) byMuscle.set(a.muscle_slug, a.effective_set_count);
  return { week_offset: weekOffset, by_muscle: byMuscle };
}
