/**
 * volume-math conformance tests.
 *
 * The pure TS module here MUST match the SQL semantics in
 * `src/db/queries.ts:getWeekSetsPerMuscle` for the same input set. The SQL
 * is also updated in this PR to use the new RIR 5-tier (TD2 ACCEPTED), so
 * both paths agree on RIR 5 = 0.25.
 *
 * Property-style assertions:
 *   - effective_set_count <= set_count for any input
 *   - primary wins when a muscle is in both arrays (no double-count)
 *   - null RIR == 1.0 (charitable default)
 *   - RIR 5 == 0.25 (was 0.0 in pre-TD2 SQL)
 *   - RIR 6+ == 0.0
 *   - Failure (RIR 0) == 1.0 (no failure bonus)
 */
import { describe, it, expect } from 'vitest';
import {
  rirCredit,
  primarySecondaryCredit,
  effectiveSetContribution,
  aggregateMuscleHits,
  frequencyZone,
  resolveVolumeRange,
  resolveFrequencyFloor,
  volumeZone,
  DEFAULT_FREQUENCY_FLOORS,
  type SetForAggregation,
  type VisionMuscleOverride,
  type MuscleAggregate,
} from './volume-math';

// ── RIR weighting tiers ──────────────────────────────────────────────────

describe('rirCredit — 5-tier weighting (TD2 2026-05-06)', () => {
  it('null = 1.0 (charitable default)', () => {
    expect(rirCredit(null)).toBe(1.0);
    expect(rirCredit(undefined)).toBe(1.0);
  });

  it('failure (RIR 0) = 1.0 (no failure bonus)', () => {
    expect(rirCredit(0)).toBe(1.0);
  });

  it('RIR 1-3 = 1.0', () => {
    expect(rirCredit(1)).toBe(1.0);
    expect(rirCredit(2)).toBe(1.0);
    expect(rirCredit(3)).toBe(1.0);
  });

  it('RIR 4 = 0.5', () => {
    expect(rirCredit(4)).toBe(0.5);
  });

  it('RIR 5 = 0.25 (NEW in TD2; was 0.0)', () => {
    expect(rirCredit(5)).toBe(0.25);
  });

  it('RIR 6+ = 0.0', () => {
    expect(rirCredit(6)).toBe(0.0);
    expect(rirCredit(7)).toBe(0.0);
    expect(rirCredit(10)).toBe(0.0);
  });
});

describe('primarySecondaryCredit', () => {
  it('primary = 1.0', () => {
    expect(primarySecondaryCredit('primary')).toBe(1.0);
  });
  it('secondary = 0.5', () => {
    expect(primarySecondaryCredit('secondary')).toBe(0.5);
  });
  it('both (in primary AND secondary) = 1.0 (primary wins)', () => {
    expect(primarySecondaryCredit('both')).toBe(1.0);
  });
});

describe('effectiveSetContribution — RP/Helms × RIR', () => {
  it('RDL @ RIR 4 contributes 0.5 to glutes (secondary 0.5 × RIR 0.5)', () => {
    expect(effectiveSetContribution('secondary', 4)).toBe(0.25);
  });
  it('RDL @ RIR 4 contributes 0.5 to hamstrings (primary 1.0 × RIR 0.5)', () => {
    expect(effectiveSetContribution('primary', 4)).toBe(0.5);
  });
  it('Pump set @ RIR 5 contributes 0.25 to primary (1.0 × 0.25)', () => {
    expect(effectiveSetContribution('primary', 5)).toBe(0.25);
  });
  it('Junk @ RIR 6+ contributes 0.0', () => {
    expect(effectiveSetContribution('primary', 6)).toBe(0.0);
  });
  it('Hard set, RIR null contributes 1.0 to primary', () => {
    expect(effectiveSetContribution('primary', null)).toBe(1.0);
  });
});

// ── Aggregation conformance ──────────────────────────────────────────────

function set(overrides: Partial<SetForAggregation> = {}): SetForAggregation {
  return {
    set_uuid: 's1',
    rir: null,
    weight: null,
    repetitions: null,
    primary_muscles: [],
    secondary_muscles: [],
    ...overrides,
  };
}

function findMuscle(rows: MuscleAggregate[], slug: string): MuscleAggregate | undefined {
  return rows.find((r) => r.muscle_slug === slug);
}

