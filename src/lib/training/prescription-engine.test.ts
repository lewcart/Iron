import { describe, it, expect } from 'vitest';
import {
  prescriptionsFor,
  type PrescriptionFacts,
  type PrescriptionMuscleFact,
} from './prescription-engine';
import type { HrtContext } from './hrt-context';

const TODAY = '2026-05-03';
const NO_HRT: HrtContext = {
  weeks_since_protocol_change: null,
  current_period_name: null,
  current_period_started_at: null,
};

function muscle(overrides: Partial<PrescriptionMuscleFact> = {}): PrescriptionMuscleFact {
  return {
    muscle: 'glutes',
    effective_sets: 12,
    zone: 'in-zone',
    weeks_with_data: 5,
    rir_drift: 0,
    failure_share: null,
    anchor_slope: 'up',
    anchor_lift_name: 'Hip Thrust',
    build_emphasis_rank: 0,
    ...overrides,
  };
}

function facts(overrides: Partial<PrescriptionFacts> = {}): PrescriptionFacts {
  return {
    today: TODAY,
    hrv: { available: true, sigma_below: 0, baseline_days: 28 },
    sessions_last_14d: 5,
    muscles: [],
    ...overrides,
  };
}

describe('prescriptionsFor — confidence gates', () => {
  it('empty muscles → empty prescriptions, eligibility=0/0', () => {
    const r = prescriptionsFor(facts({ muscles: [] }), NO_HRT);
    expect(r.prescriptions).toEqual([]);
    expect(r.eligibility).toEqual({ eligible: 0, ineligible: 0 });
  });

  it('muscle with <3 weeks of data → ineligible, no prescription', () => {
    const r = prescriptionsFor(
      facts({ muscles: [muscle({ weeks_with_data: 2 })] }),
      NO_HRT,
    );
    expect(r.prescriptions).toEqual([]);
    expect(r.eligibility).toEqual({ eligible: 0, ineligible: 1 });
  });

  it('sessions_last_14d < 3 → all muscles ineligible', () => {
    const r = prescriptionsFor(
      facts({
        sessions_last_14d: 2,
        muscles: [muscle(), muscle({ muscle: 'lats' })],
      }),
      NO_HRT,
    );
    expect(r.prescriptions).toEqual([]);
    expect(r.eligibility).toEqual({ eligible: 0, ineligible: 2 });
  });

  it('eligibility splits when some muscles have enough data and others do not', () => {
    const r = prescriptionsFor(
      facts({
        muscles: [
          muscle({ muscle: 'glutes', weeks_with_data: 5 }),
          muscle({ muscle: 'lats', weeks_with_data: 1 }),
        ],
      }),
      NO_HRT,
    );
    expect(r.eligibility).toEqual({ eligible: 1, ineligible: 1 });
  });
});

describe('prescriptionsFor — DELOAD trigger', () => {
  it('DELOAD when HRV ≥1σ down + RIR drift ≥0.5 on a muscle', () => {
    const r = prescriptionsFor(
      facts({
        hrv: { available: true, sigma_below: 1.2, baseline_days: 28 },
        muscles: [muscle({ rir_drift: 0.6 })],
      }),
      NO_HRT,
    );
    expect(r.prescriptions).toHaveLength(1);
    expect(r.prescriptions[0].action).toBe('DELOAD');
    expect(r.prescriptions[0].muscle).toBe('whole-body');
    expect(r.prescriptions[0].confidence).toBe('high');
  });

  it('DELOAD when HRV ≥1σ down + e1RM stagnation across ≥2 muscles', () => {
    const r = prescriptionsFor(
      facts({
        hrv: { available: true, sigma_below: 1.2, baseline_days: 28 },
        muscles: [
          muscle({ muscle: 'glutes', anchor_slope: 'flat' }),
          muscle({ muscle: 'lats', anchor_slope: 'down' }),
        ],
      }),
      NO_HRT,
    );
    expect(r.prescriptions[0].action).toBe('DELOAD');
  });

  it('NO DELOAD when HRV down but no RIR drift and only 1 stagnant muscle', () => {
    const r = prescriptionsFor(
      facts({
        hrv: { available: true, sigma_below: 1.2, baseline_days: 28 },
        muscles: [
          muscle({ muscle: 'glutes', anchor_slope: 'flat', rir_drift: 0 }),
          muscle({ muscle: 'lats', anchor_slope: 'up', rir_drift: 0 }),
        ],
      }),
      NO_HRT,
    );
    // No DELOAD — should fall through to per-muscle (which here yields 1 PUSH for lats).
    expect(r.prescriptions.find(p => p.action === 'DELOAD')).toBeUndefined();
  });

  it('NO DELOAD when HRV baseline < 14 days (insufficient signal)', () => {
    const r = prescriptionsFor(
      facts({
        hrv: { available: true, sigma_below: 2.0, baseline_days: 10 },
        muscles: [muscle({ rir_drift: 1.0 })],
      }),
      NO_HRT,
    );
    expect(r.prescriptions.find(p => p.action === 'DELOAD')).toBeUndefined();
  });

  it('recent HRT protocol change suppresses e1RM stagnation as DELOAD trigger', () => {
    const recentHrt: HrtContext = {
      weeks_since_protocol_change: 2,
      current_period_name: 'New protocol',
      current_period_started_at: '2026-04-19',
    };
    const r = prescriptionsFor(
      facts({
        hrv: { available: true, sigma_below: 1.2, baseline_days: 28 },
        muscles: [
          muscle({ muscle: 'glutes', anchor_slope: 'flat', rir_drift: 0 }),
          muscle({ muscle: 'lats', anchor_slope: 'down', rir_drift: 0 }),
        ],
      }),
      recentHrt,
    );
    // Stagnation suppressed → no DELOAD (only HRV+RIR can trigger; RIR is 0).
    expect(r.prescriptions.find(p => p.action === 'DELOAD')).toBeUndefined();
    // Context note appears so user understands why.
    expect(r.hrtContextNotes.length).toBeGreaterThan(0);
  });

  it('recent HRT + HRV+RIR drift → DELOAD still fires (only stagnation is suppressed)', () => {
    const recentHrt: HrtContext = {
      weeks_since_protocol_change: 1,
      current_period_name: 'New protocol',
      current_period_started_at: '2026-04-26',
    };
    const r = prescriptionsFor(
      facts({
        hrv: { available: true, sigma_below: 1.5, baseline_days: 28 },
        muscles: [muscle({ rir_drift: 0.8 })],
      }),
      recentHrt,
    );
    expect(r.prescriptions[0].action).toBe('DELOAD');
  });
});

