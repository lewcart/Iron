/**
 * Pure volume-math primitives — the canonical TS source of truth for
 * primary/secondary credit, RIR weighting, and per-muscle aggregation.
 *
 * Two callers:
 *   1. The Postgres SQL in `src/db/queries.ts` (`getWeekSetsPerMuscle`) —
 *      logged-set path. Mirrors these rules in CTEs for performance.
 *   2. The TS routine projection (`src/lib/training/routine-projection.ts`) —
 *      planned-set path, runs against Dexie data.
 *
 * Conformance test (`volume-math.test.ts`) holds the SQL semantics and the
 * TS implementation byte-identical for the same fixture set.
 *
 * RIR (Reps in Reserve) weighting tiers — Lou-approved 2026-05-06 (TD2):
 *   RIR null  → 1.0   charitable default
 *   RIR 0–3   → 1.0   close to failure, full hypertrophy stimulus
 *   RIR 4     → 0.5   sub-stimulus, partial credit
 *   RIR 5     → 0.25  pump finishers — sub-stimulus but not zero (NEW)
 *   RIR 6+    → 0.0   warm-up territory
 *
 * Primary/secondary credit (RP/Helms convention):
 *   primary           → 1.0
 *   secondary-only    → 0.5
 *   in both arrays    → 1.0  (primary wins, no double-count)
 */

import { zoneFor as _zoneFor, mrvAt as _mrvAt, landmarkFor as _landmarkFor } from './volume-landmarks';
export type { Zone, Frequency, VolumeLandmark } from './volume-landmarks';
export const zoneFor = _zoneFor;
export const mrvAt = _mrvAt;
export const landmarkFor = _landmarkFor;

// ── RIR weighting ───────────────────────────────────────────────────────

/**
 * Map an RIR value (or null) to its hypertrophy-stimulus credit.
 *
 * Note: RIR 0 (failure) is NOT bonus-weighted above 1.0 — same hypertrophy
 * stimulus as RIR 1–3, extra fatigue cost. Don't "fix" upward.
 */
export function rirCredit(rir: number | null | undefined): number {
  if (rir == null) return 1.0;
  if (rir <= 3) return 1.0;
  if (rir === 4) return 0.5;
  if (rir === 5) return 0.25;
  return 0.0; // RIR 6+
}

// ── Primary/secondary credit ────────────────────────────────────────────

export type MuscleRole = 'primary' | 'secondary' | 'both';

/** Default secondary credit when no per-exercise weight is specified.
 *  Matches the original RP/Helms convention. v1.1 audited compounds replace
 *  this with per-(exercise, muscle) values via `exercises.secondary_weights`. */
export const DEFAULT_SECONDARY_WEIGHT = 0.5;

/**
 * Primary/secondary credit. When `secondaryWeight` is provided (per-exercise
 * audited value), it overrides the 0.5 default for the secondary case.
 * Primary credit is always 1.0 — the v1.1 catalog audit governs only
 * secondary credit, since primary muscles are by definition the prime mover.
 */
export function primarySecondaryCredit(role: MuscleRole, secondaryWeight?: number | null): number {
  if (role === 'secondary') {
    if (secondaryWeight != null && Number.isFinite(secondaryWeight) && secondaryWeight >= 0 && secondaryWeight <= 1) {
      return secondaryWeight;
    }
    return DEFAULT_SECONDARY_WEIGHT;
  }
  return 1.0;
}

// ── Per-set per-muscle contribution ─────────────────────────────────────

/**
 * Effective contribution from one (set, muscle) pair = primary/secondary
 * credit × RIR credit. Example: RDL @ RIR 4 with audited `secondary_weights`
 * = `{ glutes: 0.6 }` contributes 0.3 to glutes (secondary 0.6 × RIR 0.5)
 * and 0.5 to hamstrings (primary 1.0 × RIR 0.5).
 */
export function effectiveSetContribution(
  role: MuscleRole,
  rir: number | null | undefined,
  secondaryWeight?: number | null,
): number {
  return primarySecondaryCredit(role, secondaryWeight) * rirCredit(rir);
}

// ── Aggregation ─────────────────────────────────────────────────────────

