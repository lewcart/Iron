import { describe, it, expect } from 'vitest';
import {
  computeAdherence,
  deliveredFromSets,
  LOU_MUSCLE_TARGET_WEIGHTS,
  DEFAULT_ADHERENCE_CONFIG,
  type AdherenceInputs,
  type DeliveredWeek,
} from './adherence-engine';
import type { ProjectedSetsByMuscleRow } from './routine-projection';

function plannedRow(slug: string, sets: number, isPriority = true): Pick<ProjectedSetsByMuscleRow, 'slug' | 'display_name' | 'effective_set_count' | 'is_priority'> {
  return {
    slug,
    display_name: slug,
    effective_set_count: sets,
    is_priority: isPriority,
  };
}

function week(offset: number, byMuscle: Record<string, number>): DeliveredWeek {
  return { week_offset: offset, by_muscle: new Map(Object.entries(byMuscle)) };
}

describe('computeAdherence — caps prevent catastrophizing', () => {
  it('1 bad week alone → consequence_warranted=false (no panel)', () => {
    const inputs: AdherenceInputs = {
      planned: [plannedRow('glutes', 14)],
      delivered_weeks: [week(0, { glutes: 6 })], // 43%
      muscle_weights: LOU_MUSCLE_TARGET_WEIGHTS,
      target_dates: new Map(),
      plan_start_date: '2026-04-30',
    };
    const v = computeAdherence(inputs);
    expect(v.rows[0].consecutive_shortfall_weeks).toBe(1);
    expect(v.rows[0].consequence_warranted).toBe(false);
  });

  it('2 consecutive shortfall weeks → still no panel (need 3+)', () => {
    const inputs: AdherenceInputs = {
      planned: [plannedRow('glutes', 14)],
      delivered_weeks: [week(0, { glutes: 6 }), week(-1, { glutes: 7 })],
      muscle_weights: LOU_MUSCLE_TARGET_WEIGHTS,
      target_dates: new Map(),
      plan_start_date: '2026-04-30',
    };
    const v = computeAdherence(inputs);
    expect(v.rows[0].consecutive_shortfall_weeks).toBe(2);
    expect(v.rows[0].consequence_warranted).toBe(false);
  });

  it('3 consecutive shortfall weeks → consequence_warranted=true', () => {
    const inputs: AdherenceInputs = {
      planned: [plannedRow('glutes', 14)],
      delivered_weeks: [
        week(0, { glutes: 6 }),
        week(-1, { glutes: 7 }),
        week(-2, { glutes: 5 }),
      ],
      muscle_weights: LOU_MUSCLE_TARGET_WEIGHTS,
      target_dates: new Map(),
      plan_start_date: '2026-04-30',
    };
    const v = computeAdherence(inputs);
    expect(v.rows[0].consecutive_shortfall_weeks).toBe(3);
    expect(v.rows[0].consequence_warranted).toBe(true);
  });

  it('non-priority muscle never gets a row (silent)', () => {
    const inputs: AdherenceInputs = {
      planned: [plannedRow('quads', 14, false)], // not priority
      delivered_weeks: [week(0, { quads: 0 }), week(-1, { quads: 0 }), week(-2, { quads: 0 })],
      muscle_weights: LOU_MUSCLE_TARGET_WEIGHTS,
      target_dates: new Map(),
      plan_start_date: '2026-04-30',
    };
    const v = computeAdherence(inputs);
    expect(v.rows.length).toBe(0);
  });

  it('one good week breaks the streak — no panel even with later shortfalls', () => {
    const inputs: AdherenceInputs = {
      planned: [plannedRow('glutes', 14)],
      delivered_weeks: [
        week(0, { glutes: 6 }),  // shortfall
        week(-1, { glutes: 12 }), // RECOVERY — good week
        week(-2, { glutes: 5 }),
        week(-3, { glutes: 6 }),
      ],
      muscle_weights: LOU_MUSCLE_TARGET_WEIGHTS,
      target_dates: new Map(),
      plan_start_date: '2026-04-30',
    };
    const v = computeAdherence(inputs);
    expect(v.rows[0].consecutive_shortfall_weeks).toBe(1);
    expect(v.rows[0].consequence_warranted).toBe(false);
  });
});

