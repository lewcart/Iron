/**
 * Routine volume projection — given a plan's routines (= "days"),
 * project per-muscle weekly set count + RIR-adjusted effective volume +
 * frequency + zones, against vision overrides + canonical MEV/MAV.
 *
 * Inputs:
 *   - plan: LocalPlanWithRoutines (the active plan with all days nested)
 *   - vision: LocalBodyVision | null (provides build_emphasis priority list)
 *   - overrides: LocalVisionMuscleOverride[] (per-vision MAV / freq overrides)
 *   - muscleDefs: muscle slugs → display_name + optimal_sets_min/max
 *
 * Output: ProjectedSetsByMuscleRow[] — one row per touched muscle PLUS
 * one row per priority muscle even if it's untouched (so the UI can show
 * 0-set warnings on priority slots). Sorted: priorities first by
 * build_emphasis_rank, then non-priorities by display_order.
 *
 * Special handling:
 *   - delts_lateral virtual sub-muscle row, derived from sets touching
 *     exercises with lateral_emphasis=true. Plumbed when build_emphasis
 *     contains delts_lateral OR an override exists for it.
 *   - Confidence enum surfaces uncertainty:
 *       'confident'         — RIR populated on all working sets, freq known
 *       'uncertain_rir'     — some sets missing target_rir
 *       'uncertain_freq'    — cycle_length_days unset, frequency assumed weekly
 *       'uncertain_subgroup'— delts overall optimal but lateral undertrained
 *   - Range/frequency overrides: glutes 14-26, lateral_delts 8-16, etc
 *     (Lou's vision per TD3 — applied via vision_muscle_overrides).
 */

import type { LocalBodyVision } from '@/db/local';
import {
  aggregateMuscleHits,
  effectiveSetContribution,
  resolveVolumeRange,
  resolveFrequencyFloor,
  volumeZone,
  frequencyZone,
  type SetForAggregation,
  type VisionMuscleOverride,
  type VolumeZone,
  type FrequencyZone,
} from './volume-math';

// ─── Public API ────────────────────────────────────────────────────────

export type ProjectionConfidence =
  | 'confident'
  | 'uncertain_rir'
  | 'uncertain_freq'
  | 'uncertain_subgroup';

export interface ProjectedSetsByMuscleRow {
  /** Canonical slug OR virtual sub-muscle slug like 'delts_lateral'. */
  slug: string;
  /** Display label. Defaults to slug if not in muscleDefs. */
  display_name: string;
  /** Distinct routine sets crediting this muscle (raw hit count). */
  set_count: number;
  /** RIR-weighted, primary/secondary-credit-weighted effective sets/wk. */
  effective_set_count: number;
  /** Routines that credit this muscle at least once (= "days/wk" floor). */
  days_touched: number;
  /** Effective frequency × per week, accounting for cycle_length_days. */
  weekly_frequency: number;
  /** Resolved volume range for this muscle (vision override or default). */
  range_min: number;
  range_max: number;
  /** True if a vision override is in effect for this muscle. */
  range_overridden: boolean;
  /** Resolved minimum frequency floor (vision override or default). */
  freq_min: number;
  /** Volume zone — under/optimal/over/zero. */
  volume_zone: VolumeZone;
  /** Frequency zone — red/yellow/green. */
  frequency_zone: FrequencyZone;
  /** Composite zone — worst-of(volume, frequency, confidence). The verdict
   *  glyph the UI renders comes from this single value. */
  verdict: 'green' | 'yellow' | 'red' | 'uncertain';
  /** Names the binding constraint that determined the verdict. */
  binding_constraint: 'volume' | 'frequency' | 'confidence' | 'optimal';
  /** Confidence in the projection. */
  confidence: ProjectionConfidence;
  /** True if muscle is in vision.build_emphasis. */
  is_priority: boolean;
  /** Rank within build_emphasis (0-indexed); null if not priority. */
  build_emphasis_rank: number | null;
  /** Evidence flag from override (e.g., 'low' for hip abductors). */
  evidence: 'low' | 'medium' | 'high' | null;
}