export interface SetForAggregation {
  /** Stable identifier; multiple muscle hits from the same set still count
   *  as one toward `set_count`. */
  set_uuid: string;
  rir: number | null;
  weight: number | null;
  repetitions: number | null;
  /** Canonical muscle slugs. */
  primary_muscles: readonly string[];
  /** Canonical muscle slugs. */
  secondary_muscles: readonly string[];
  /** Per-(secondary muscle) credit weight 0.0-1.0 from
   *  `exercises.secondary_weights` (v1.1). When provided, overrides the
   *  flat 0.5 default for secondary muscles in this set's exercise. Null /
   *  undefined preserves the legacy 0.5 default. Primary muscles always
   *  count as 1.0 regardless. */
  secondary_weights?: Readonly<Record<string, number>> | null;
}

export interface MuscleAggregate {
  muscle_slug: string;
  /** Distinct sets touching this muscle (primary OR secondary). */
  set_count: number;
  /** Sum of (primary/secondary credit × RIR credit) over all hits. */
  effective_set_count: number;
  /** Sum of (weight × reps) over all sets touching this muscle (counted
   *  once per set even if the muscle is in both arrays). */
  kg_volume: number;
  /** Number of distinct days (set_uuid groupings can carry day metadata
   *  upstream; this aggregator does NOT compute days_touched — that's done
   *  by the projection layer with day-keyed sets). */
}

/**
 * Aggregate per-set per-muscle hits into per-muscle totals. Mirrors the
 * SQL CTEs in `getWeekSetsPerMuscle` (muscle_hits_raw → muscle_hits →
 * muscle_aggregate).
 *
 * Rules enforced:
 *   - A muscle in both `primary_muscles` and `secondary_muscles` is counted
 *     ONCE per set with credit = 1.0 (primary wins).
 *   - `set_count` counts distinct (set, muscle) pairs (i.e., raw hit count,
 *     same as SQL's COUNT(DISTINCT set_uuid) per muscle).
 *   - `kg_volume` requires both weight AND repetitions to be non-null.
 */
export function aggregateMuscleHits(sets: readonly SetForAggregation[]): MuscleAggregate[] {
  // Map<muscle_slug, { set_uuids: Set<string>, effective_sum: number, kg_sum: number }>
  const buckets = new Map<string, { setUuids: Set<string>; effective: number; kg: number }>();

  for (const set of sets) {
    // Compute the resolved role for each muscle in THIS set: primary wins
    // when a muscle is in both arrays.
    const primarySet = new Set(set.primary_muscles);
    const muscleRoles = new Map<string, MuscleRole>();
    for (const m of set.primary_muscles) muscleRoles.set(m, 'primary');
    for (const m of set.secondary_muscles) {
      if (!muscleRoles.has(m)) muscleRoles.set(m, 'secondary');
      // If already in primary, leave it as 'primary' — primary wins.
      else if (primarySet.has(m)) muscleRoles.set(m, 'primary');
    }

    const kgPerSet =
      set.weight != null && set.repetitions != null ? set.weight * set.repetitions : 0;

    for (const [muscle, role] of muscleRoles) {
      let bucket = buckets.get(muscle);
      if (!bucket) {
        bucket = { setUuids: new Set(), effective: 0, kg: 0 };
        buckets.set(muscle, bucket);
      }
      // Once per set (the Set<string> dedupes if a muscle somehow appears twice).
      if (!bucket.setUuids.has(set.set_uuid)) {
        bucket.setUuids.add(set.set_uuid);
        bucket.kg += kgPerSet;
      }
      // Per-exercise secondary weight (v1.1) overrides the flat 0.5 default
      // for secondary muscles. Primary credit ignores this value.
      const secondaryWeight = role === 'secondary' ? (set.secondary_weights?.[muscle] ?? null) : null;
      bucket.effective += effectiveSetContribution(role, set.rir, secondaryWeight);
    }
  }

  return Array.from(buckets.entries()).map(([slug, b]) => ({
    muscle_slug: slug,
    set_count: b.setUuids.size,
    effective_set_count: b.effective,
    kg_volume: b.kg,
  }));
}

// ── Frequency zone ──────────────────────────────────────────────────────

export type FrequencyZone = 'red' | 'yellow' | 'green';

export interface FrequencyFloor {
  /** Minimum days/week the muscle must be hit for productive hypertrophy. */
  min_freq: number;
  /** Optional preferred frequency — surpassed = green, between min and
   *  preferred = yellow, below min = red. When omitted, ≥min = green. */
  preferred_freq?: number;
  /** Confidence in the floor for this muscle. 'low' → UI shows asterisk. */
  evidence?: 'low' | 'medium' | 'high';
}

export function frequencyZone(daysTouched: number, floor: FrequencyFloor): FrequencyZone {
  if (daysTouched < floor.min_freq) return 'red';
  if (floor.preferred_freq != null && daysTouched < floor.preferred_freq) return 'yellow';
  return 'green';
}