describe('aggregateMuscleHits — SQL conformance', () => {
  it('single set, primary-only, RIR null → primary 1.0', () => {
    const rows = aggregateMuscleHits([
      set({ set_uuid: 's1', primary_muscles: ['glutes'], rir: null }),
    ]);
    const glutes = findMuscle(rows, 'glutes')!;
    expect(glutes.set_count).toBe(1);
    expect(glutes.effective_set_count).toBe(1.0);
  });

  it('single set, secondary-only, RIR null → 0.5', () => {
    const rows = aggregateMuscleHits([
      set({ set_uuid: 's1', secondary_muscles: ['glutes'], rir: null }),
    ]);
    const glutes = findMuscle(rows, 'glutes')!;
    expect(glutes.set_count).toBe(1);
    expect(glutes.effective_set_count).toBe(0.5);
  });

  it('single set, in BOTH primary and secondary → 1.0 (primary wins, no double)', () => {
    const rows = aggregateMuscleHits([
      set({
        set_uuid: 's1',
        primary_muscles: ['glutes'],
        secondary_muscles: ['glutes'],
        rir: null,
      }),
    ]);
    const glutes = findMuscle(rows, 'glutes')!;
    expect(glutes.set_count).toBe(1); // counted once
    expect(glutes.effective_set_count).toBe(1.0); // primary credit only
  });

  it('RDL @ RIR 4: glutes (secondary) 0.25, hamstrings (primary) 0.5', () => {
    const rows = aggregateMuscleHits([
      set({
        set_uuid: 's1',
        primary_muscles: ['hamstrings'],
        secondary_muscles: ['glutes'],
        rir: 4,
      }),
    ]);
    expect(findMuscle(rows, 'glutes')!.effective_set_count).toBe(0.25);
    expect(findMuscle(rows, 'hamstrings')!.effective_set_count).toBe(0.5);
  });

  it('RIR 5 contributes 0.25 (was 0 pre-TD2)', () => {
    const rows = aggregateMuscleHits([
      set({ set_uuid: 's1', primary_muscles: ['glutes'], rir: 5 }),
    ]);
    expect(findMuscle(rows, 'glutes')!.effective_set_count).toBe(0.25);
  });

  it('RIR 6+ contributes 0', () => {
    const rows = aggregateMuscleHits([
      set({ set_uuid: 's1', primary_muscles: ['glutes'], rir: 7 }),
    ]);
    const glutes = findMuscle(rows, 'glutes')!;
    expect(glutes.set_count).toBe(1); // raw hit still counts
    expect(glutes.effective_set_count).toBe(0); // but no stimulus
  });

  it('kg_volume sums weight × reps once per set even when muscle in both arrays', () => {
    const rows = aggregateMuscleHits([
      set({
        set_uuid: 's1',
        weight: 100,
        repetitions: 8,
        primary_muscles: ['glutes'],
        secondary_muscles: ['glutes'], // duplicate — should NOT double-add kg
      }),
    ]);
    expect(findMuscle(rows, 'glutes')!.kg_volume).toBe(800);
  });

  it('mixed week: 4 muscles, mixed primary/secondary/RIR', () => {
    const rows = aggregateMuscleHits([
      // Hip thrust: glutes primary, hams secondary, RIR 2
      set({
        set_uuid: 'a',
        weight: 100,
        repetitions: 10,
        primary_muscles: ['glutes'],
        secondary_muscles: ['hamstrings'],
        rir: 2,
      }),
      // RDL: hams primary, glutes secondary, RIR 4
      set({
        set_uuid: 'b',
        weight: 80,
        repetitions: 8,
        primary_muscles: ['hamstrings'],
        secondary_muscles: ['glutes'],
        rir: 4,
      }),
      // Lateral raise: delts primary, RIR 3 (logged hard)
      set({
        set_uuid: 'c',
        weight: 8,
        repetitions: 12,
        primary_muscles: ['delts'],
        rir: 3,
      }),
      // Pump finisher: delts primary, RIR 5
      set({
        set_uuid: 'd',
        weight: 6,
        repetitions: 20,
        primary_muscles: ['delts'],
        rir: 5,
      }),
    ]);

    const glutes = findMuscle(rows, 'glutes')!;
    expect(glutes.set_count).toBe(2);
    // a: primary 1.0 × RIR 1.0 = 1.0; b: secondary 0.5 × RIR 0.5 = 0.25
    expect(glutes.effective_set_count).toBeCloseTo(1.25);

    const hams = findMuscle(rows, 'hamstrings')!;
    expect(hams.set_count).toBe(2);
    // a: secondary 0.5 × RIR 1.0 = 0.5; b: primary 1.0 × RIR 0.5 = 0.5
    expect(hams.effective_set_count).toBeCloseTo(1.0);

    const delts = findMuscle(rows, 'delts')!;
    expect(delts.set_count).toBe(2);
    // c: 1.0 × 1.0 = 1.0; d: 1.0 × 0.25 = 0.25
    expect(delts.effective_set_count).toBeCloseTo(1.25);
  });

  it('null weight or null reps → kg_volume contribution is 0', () => {
    const rows = aggregateMuscleHits([
      set({
        set_uuid: 's1',
        weight: null,
        repetitions: 8,
        primary_muscles: ['glutes'],
      }),
      set({
        set_uuid: 's2',
        weight: 50,
        repetitions: null,
        primary_muscles: ['glutes'],
      }),
    ]);
    expect(findMuscle(rows, 'glutes')!.kg_volume).toBe(0);
  });
});