export interface ProjectionInputs {
  /** "Days" of the plan — each one is a routine row with exercises + sets. */
  routines: ReadonlyArray<{
    uuid: string;
    cycle_length_days: number | null;
    frequency_per_week: number | null;
    exercises: ReadonlyArray<{
      uuid: string;
      exercise: {
        uuid: string;
        primary_muscles: string[];
        secondary_muscles: string[];
        lateral_emphasis: boolean;
        /** Per-(secondary muscle) credit weight 0.0-1.0. Null = use 0.5 default. */
        secondary_weights?: Record<string, number> | null;
      } | undefined;
      sets: ReadonlyArray<{
        uuid: string;
        target_rir: number | null;
        max_repetitions?: number | null;
        target_duration_seconds?: number | null;
      }>;
    }>;
  }>;
  vision: Pick<LocalBodyVision, 'build_emphasis'> | null;
  overrides: ReadonlyArray<VisionMuscleOverride>;
  muscleDefs: ReadonlyArray<{
    slug: string;
    display_name: string;
    optimal_sets_min: number;
    optimal_sets_max: number;
    display_order: number;
  }>;
}

// ─── Implementation ────────────────────────────────────────────────────

const DELTS_LATERAL = 'delts_lateral';

/**
 * Project the routine's weekly per-muscle volume.
 */