/**
 * Default per-muscle frequency floors. Population-mean values; vision
 * overrides layer on top. Sources: Schoenfeld 2019 frequency meta + RP
 * 2025 + Helms convention. See plan's PR3 spec for justifications.
 *
 * Muscles not listed default to min_freq=2 (the population mean for
 * hypertrophy).
 */
export const DEFAULT_FREQUENCY_FLOORS: Readonly<Record<string, FrequencyFloor>> = {
  // Priority candidates for build_emphasis
  glutes:         { min_freq: 2, preferred_freq: 3 },
  delts:          { min_freq: 2, preferred_freq: 3 },
  delts_lateral:  { min_freq: 2, preferred_freq: 3, evidence: 'medium' },
  delts_anterior: { min_freq: 2, preferred_freq: 3, evidence: 'medium' },
  delts_posterior:{ min_freq: 2, preferred_freq: 3, evidence: 'medium' },
  hip_abductors:  { min_freq: 2, preferred_freq: 3, evidence: 'low' },
  hip_adductors:  { min_freq: 2 },
  core:           { min_freq: 3 },

  // Standard
  chest:        { min_freq: 1, preferred_freq: 2 },  // eccentric-damage, slower recovery
  lats:         { min_freq: 2 },
  rhomboids:    { min_freq: 2 },
  mid_traps:    { min_freq: 2 },
  lower_traps:  { min_freq: 2 },
  erectors:     { min_freq: 2 },
  rotator_cuff: { min_freq: 2 },
  biceps:       { min_freq: 2, preferred_freq: 3 },
  triceps:      { min_freq: 2, preferred_freq: 3 },
  forearms:     { min_freq: 2 },
  quads:        { min_freq: 2 },
  hamstrings:   { min_freq: 1, preferred_freq: 2 },  // eccentric-damage, slower recovery
  calves:       { min_freq: 3, preferred_freq: 4 },
};

// ── Vision-aware overrides ──────────────────────────────────────────────

export interface VisionMuscleOverride {
  muscle_slug: string;
  override_sets_min: number | null;
  override_sets_max: number | null;
  override_freq_min: number | null;
  evidence: 'low' | 'medium' | 'high' | null;
}

/**
 * Resolve volume range with vision override layered on top of muscle defaults.
 * Falls back to the provided defaults (typically `muscles.optimal_sets_min/max`)
 * when no override is set.
 */
export function resolveVolumeRange(
  muscleSlug: string,
  defaultMin: number,
  defaultMax: number,
  overrides: readonly VisionMuscleOverride[] = [],
): { min: number; max: number; overridden: boolean } {
  const override = overrides.find((o) => o.muscle_slug === muscleSlug);
  const min = override?.override_sets_min ?? defaultMin;
  const max = override?.override_sets_max ?? defaultMax;
  const overridden =
    override != null &&
    (override.override_sets_min != null || override.override_sets_max != null);
  return { min, max, overridden };
}

/**
 * Resolve frequency floor with vision override layered on top of defaults.
 */
export function resolveFrequencyFloor(
  muscleSlug: string,
  overrides: readonly VisionMuscleOverride[] = [],
): FrequencyFloor {
  const override = overrides.find((o) => o.muscle_slug === muscleSlug);
  const baseline = DEFAULT_FREQUENCY_FLOORS[muscleSlug] ?? { min_freq: 2 };
  if (override?.override_freq_min != null) {
    return {
      ...baseline,
      min_freq: override.override_freq_min,
      ...(override.evidence != null ? { evidence: override.evidence } : {}),
    };
  }
  return baseline;
}

// ── Volume zone (mirrors volume-landmarks `Zone`, but range-driven) ────

export type VolumeZone = 'zero' | 'under' | 'optimal' | 'over';

/**
 * Range-driven volume zone classifier — for muscles where MEV/MAV are
 * stored as min/max (the canonical `muscles.optimal_sets_min/max` shape).
 * Different from `zoneFor` in volume-landmarks.ts which uses RP's MV/MEV/
 * MAV.min/MAV.max/MRV taxonomy. Use this when the routine projection
 * needs a simple range-driven verdict; use `zoneFor` for /feed Week tile
 * compatibility.
 */
export function volumeZone(setCount: number, min: number, max: number): VolumeZone {
  if (setCount === 0) return 'zero';
  if (setCount < min) return 'under';
  if (setCount > max) return 'over';
  return 'optimal';
}