describe('prescriptionsFor — per-muscle PUSH/REDUCE', () => {
  it('REDUCE when muscle in risk zone (≥MRV)', () => {
    const r = prescriptionsFor(
      facts({ muscles: [muscle({ zone: 'risk' })] }),
      NO_HRT,
    );
    expect(r.prescriptions[0].action).toBe('REDUCE');
    expect(r.prescriptions[0].delta.sets).toBe(-2);
    expect(r.prescriptions[0].reasons[0].kind).toBe('zone_risk');
  });

  it('REDUCE when muscle has RIR drift ≥1.0', () => {
    const r = prescriptionsFor(
      facts({ muscles: [muscle({ rir_drift: 1.2 })] }),
      NO_HRT,
    );
    expect(r.prescriptions[0].action).toBe('REDUCE');
    expect(r.prescriptions[0].delta.sets).toBe(-1);
  });

  it('PUSH +2 when muscle is under MEV', () => {
    const r = prescriptionsFor(
      facts({ muscles: [muscle({ zone: 'under', anchor_slope: 'flat' })] }),
      NO_HRT,
    );
    expect(r.prescriptions[0].action).toBe('PUSH');
    expect(r.prescriptions[0].delta.sets).toBe(2);
  });

  it('PUSH +1 when in-zone + positive slope + no RIR drift', () => {
    const r = prescriptionsFor(
      facts({ muscles: [muscle({ zone: 'in-zone', anchor_slope: 'up', rir_drift: 0 })] }),
      NO_HRT,
    );
    expect(r.prescriptions[0].action).toBe('PUSH');
    expect(r.prescriptions[0].delta.sets).toBe(1);
  });

  it('NO PUSH (HOLD filtered) when in-zone + positive slope + RIR drift exists', () => {
    // Asymmetric guard — incipient drift kills the PUSH
    const r = prescriptionsFor(
      facts({ muscles: [muscle({ zone: 'in-zone', anchor_slope: 'up', rir_drift: 0.6 })] }),
      NO_HRT,
    );
    expect(r.prescriptions).toEqual([]);
  });

  it('HOLD never rendered (over zone)', () => {
    const r = prescriptionsFor(
      facts({ muscles: [muscle({ zone: 'over' })] }),
      NO_HRT,
    );
    expect(r.prescriptions).toEqual([]);
  });
});