describe('computeAdherence — adherence ratio computation', () => {
  it('clean trailing 4-week average, ratio precisely computed', () => {
    const inputs: AdherenceInputs = {
      planned: [plannedRow('glutes', 14)],
      delivered_weeks: [
        week(0, { glutes: 7 }),
        week(-1, { glutes: 7 }),
        week(-2, { glutes: 7 }),
        week(-3, { glutes: 7 }),
      ],
      muscle_weights: LOU_MUSCLE_TARGET_WEIGHTS,
      target_dates: new Map(),
      plan_start_date: '2026-04-30',
    };
    const v = computeAdherence(inputs);
    expect(v.rows[0].delivered_avg).toBeCloseTo(7);
    expect(v.rows[0].adherence_pct).toBeCloseTo(0.5);
  });

  it('over-100% adherence is clamped at 1.5', () => {
    const inputs: AdherenceInputs = {
      planned: [plannedRow('glutes', 10)],
      delivered_weeks: [week(0, { glutes: 100 })],
      muscle_weights: LOU_MUSCLE_TARGET_WEIGHTS,
      target_dates: new Map(),
      plan_start_date: '2026-04-30',
    };
    const v = computeAdherence(inputs);
    expect(v.rows[0].adherence_pct).toBeLessThanOrEqual(1.5);
  });
});

describe('computeAdherence — goal-timeline impacts', () => {
  it('warranted glute shortfall → projects hip_circumference + smm slip', () => {
    const targetDates = new Map([
      ['hip_circumference_cm', '2027-12-31'],
      ['smm_kg', '2027-12-31'],
    ]);
    const inputs: AdherenceInputs = {
      planned: [plannedRow('glutes', 14)],
      delivered_weeks: [
        week(0, { glutes: 6 }),  // 43% adherence
        week(-1, { glutes: 6 }),
        week(-2, { glutes: 6 }),
      ],
      muscle_weights: LOU_MUSCLE_TARGET_WEIGHTS,
      target_dates: targetDates,
      plan_start_date: '2026-04-30',
    };
    const v = computeAdherence(inputs);
    expect(v.rows[0].consequence_warranted).toBe(true);
    // glute weights: hip_circumference_cm 0.4, smm_kg 0.25, whr 0.2
    const hipImpact = v.goal_impacts.find((i) => i.metric_key === 'hip_circumference_cm');
    const smmImpact = v.goal_impacts.find((i) => i.metric_key === 'smm_kg');
    expect(hipImpact).toBeDefined();
    expect(smmImpact).toBeDefined();
    // hip has heavier weight (0.4 vs 0.25) → more slip
    expect(hipImpact!.slip_days).toBeGreaterThan(smmImpact!.slip_days);
  });

  it('no warranted muscles → no goal impacts', () => {
    const inputs: AdherenceInputs = {
      planned: [plannedRow('glutes', 14)],
      delivered_weeks: [week(0, { glutes: 7 })], // only 1 bad week
      muscle_weights: LOU_MUSCLE_TARGET_WEIGHTS,
      target_dates: new Map([['hip_circumference_cm', '2027-12-31']]),
      plan_start_date: '2026-04-30',
    };
    const v = computeAdherence(inputs);
    expect(v.goal_impacts.length).toBe(0);
  });

  it('HRT compounding multiplier increases slip days', () => {
    const targetDates = new Map([['hip_circumference_cm', '2027-12-31']]);
    const baseline: AdherenceInputs = {
      planned: [plannedRow('glutes', 14)],
      delivered_weeks: [
        week(0, { glutes: 4 }),
        week(-1, { glutes: 4 }),
        week(-2, { glutes: 4 }),
      ],
      muscle_weights: LOU_MUSCLE_TARGET_WEIGHTS,
      target_dates: targetDates,
      plan_start_date: '2026-04-30',
      config: { hrt_compounding_multiplier: 1.0 }, // off
    };
    const compounded: AdherenceInputs = {
      ...baseline,
      config: { hrt_compounding_multiplier: 1.4 },
    };
    const vBase = computeAdherence(baseline);
    const vCompounded = computeAdherence(compounded);
    expect(vCompounded.goal_impacts[0].slip_days).toBeGreaterThan(vBase.goal_impacts[0].slip_days);
  });

  it('slip is bounded — even 0% adherence × HRT 1.4 doesnt trigger 6-month slip on a single 4-week pattern', () => {
    const targetDates = new Map([['hip_circumference_cm', '2027-12-31']]);
    const inputs: AdherenceInputs = {
      planned: [plannedRow('glutes', 14)],
      delivered_weeks: [
        week(0, { glutes: 0 }),
        week(-1, { glutes: 0 }),
        week(-2, { glutes: 0 }),
      ],
      muscle_weights: LOU_MUSCLE_TARGET_WEIGHTS,
      target_dates: targetDates,
      plan_start_date: '2026-04-30',
    };
    const v = computeAdherence(inputs);
    // Even worst case: shortfall=1.0 × glute weight 0.4 × HRT 1.4 = 0.56,
    // capped at 0.95, × 28 days = ~26 days max projected slip on this metric.
    // Critically, NOT 6 months.
    expect(v.goal_impacts[0].slip_days).toBeLessThan(28);
  });
});

