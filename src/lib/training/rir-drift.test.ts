/**
 * rir-drift tests.
 *
 * Sign convention is the load-bearing detail: the prescription engine reads
 * `rir_drift` as "positive = drifting toward failure", and its REDUCE /
 * DELOAD thresholds are positive numbers. Getting the sign backwards would
 * silently invert the fatigue brake, so it is pinned from several angles.
 */
import { describe, it, expect } from 'vitest';
import {
  buildRirDrift,
  rirDriftBySlug,
  RIR_DRIFT_MIN_SETS_PER_WINDOW,
  type RirDriftSetInput,
} from './rir-drift';

const TODAY = '2026-07-27';

function set(overrides: Partial<RirDriftSetInput> = {}): RirDriftSetInput {
  return {
    local_date: TODAY,
    rir: 2,
    muscles: ['glutes'],
    ...overrides,
  };
}

/** n sets on one date for one muscle, all at the same RIR. */
function sets(n: number, date: string, rir: number, muscles = ['glutes']): RirDriftSetInput[] {
  return Array.from({ length: n }, () => set({ local_date: date, rir, muscles }));
}

function driftFor(input: RirDriftSetInput[], muscle = 'glutes'): number | null {
  return rirDriftBySlug(buildRirDrift(input, TODAY)).get(muscle)?.drift ?? null;
}

describe('buildRirDrift — sign convention', () => {
  it('RIR falling (2 → 0) is POSITIVE drift — moving toward failure', () => {
    const drift = driftFor([
      ...sets(4, '2026-07-16', 2), // prior window
      ...sets(4, '2026-07-24', 0), // recent window
    ]);
    expect(drift).toBe(2);
  });

  it('RIR rising (0 → 2) is NEGATIVE drift — backing off failure', () => {
    const drift = driftFor([
      ...sets(4, '2026-07-16', 0),
      ...sets(4, '2026-07-24', 2),
    ]);
    expect(drift).toBe(-2);
  });

  it('steady RIR is zero drift, not null', () => {
    const drift = driftFor([
      ...sets(4, '2026-07-16', 1),
      ...sets(4, '2026-07-24', 1),
    ]);
    expect(drift).toBe(0);
  });
});

describe('buildRirDrift — coverage guard', () => {
  it('returns null when the recent window is below the floor', () => {
    const drift = driftFor([
      ...sets(5, '2026-07-16', 2),
      ...sets(RIR_DRIFT_MIN_SETS_PER_WINDOW - 1, '2026-07-24', 0),
    ]);
    expect(drift).toBeNull();
  });

  it('returns null when the prior window is below the floor', () => {
    const drift = driftFor([
      ...sets(RIR_DRIFT_MIN_SETS_PER_WINDOW - 1, '2026-07-16', 2),
      ...sets(5, '2026-07-24', 0),
    ]);
    expect(drift).toBeNull();
  });

  it('returns null for a muscle trained only in the recent window', () => {
    expect(driftFor(sets(6, '2026-07-24', 0))).toBeNull();
  });

  it('still reports the window means when drift itself is null', () => {
    const row = rirDriftBySlug(buildRirDrift(sets(6, '2026-07-24', 0), TODAY)).get('glutes')!;
    expect(row.drift).toBeNull();
    expect(row.recent_mean).toBe(0);
    expect(row.prior_mean).toBeNull();
    expect(row.recent_n).toBe(6);
    expect(row.prior_n).toBe(0);
  });
});