describe('prescriptionsFor — total-added-sets cap', () => {
  it('caps total +sets at 4 across all PUSH muscles', () => {
    const r = prescriptionsFor(
      facts({
        muscles: [
          muscle({ muscle: 'glutes', zone: 'under' }),       // wants +2
          muscle({ muscle: 'lats', zone: 'under' }),         // wants +2
          muscle({ muscle: 'delts', zone: 'under' }),        // wants +2 (dropped)
          muscle({ muscle: 'chest', zone: 'under' }),        // wants +2 (dropped)
        ],
      }),
      NO_HRT,
    );
    expect(r.totalSetsAdded).toBeLessThanOrEqual(4);
  });

  it('cap rank: anchor_slope=up muscles win first', () => {
    // Both glutes and lats want +2 each. Cap is 4, so both fit. But only
    // glutes has anchor_slope=up. Verify ranking gives stable output.
    const r = prescriptionsFor(
      facts({
        muscles: [
          muscle({ muscle: 'glutes', zone: 'under', anchor_slope: 'up', build_emphasis_rank: 1 }),
          muscle({ muscle: 'lats', zone: 'under', anchor_slope: 'flat', build_emphasis_rank: 0 }),
        ],
      }),
      NO_HRT,
    );
    const muscleNames = r.prescriptions.filter(p => p.action === 'PUSH').map(p => p.muscle);
    expect(muscleNames[0]).toBe('glutes');  // anchor=up wins despite worse build rank
  });

  it('cap can partially accept a muscle (delta truncated)', () => {
    const r = prescriptionsFor(
      facts({
        muscles: [
          muscle({ muscle: 'glutes', zone: 'in-zone', anchor_slope: 'up', rir_drift: 0 }),  // +1
          muscle({ muscle: 'lats', zone: 'in-zone', anchor_slope: 'up', rir_drift: 0, build_emphasis_rank: 1 }),  // +1
          muscle({ muscle: 'delts', zone: 'in-zone', anchor_slope: 'up', rir_drift: 0, build_emphasis_rank: 2 }),  // +1
          muscle({ muscle: 'chest', zone: 'under' }),  // wants +2
          muscle({ muscle: 'biceps', zone: 'under' }),  // wants +2 → would push past cap
        ],
      }),
      NO_HRT,
    );
    expect(r.totalSetsAdded).toBeLessThanOrEqual(4);
  });
});