describe('deliveredFromSets — Dexie aggregation', () => {
  it('aggregates sets into per-muscle effective totals', () => {
    const w = deliveredFromSets(
      [
        { set_uuid: 's1', rir: 2, weight: 100, repetitions: 8, primary_muscles: ['glutes'], secondary_muscles: [] },
        { set_uuid: 's2', rir: 2, weight: 100, repetitions: 8, primary_muscles: ['glutes'], secondary_muscles: [] },
        { set_uuid: 's3', rir: 4, weight: 80, repetitions: 8, primary_muscles: ['hamstrings'], secondary_muscles: ['glutes'] },
      ],
      0,
    );
    // glutes: s1 1.0 + s2 1.0 + s3 secondary 0.5×0.5 = 2.25
    expect(w.by_muscle.get('glutes')).toBeCloseTo(2.25);
    // hams: s3 primary 1.0×0.5 = 0.5
    expect(w.by_muscle.get('hamstrings')).toBeCloseTo(0.5);
  });
});

describe('LOU_MUSCLE_TARGET_WEIGHTS — sanity', () => {
  it('all priority muscles represented', () => {
    const slugs = LOU_MUSCLE_TARGET_WEIGHTS.map((m) => m.muscle_slug);
    expect(slugs).toContain('glutes');
    expect(slugs).toContain('delts_lateral');
    expect(slugs).toContain('hip_abductors');
    expect(slugs).toContain('core');
  });

  it('lateral delts contributes most to shoulder targets', () => {
    const dl = LOU_MUSCLE_TARGET_WEIGHTS.find((m) => m.muscle_slug === 'delts_lateral')!;
    const shoulderWidthW = dl.contributes_to.find((c) => c.metric_key === 'shoulder_width_cm')!.weight;
    expect(shoulderWidthW).toBeGreaterThanOrEqual(0.5);
  });
});

describe('DEFAULT_ADHERENCE_CONFIG', () => {
  it('safe defaults: 3-week minimum, 80% threshold, HRT 1.4x', () => {
    expect(DEFAULT_ADHERENCE_CONFIG.min_window_weeks).toBe(3);
    expect(DEFAULT_ADHERENCE_CONFIG.shortfall_threshold).toBe(0.8);
    expect(DEFAULT_ADHERENCE_CONFIG.hrt_compounding_multiplier).toBe(1.4);
  });
});