// ── Property-style assertions ────────────────────────────────────────────

describe('aggregateMuscleHits — invariants', () => {
  // Synthetic "any input" by enumerating combinations
  const muscles = ['glutes', 'hamstrings', 'delts', 'core'];
  const rirs = [null, 0, 1, 3, 4, 5, 6, 10];

  it('effective_set_count <= set_count for any input', () => {
    for (const m of muscles) {
      for (const r of rirs) {
        const rows = aggregateMuscleHits([
          set({ set_uuid: 's1', primary_muscles: [m], rir: r }),
        ]);
        const row = findMuscle(rows, m)!;
        expect(row.effective_set_count).toBeLessThanOrEqual(row.set_count);
      }
    }
  });

  it('a muscle never appears with set_count 0 if it was in any set', () => {
    const rows = aggregateMuscleHits([
      set({ primary_muscles: ['glutes'], rir: 6 }), // RIR 6 = 0 effective but still 1 set
    ]);
    expect(findMuscle(rows, 'glutes')!.set_count).toBe(1);
  });
});

// ── Frequency zone ───────────────────────────────────────────────────────

describe('frequencyZone', () => {
  it('< min_freq → red', () => {
    expect(frequencyZone(0, { min_freq: 2 })).toBe('red');
    expect(frequencyZone(1, { min_freq: 2 })).toBe('red');
  });
  it('>= min_freq, no preferred → green', () => {
    expect(frequencyZone(2, { min_freq: 2 })).toBe('green');
    expect(frequencyZone(5, { min_freq: 2 })).toBe('green');
  });
  it('between min and preferred → yellow', () => {
    expect(frequencyZone(2, { min_freq: 2, preferred_freq: 3 })).toBe('yellow');
  });
  it('>= preferred → green', () => {
    expect(frequencyZone(3, { min_freq: 2, preferred_freq: 3 })).toBe('green');
    expect(frequencyZone(4, { min_freq: 2, preferred_freq: 3 })).toBe('green');
  });
});

describe('DEFAULT_FREQUENCY_FLOORS — per-muscle science alignment', () => {
  it('glutes preferred = 3 (RP says 3+ at high volume)', () => {
    expect(DEFAULT_FREQUENCY_FLOORS.glutes!.preferred_freq).toBe(3);
  });
  it('core (rectus) min_freq = 3', () => {
    expect(DEFAULT_FREQUENCY_FLOORS.core!.min_freq).toBe(3);
  });
  it('hamstrings min_freq = 1 (eccentric-damage, slow recovery)', () => {
    expect(DEFAULT_FREQUENCY_FLOORS.hamstrings!.min_freq).toBe(1);
  });
  it('hip_abductors marked as low evidence', () => {
    expect(DEFAULT_FREQUENCY_FLOORS.hip_abductors!.evidence).toBe('low');
  });
});

// ── Vision overrides ─────────────────────────────────────────────────────