describe('prescriptionsFor — determinism', () => {
  it('same facts + same hrtContext + same today → identical output', () => {
    const f = facts({
      hrv: { available: true, sigma_below: 1.5, baseline_days: 28 },
      muscles: [muscle({ rir_drift: 0.7 }), muscle({ muscle: 'lats', zone: 'risk' })],
    });
    const a = prescriptionsFor(f, NO_HRT);
    const b = prescriptionsFor(f, NO_HRT);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('prescriptionsFor — boundary tests', () => {
  it('RIR drift = 0.49 stays as PUSH-eligible (just below DELOAD threshold)', () => {
    const r = prescriptionsFor(
      facts({
        hrv: { available: true, sigma_below: 1.5, baseline_days: 28 },
        muscles: [muscle({ rir_drift: 0.49 })],
      }),
      NO_HRT,
    );
    expect(r.prescriptions.find(p => p.action === 'DELOAD')).toBeUndefined();
  });

  it('RIR drift = 0.50 trips DELOAD (boundary)', () => {
    const r = prescriptionsFor(
      facts({
        hrv: { available: true, sigma_below: 1.5, baseline_days: 28 },
        muscles: [muscle({ rir_drift: 0.50 })],
      }),
      NO_HRT,
    );
    expect(r.prescriptions[0].action).toBe('DELOAD');
  });

  it('HRV at exactly -1.0σ is "low" (boundary)', () => {
    const r = prescriptionsFor(
      facts({
        hrv: { available: true, sigma_below: 1.0, baseline_days: 28 },
        muscles: [muscle({ rir_drift: 0.6 })],
      }),
      NO_HRT,
    );
    expect(r.prescriptions[0].action).toBe('DELOAD');
  });

  it('HRV at -0.99σ does NOT trigger (just below)', () => {
    const r = prescriptionsFor(
      facts({
        hrv: { available: true, sigma_below: 0.99, baseline_days: 28 },
        muscles: [muscle({ rir_drift: 0.6 })],
      }),
      NO_HRT,
    );
    expect(r.prescriptions.find(p => p.action === 'DELOAD')).toBeUndefined();
  });

  it('protocol started today: weeks=0, e1RM still suppressed', () => {
    const todayHrt: HrtContext = {
      weeks_since_protocol_change: 0,
      current_period_name: 'New',
      current_period_started_at: TODAY,
    };
    const r = prescriptionsFor(
      facts({
        hrv: { available: true, sigma_below: 1.2, baseline_days: 28 },
        muscles: [
          muscle({ muscle: 'glutes', anchor_slope: 'down', rir_drift: 0 }),
          muscle({ muscle: 'lats', anchor_slope: 'down', rir_drift: 0 }),
        ],
      }),
      todayHrt,
    );
    expect(r.prescriptions.find(p => p.action === 'DELOAD')).toBeUndefined();
  });
});

describe('prescriptionsFor — failure-load DELOAD (HRV-independent)', () => {
  /** Healthy HRV — the existing DELOAD path cannot fire here. */
  const healthyHrv = { available: true, sigma_below: 0, baseline_days: 28 };

  it('fires on 2+ priority muscles over the failure threshold, with HRV fine', () => {
    const r = prescriptionsFor(
      facts({
        hrv: healthyHrv,
        muscles: [
          muscle({ muscle: 'delts', failure_share: 0.91 }),
          muscle({ muscle: 'glutes', failure_share: 0.71 }),
        ],
      }),
      NO_HRT,
    );
    const deload = r.prescriptions.find(p => p.action === 'DELOAD');
    expect(deload).toBeDefined();
    expect(deload!.muscle).toBe('whole-body');
    expect(deload!.confidence).toBe('high');
  });

  it('does NOT fire on a single severe muscle', () => {
    const r = prescriptionsFor(
      facts({
        hrv: healthyHrv,
        muscles: [
          muscle({ muscle: 'delts', failure_share: 0.95 }),
          muscle({ muscle: 'glutes', failure_share: 0.20 }),
        ],
      }),
      NO_HRT,
    );
    expect(r.prescriptions.find(p => p.action === 'DELOAD')).toBeUndefined();
  });

  it('does NOT fire below the threshold — the healthy June baseline', () => {
    const r = prescriptionsFor(
      facts({
        hrv: healthyHrv,
        muscles: [
          muscle({ muscle: 'delts', failure_share: 0.43 }),
          muscle({ muscle: 'glutes', failure_share: 0.43 }),
          muscle({ muscle: 'core', failure_share: 0.40 }),
        ],
      }),
      NO_HRT,
    );
    expect(r.prescriptions.find(p => p.action === 'DELOAD')).toBeUndefined();
  });

  it('treats null failure_share (thin RIR coverage) as no signal, not as zero risk', () => {
    const r = prescriptionsFor(
      facts({
        hrv: healthyHrv,
        muscles: [
          muscle({ muscle: 'delts', failure_share: null }),
          muscle({ muscle: 'glutes', failure_share: null }),
        ],
      }),
      NO_HRT,
    );
    expect(r.prescriptions.find(p => p.action === 'DELOAD')).toBeUndefined();
  });

  it('omits the hrv_low chip when HRV is not corroborating', () => {
    const r = prescriptionsFor(
      facts({
        hrv: healthyHrv,
        muscles: [
          muscle({ muscle: 'delts', failure_share: 0.91 }),
          muscle({ muscle: 'glutes', failure_share: 0.71 }),
        ],
      }),
      NO_HRT,
    );
    const chips = r.prescriptions[0].reasons;
    expect(chips.some(c => c.kind === 'failure_load')).toBe(true);
    expect(chips.some(c => c.kind === 'hrv_low')).toBe(false);
  });

  it('reports the mean share and muscle count on the chip', () => {
    const r = prescriptionsFor(
      facts({
        hrv: healthyHrv,
        muscles: [
          muscle({ muscle: 'delts', failure_share: 0.90 }),
          muscle({ muscle: 'glutes', failure_share: 0.70 }),
        ],
      }),
      NO_HRT,
    );
    const chip = r.prescriptions[0].reasons.find(c => c.kind === 'failure_load')!;
    expect(chip).toMatchObject({ muscle_count: 2 });
    expect((chip as { share: number }).share).toBeCloseTo(0.80, 5);
  });

  it('suppresses PUSH — DELOAD supersedes per-muscle prescriptions', () => {
    const r = prescriptionsFor(
      facts({
        hrv: healthyHrv,
        muscles: [
          muscle({ muscle: 'delts', zone: 'under', failure_share: 0.91 }),
          muscle({ muscle: 'glutes', zone: 'under', failure_share: 0.71 }),
        ],
      }),
      NO_HRT,
    );
    expect(r.prescriptions).toHaveLength(1);
    expect(r.prescriptions[0].action).toBe('DELOAD');
    expect(r.totalSetsAdded).toBe(0);
  });

  it('fires under the ceiling effect: extreme level, flat rir_drift', () => {
    // The exact state this path exists for — drift below every threshold
    // because failure training has already been sustained for weeks.
    const r = prescriptionsFor(
      facts({
        hrv: healthyHrv,
        muscles: [
          muscle({ muscle: 'delts', rir_drift: 0.1, failure_share: 0.91 }),
          muscle({ muscle: 'biceps', rir_drift: 0.0, failure_share: 0.95 }),
        ],
      }),
      NO_HRT,
    );
    expect(r.prescriptions[0].action).toBe('DELOAD');
  });
});