export function projectWeeklyVolume(
  inputs: ProjectionInputs,
): ProjectedSetsByMuscleRow[] {
  const { routines, vision, overrides, muscleDefs } = inputs;

  // 1. Resolve weekly multiplier — frequency_per_week wins; else
  //    7 / cycle_length_days; else 1 (assume weekly).
  //    Take the FIRST routine's settings (a plan typically uses the same
  //    cycle for all days). If different, this is a known limitation.
  const firstRoutine = routines[0];
  const weeksPerCycle =
    firstRoutine?.frequency_per_week != null
      ? firstRoutine.frequency_per_week
      : firstRoutine?.cycle_length_days != null && firstRoutine.cycle_length_days > 0
        ? 7 / firstRoutine.cycle_length_days
        : 1;
  const cycleAssumed = !(
    firstRoutine?.frequency_per_week != null || firstRoutine?.cycle_length_days != null
  );

  // 2. Build per-day, per-(set, muscle) hits. Two passes: standard
  //    (canonical muscle slugs from primary/secondary arrays) and
  //    lateral-emphasis (virtual delts_lateral slug from tagged exercises).
  type SetForAgg = SetForAggregation;
  const setsByDay: Array<{ standard: SetForAgg[]; lateral: SetForAgg[] }> = [];
  let totalRirNullCount = 0;
  let totalWorkingSetsCount = 0;

  for (const routine of routines) {
    const dayStandard: SetForAgg[] = [];
    const dayLateral: SetForAgg[] = [];
    for (const exercise of routine.exercises) {
      const ex = exercise.exercise;
      if (!ex) continue; // unknown exercise — skip
      for (const set of exercise.sets) {
        // Treat a set as "working" if it has a rep/duration target.
        const isWorking =
          (set.max_repetitions != null && set.max_repetitions > 0) ||
          (set.target_duration_seconds != null && set.target_duration_seconds > 0);
        if (!isWorking) continue;
        totalWorkingSetsCount++;
        if (set.target_rir == null) totalRirNullCount++;

        const aggSet: SetForAgg = {
          set_uuid: set.uuid,
          rir: set.target_rir,
          weight: null, // routine sets don't carry weight (load is logged at workout time)
          repetitions: null, // not used for projection's effective_set computation
          primary_muscles: ex.primary_muscles ?? [],
          secondary_muscles: ex.secondary_muscles ?? [],
          secondary_weights: ex.secondary_weights ?? null,
        };
        dayStandard.push(aggSet);

        // If exercise is lateral-emphasis tagged, ALSO emit a virtual
        // delts_lateral hit (independent of the standard 'delts' credit
        // — the same set appears in both passes, just under different
        // slugs).
        if (ex.lateral_emphasis) {
          dayLateral.push({
            set_uuid: set.uuid,
            rir: set.target_rir,
            weight: null,
            repetitions: null,
            primary_muscles: [DELTS_LATERAL],
            secondary_muscles: [],
          });
        }
      }
    }
    setsByDay.push({ standard: dayStandard, lateral: dayLateral });
  }

  // 3. Aggregate across all days (per-set hits flattened) AND track which
  //    days touched each muscle.
  const allStandardSets = setsByDay.flatMap((d) => d.standard);
  const allLateralSets = setsByDay.flatMap((d) => d.lateral);
  const standardAgg = aggregateMuscleHits(allStandardSets);
  const lateralAgg = aggregateMuscleHits(allLateralSets);

  // days_touched per muscle: count distinct days where any set credits it.
  const daysTouchedBySlug = new Map<string, number>();
  for (let i = 0; i < setsByDay.length; i++) {
    const day = setsByDay[i];
    const slugsThisDay = new Set<string>();
    for (const s of day.standard) {
      for (const m of s.primary_muscles) slugsThisDay.add(m);
      for (const m of s.secondary_muscles) slugsThisDay.add(m);
    }
    for (const s of day.lateral) {
      for (const m of s.primary_muscles) slugsThisDay.add(m);
    }
    for (const slug of slugsThisDay) {
      daysTouchedBySlug.set(slug, (daysTouchedBySlug.get(slug) ?? 0) + 1);
    }
  }

  // 4. Resolve build_emphasis priority. Lou's slugs may include
  //    'delts_lateral' (virtual) — that's fine, treated as just another
  //    priority slug.
  const buildEmphasis = vision?.build_emphasis ?? [];
  const priorityRank = new Map<string, number>();
  buildEmphasis.forEach((slug, i) => priorityRank.set(slug, i));

  // 5. Build rows. Start with the union of (touched muscles ∪ priority
  //    slugs ∪ canonical muscleDefs slugs that have an override). Priority
  //    slugs that aren't touched still appear as set_count=0 rows so the
  //    UI can flag missing priority work.
  const muscleDefBySlug = new Map(muscleDefs.map((m) => [m.slug, m]));
  const aggBySlug = new Map<string, { set_count: number; effective_set_count: number }>();
  for (const a of standardAgg) aggBySlug.set(a.muscle_slug, a);
  for (const a of lateralAgg) aggBySlug.set(a.muscle_slug, a);

  const allSlugs = new Set<string>();
  for (const s of aggBySlug.keys()) allSlugs.add(s);
  for (const s of buildEmphasis) allSlugs.add(s);
  for (const o of overrides) allSlugs.add(o.muscle_slug);

  const rows: ProjectedSetsByMuscleRow[] = [];
  for (const slug of allSlugs) {
    const def = muscleDefBySlug.get(slug);
    const agg = aggBySlug.get(slug) ?? { set_count: 0, effective_set_count: 0 };
    const daysTouched = daysTouchedBySlug.get(slug) ?? 0;
    const weeklyFrequency = daysTouched * weeksPerCycle;

    // Range — vision override OR muscleDef OR generic 10-20 fallback.
    const fallbackMin = def?.optimal_sets_min ?? 10;
    const fallbackMax = def?.optimal_sets_max ?? 20;
    const { min: rangeMin, max: rangeMax, overridden: rangeOverridden } =
      resolveVolumeRange(slug, fallbackMin, fallbackMax, overrides);

    // Frequency floor — vision override OR muscleDef defaults from
    // DEFAULT_FREQUENCY_FLOORS via resolveFrequencyFloor.
    const freqFloor = resolveFrequencyFloor(slug, overrides);

    const volZone = volumeZone(agg.effective_set_count, rangeMin, rangeMax);
    const freqZone = agg.set_count > 0 ? frequencyZone(weeklyFrequency, freqFloor) : 'red';

    // Confidence: are we projecting honestly?
    let confidence: ProjectionConfidence = 'confident';
    if (cycleAssumed && agg.set_count > 0) confidence = 'uncertain_freq';
    if (totalWorkingSetsCount > 0 && totalRirNullCount / totalWorkingSetsCount > 0.2)
      confidence = 'uncertain_rir';

    // Verdict: worst-of-axes. Resolution order:
    //   under volume → red. over volume → yellow (works but high recovery).
    //   freq red → red. freq yellow → yellow.
    //   confidence uncertain → uncertain (overrides green).
    //   else → green.
    let verdict: 'green' | 'yellow' | 'red' | 'uncertain' = 'green';
    let bindingConstraint: ProjectedSetsByMuscleRow['binding_constraint'] = 'optimal';
    if (volZone === 'zero' || volZone === 'under') {
      verdict = 'red';
      bindingConstraint = 'volume';
    } else if (volZone === 'over') {
      verdict = 'yellow';
      bindingConstraint = 'volume';
    }
    if (freqZone === 'red' && agg.set_count > 0) {
      verdict = 'red';
      bindingConstraint = 'frequency';
    } else if (freqZone === 'yellow' && verdict === 'green') {
      verdict = 'yellow';
      bindingConstraint = 'frequency';
    }
    if (confidence !== 'confident' && verdict === 'green') {
      verdict = 'uncertain';
      bindingConstraint = 'confidence';
    }

    rows.push({
      slug,
      display_name: def?.display_name ?? slug.replace(/_/g, ' '),
      set_count: agg.set_count,
      effective_set_count: agg.effective_set_count,
      days_touched: daysTouched,
      weekly_frequency: weeklyFrequency,
      range_min: rangeMin,
      range_max: rangeMax,
      range_overridden: rangeOverridden,
      freq_min: freqFloor.min_freq,
      volume_zone: volZone,
      frequency_zone: freqZone,
      verdict,
      binding_constraint: bindingConstraint,
      confidence,
      is_priority: priorityRank.has(slug),
      build_emphasis_rank: priorityRank.get(slug) ?? null,
      evidence: freqFloor.evidence ?? null,
    });
  }

  // 6. Sort: priorities first (by build_emphasis_rank ascending), then
  //    others by display_order (canonical) or alphabetical.
  rows.sort((a, b) => {
    if (a.is_priority && !b.is_priority) return -1;
    if (!a.is_priority && b.is_priority) return 1;
    if (a.is_priority && b.is_priority) {
      return (a.build_emphasis_rank ?? 0) - (b.build_emphasis_rank ?? 0);
    }
    const aDef = muscleDefBySlug.get(a.slug);
    const bDef = muscleDefBySlug.get(b.slug);
    const aOrder = aDef?.display_order ?? 999;
    const bOrder = bDef?.display_order ?? 999;
    return aOrder - bOrder;
  });

  // 7. (skipped — see contributors function below)
  // Sub-group uncertainty: if delts is in the rows AND delts_lateral is
  //    a priority but delts overall reads green/yellow while delts_lateral
  //    reads red, mark delts as uncertain_subgroup.
  const deltsRow = rows.find((r) => r.slug === 'delts');
  const lateralRow = rows.find((r) => r.slug === DELTS_LATERAL);
  if (
    deltsRow &&
    lateralRow &&
    lateralRow.is_priority &&
    lateralRow.verdict === 'red' &&
    (deltsRow.verdict === 'green' || deltsRow.verdict === 'yellow')
  ) {
    deltsRow.confidence = 'uncertain_subgroup';
    deltsRow.verdict = 'uncertain';
    deltsRow.binding_constraint = 'confidence';
  }

  return rows;
}