describe('resolveVolumeRange', () => {
  it('falls back to defaults when no override', () => {
    const r = resolveVolumeRange('glutes', 10, 20, []);
    expect(r).toEqual({ min: 10, max: 20, overridden: false });
  });

  it('applies override min/max when set', () => {
    const overrides: VisionMuscleOverride[] = [
      {
        muscle_slug: 'glutes',
        override_sets_min: 14,
        override_sets_max: 26,
        override_freq_min: null,
        evidence: null,
      },
    ];
    const r = resolveVolumeRange('glutes', 10, 20, overrides);
    expect(r).toEqual({ min: 14, max: 26, overridden: true });
  });

  it('Lou-vision case: glutes 14-26, lateral_delts 8-16, hip_abductors 8-16', () => {
    const louOverrides: VisionMuscleOverride[] = [
      { muscle_slug: 'glutes', override_sets_min: 14, override_sets_max: 26, override_freq_min: 3, evidence: null },
      { muscle_slug: 'delts_lateral', override_sets_min: 8, override_sets_max: 16, override_freq_min: 3, evidence: null },
      { muscle_slug: 'hip_abductors', override_sets_min: 8, override_sets_max: 16, override_freq_min: 2, evidence: 'low' },
      { muscle_slug: 'core', override_sets_min: 8, override_sets_max: 16, override_freq_min: 3, evidence: null },
    ];
    expect(resolveVolumeRange('glutes', 10, 20, louOverrides)).toEqual({ min: 14, max: 26, overridden: true });
    expect(resolveVolumeRange('delts_lateral', 10, 20, louOverrides)).toEqual({ min: 8, max: 16, overridden: true });
    // Non-overridden muscle → defaults
    expect(resolveVolumeRange('quads', 10, 20, louOverrides)).toEqual({ min: 10, max: 20, overridden: false });
  });

  it('partial override: only min set, max falls back to default', () => {
    const overrides: VisionMuscleOverride[] = [
      {
        muscle_slug: 'glutes',
        override_sets_min: 14,
        override_sets_max: null,
        override_freq_min: null,
        evidence: null,
      },
    ];
    const r = resolveVolumeRange('glutes', 10, 20, overrides);
    expect(r).toEqual({ min: 14, max: 20, overridden: true });
  });
});

describe('resolveFrequencyFloor', () => {
  it('falls back to default for known muscle', () => {
    const f = resolveFrequencyFloor('glutes', []);
    expect(f.min_freq).toBe(2);
    expect(f.preferred_freq).toBe(3);
  });

  it('falls back to min_freq=2 for unknown muscle', () => {
    const f = resolveFrequencyFloor('unknown_muscle', []);
    expect(f.min_freq).toBe(2);
  });

  it('vision override bumps min_freq', () => {
    const overrides: VisionMuscleOverride[] = [
      { muscle_slug: 'glutes', override_sets_min: null, override_sets_max: null, override_freq_min: 3, evidence: null },
    ];
    const f = resolveFrequencyFloor('glutes', overrides);
    expect(f.min_freq).toBe(3);
    // Preferred preserved from baseline
    expect(f.preferred_freq).toBe(3);
  });

  it('vision override evidence flag flows through', () => {
    const overrides: VisionMuscleOverride[] = [
      { muscle_slug: 'hip_abductors', override_sets_min: null, override_sets_max: null, override_freq_min: 2, evidence: 'low' },
    ];
    const f = resolveFrequencyFloor('hip_abductors', overrides);
    expect(f.evidence).toBe('low');
  });
});

// ── Per-exercise secondary weights (v1.1) ──────────────────────────────

describe('primarySecondaryCredit — per-exercise secondary weight', () => {
  it('falls back to 0.5 when no weight provided', () => {
    expect(primarySecondaryCredit('secondary')).toBe(0.5);
    expect(primarySecondaryCredit('secondary', null)).toBe(0.5);
    expect(primarySecondaryCredit('secondary', undefined)).toBe(0.5);
  });
  it('uses provided weight 0.0-1.0', () => {
    expect(primarySecondaryCredit('secondary', 0.7)).toBe(0.7);
    expect(primarySecondaryCredit('secondary', 0.0)).toBe(0.0);
    expect(primarySecondaryCredit('secondary', 1.0)).toBe(1.0);
  });
  it('rejects out-of-range weights, falls back to 0.5', () => {
    expect(primarySecondaryCredit('secondary', -0.1)).toBe(0.5);
    expect(primarySecondaryCredit('secondary', 1.5)).toBe(0.5);
    expect(primarySecondaryCredit('secondary', NaN)).toBe(0.5);
    expect(primarySecondaryCredit('secondary', Infinity)).toBe(0.5);
  });
  it('primary credit is unaffected by secondaryWeight (always 1.0)', () => {
    expect(primarySecondaryCredit('primary', 0.7)).toBe(1.0);
    expect(primarySecondaryCredit('both', 0.3)).toBe(1.0);
  });
});