describe('buildRirDrift — window boundaries', () => {
  it('excludes sets older than the prior window', () => {
    const drift = driftFor([
      ...sets(4, '2026-07-01', 5), // way outside — must not skew the prior mean
      ...sets(4, '2026-07-16', 2),
      ...sets(4, '2026-07-24', 0),
    ]);
    expect(drift).toBe(2);
  });

  it('excludes sets dated after today', () => {
    const rows = buildRirDrift(sets(4, '2026-08-05', 0), TODAY);
    expect(rows).toHaveLength(0);
  });

  it('places the exact recent-window floor date in the PRIOR window', () => {
    // today-7 = 2026-07-20. Boundary is exclusive at the bottom of "recent".
    const rows = buildRirDrift(sets(3, '2026-07-20', 4), TODAY);
    const row = rirDriftBySlug(rows).get('glutes')!;
    expect(row.prior_n).toBe(3);
    expect(row.recent_n).toBe(0);
  });

  it('includes today itself in the recent window', () => {
    const rows = buildRirDrift(sets(3, TODAY, 1), TODAY);
    expect(rirDriftBySlug(rows).get('glutes')!.recent_n).toBe(3);
  });
});

describe('buildRirDrift — set filtering', () => {
  it('ignores sets with no RIR logged', () => {
    const drift = driftFor([
      ...sets(4, '2026-07-16', 2),
      ...sets(4, '2026-07-24', 0),
      ...sets(20, '2026-07-24', null as unknown as number).map(s => ({ ...s, rir: null })),
    ]);
    expect(drift).toBe(2); // unaffected by the nulls
  });

  it('excludes drop-tagged sets', () => {
    const drift = driftFor([
      ...sets(4, '2026-07-16', 2),
      ...sets(4, '2026-07-24', 0),
      // A pile of drops at RIR 0 must not deepen the drift.
      ...sets(10, '2026-07-16', 0).map(s => ({ ...s, tag: 'dropSet' as const })),
    ]);
    expect(drift).toBe(2);
  });

  it("counts tag 'failure' as a normal working set", () => {
    const drift = driftFor([
      ...sets(4, '2026-07-16', 2),
      ...sets(4, '2026-07-24', 0).map(s => ({ ...s, tag: 'failure' as const })),
    ]);
    expect(drift).toBe(2);
  });

  it('counts a muscle listed as both primary and secondary only once', () => {
    const row = rirDriftBySlug(
      buildRirDrift(sets(3, '2026-07-24', 1, ['glutes', 'glutes']), TODAY),
    ).get('glutes')!;
    expect(row.recent_n).toBe(3);
  });
});

describe('buildRirDrift — multi-muscle', () => {
  it('tracks each muscle independently', () => {
    const input = [
      ...sets(4, '2026-07-16', 3, ['glutes']),
      ...sets(4, '2026-07-24', 0, ['glutes']),
      ...sets(4, '2026-07-16', 1, ['delts']),
      ...sets(4, '2026-07-24', 1, ['delts']),
    ];
    const bySlug = rirDriftBySlug(buildRirDrift(input, TODAY));
    expect(bySlug.get('glutes')!.drift).toBe(3);
    expect(bySlug.get('delts')!.drift).toBe(0);
  });

  it('credits one set to every muscle it touches', () => {
    const input = [
      ...sets(4, '2026-07-16', 2, ['hamstrings', 'glutes']),
      ...sets(4, '2026-07-24', 0, ['hamstrings', 'glutes']),
    ];
    const bySlug = rirDriftBySlug(buildRirDrift(input, TODAY));
    expect(bySlug.get('hamstrings')!.drift).toBe(2);
    expect(bySlug.get('glutes')!.drift).toBe(2);
  });
});

describe('buildRirDrift — the ceiling-effect case', () => {
  it('reports near-zero drift when already pinned at failure for both windows', () => {
    // Lou, week of 2026-07-20: avg RIR 0.49 → 0.21. The level is extreme but
    // the RATE has flattened, so drift alone stays under the engine's 0.5
    // DELOAD threshold. This is precisely why the failure-share (level)
    // signal exists alongside it.
    const input = [
      ...sets(2, '2026-07-16', 1),
      ...sets(2, '2026-07-16', 0),
      ...sets(4, '2026-07-24', 0),
    ];
    const drift = driftFor(input)!;
    expect(drift).toBeCloseTo(0.5, 5);
    expect(drift).toBeLessThan(1.0); // below the per-muscle REDUCE threshold
  });
});