// ─── Per-muscle contributor breakdown (drill-down support) ─────────────

export interface MuscleContributor {
  /** Stable React key — composite of routine_uuid + exercise_uuid. */
  key: string;
  /** Routine ("day") title or null if untitled. */
  day_label: string | null;
  exercise_uuid: string;
  exercise_title: string;
  /** Whether this exercise credits the muscle as primary or secondary. */
  role: 'primary' | 'secondary';
  /** Per-(exercise, muscle) secondary weight from secondary_weights, or
   *  null when role==='primary'. Falls back to 0.5 (the legacy default)
   *  when secondary_weights is missing/null. */
  secondary_weight: number | null;
  /** Distinct sets crediting this muscle from this exercise on this day. */
  set_count: number;
  /** RIR-weighted × credit-weighted contribution. */
  effective_set_count: number;
  weight_source?: 'audited' | 'inferred' | 'default' | 'manual-override' | null;
}

/**
 * Per-(routine day, exercise) contribution to ONE specific muscle. Used
 * by the drill-down sheet on the routine page to answer "which exercises
 * fed this muscle's count and how much."
 *
 * Special handling for the virtual delts_lateral slug: only exercises with
 * lateral_emphasis=true contribute, and they're treated as primary.
 */
export function computeMuscleContributors(
  inputs: ProjectionInputs & {
    /** Pass through weight_source per exercise so the UI can show provenance.
     *  Optional — when omitted, contributors render without a source badge. */
    exerciseWeightSources?: ReadonlyMap<string, 'audited' | 'inferred' | 'default' | 'manual-override' | null>;
    /** Exercise titles keyed by exercise_uuid. Used as the contributor
     *  row label. Falls back to uuid prefix when not provided. */
    exerciseTitles?: ReadonlyMap<string, string>;
    /** Routine titles keyed by routine_uuid. Drill-down shows day_label
     *  per contributor row when provided. */
    dayLabels?: ReadonlyMap<string, string | null>;
  },
  muscleSlug: string,
): MuscleContributor[] {
  const { routines, exerciseWeightSources, exerciseTitles, dayLabels } = inputs;
  const isLateralVirtual = muscleSlug === DELTS_LATERAL;
  const out: MuscleContributor[] = [];

  for (const routine of routines) {
    const dayLabel = dayLabels?.get(routine.uuid) ?? null;
    // Aggregate per-exercise within the routine — multiple sets of the
    // same exercise on the same day collapse into one row.
    const byExercise = new Map<string, { setCount: number; effective: number; role: 'primary' | 'secondary' | null; weight: number | null; title: string }>();

    for (const exercise of routine.exercises) {
      const ex = exercise.exercise;
      if (!ex) continue;

      // Determine this exercise's contribution role for the muscle.
      let role: 'primary' | 'secondary' | null = null;
      let weight: number | null = null;
      if (isLateralVirtual) {
        if (ex.lateral_emphasis) {
          role = 'primary';
        } else {
          continue;
        }
      } else {
        const inPrimary = ex.primary_muscles?.includes(muscleSlug);
        const inSecondary = ex.secondary_muscles?.includes(muscleSlug);
        if (inPrimary) {
          role = 'primary';
        } else if (inSecondary) {
          role = 'secondary';
          weight = ex.secondary_weights?.[muscleSlug] ?? null;
        } else {
          continue;
        }
      }

      // Sum effective contribution across this exercise's sets. Delegate
      // to the canonical effectiveSetContribution so the rirCredit ladder
      // and primary/secondary rules can never drift out of sync with
      // volume-math.ts (the SQL parity test guards against the SQL side
      // drifting separately).
      let setCount = 0;
      let effective = 0;
      for (const set of exercise.sets) {
        const isWorking =
          (set.max_repetitions != null && set.max_repetitions > 0) ||
          (set.target_duration_seconds != null && set.target_duration_seconds > 0);
        if (!isWorking) continue;
        setCount += 1;
        effective += effectiveSetContribution(role, set.target_rir, weight);
      }

      if (setCount === 0) continue;

      const existing = byExercise.get(ex.uuid);
      if (existing) {
        existing.setCount += setCount;
        existing.effective += effective;
      } else {
        byExercise.set(ex.uuid, {
          setCount,
          effective,
          role,
          weight,
          title: exerciseTitles?.get(ex.uuid) ?? ex.uuid.slice(0, 8),
        });
      }
    }

    for (const [exUuid, agg] of byExercise) {
      const role = agg.role;
      if (role == null) continue;
      out.push({
        key: `${routine.uuid}-${exUuid}`,
        day_label: dayLabel,
        exercise_uuid: exUuid,
        exercise_title: agg.title,
        role,
        secondary_weight: role === 'secondary' ? agg.weight : null,
        set_count: agg.setCount,
        effective_set_count: agg.effective,
        weight_source: exerciseWeightSources?.get(exUuid) ?? null,
      });
    }
  }

  return out;
}