describe('effectiveSetContribution — per-exercise weight × RIR stacking', () => {
  it('Bulgarian split squat → glutes (0.7 secondary) @ RIR 4 = 0.35', () => {
    expect(effectiveSetContribution('secondary', 4, 0.7)).toBeCloseTo(0.35);
  });
  it('Bench press → lateral delts (0.1 secondary) @ RIR 0 = 0.1', () => {
    expect(effectiveSetContribution('secondary', 0, 0.1)).toBeCloseTo(0.1);
  });
  it('null weight uses 0.5 default (legacy behavior preserved)', () => {
    expect(effectiveSetContribution('secondary', null, null)).toBe(0.5);
    expect(effectiveSetContribution('secondary', null)).toBe(0.5);
  });
});

describe('aggregateMuscleHits — per-exercise secondary weights', () => {
  it('Bulgarian split squat (glutes secondary 0.7) RIR-null sets credit at 0.7 each', () => {
    const rows = aggregateMuscleHits([
      {
        set_uuid: 'bss-1', rir: null, weight: null, repetitions: null,
        primary_muscles: ['quads'], secondary_muscles: ['glutes'],
        secondary_weights: { glutes: 0.7 },
      },
      {
        set_uuid: 'bss-2', rir: null, weight: null, repetitions: null,
        primary_muscles: ['quads'], secondary_muscles: ['glutes'],
        secondary_weights: { glutes: 0.7 },
      },
    ]);
    const glutes = rows.find(r => r.muscle_slug === 'glutes')!;
    expect(glutes.set_count).toBe(2);
    expect(glutes.effective_set_count).toBeCloseTo(1.4);
  });

  it('mixed weights across muscles in same set', () => {
    const rows = aggregateMuscleHits([
      {
        set_uuid: 'rdl-1', rir: 2, weight: null, repetitions: null,
        primary_muscles: ['hamstrings'],
        secondary_muscles: ['glutes', 'erectors', 'adductors'],
        secondary_weights: { glutes: 0.6, erectors: 0.7, adductors: 0.4 },
      },
    ]);
    expect(rows.find(r => r.muscle_slug === 'glutes')!.effective_set_count).toBeCloseTo(0.6);
    expect(rows.find(r => r.muscle_slug === 'erectors')!.effective_set_count).toBeCloseTo(0.7);
    expect(rows.find(r => r.muscle_slug === 'adductors')!.effective_set_count).toBeCloseTo(0.4);
    expect(rows.find(r => r.muscle_slug === 'hamstrings')!.effective_set_count).toBeCloseTo(1.0);
  });

  it('missing weight for tagged muscle falls back to 0.5', () => {
    const rows = aggregateMuscleHits([
      {
        set_uuid: 'mixed-1', rir: null, weight: null, repetitions: null,
        primary_muscles: ['quads'],
        secondary_muscles: ['glutes', 'hamstrings'],
        secondary_weights: { glutes: 0.7 },
      },
    ]);
    expect(rows.find(r => r.muscle_slug === 'glutes')!.effective_set_count).toBeCloseTo(0.7);
    expect(rows.find(r => r.muscle_slug === 'hamstrings')!.effective_set_count).toBeCloseTo(0.5);
  });
});

// ── volumeZone (range-driven, distinct from volume-landmarks zoneFor) ───

describe('volumeZone — range-driven classifier', () => {
  it('zero', () => expect(volumeZone(0, 10, 20)).toBe('zero'));
  it('under', () => expect(volumeZone(5, 10, 20)).toBe('under'));
  it('optimal at min', () => expect(volumeZone(10, 10, 20)).toBe('optimal'));
  it('optimal mid', () => expect(volumeZone(15, 10, 20)).toBe('optimal'));
  it('optimal at max', () => expect(volumeZone(20, 10, 20)).toBe('optimal'));
  it('over', () => expect(volumeZone(25, 10, 20)).toBe('over'));

  it('Lou glutes vision range (14-26): 12 under, 18 optimal, 28 over', () => {
    expect(volumeZone(12, 14, 26)).toBe('under');
    expect(volumeZone(18, 14, 26)).toBe('optimal');
    expect(volumeZone(28, 14, 26)).toBe('over');
  });
});
