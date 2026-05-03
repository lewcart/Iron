import { describe, it, expect } from 'vitest';
import {
  VOLUME_LANDMARKS,
  landmarkFor,
  mrvAt,
  zoneFor,
  type Frequency,
} from './volume-landmarks';

describe('volume-landmarks — table integrity', () => {
  it('L3: every landmark has MV ≤ MEV ≤ MAV.min ≤ MAV.max', () => {
    for (const [slug, lm] of Object.entries(VOLUME_LANDMARKS)) {
      expect(lm.mv).toBeLessThanOrEqual(lm.mev);
      // Glutes is an exception — MEV=0 deliberately, MAV starts at 4.
      // The invariant is MEV ≤ MAV.min (not strictly equal); 0 ≤ 4 holds.
      expect(lm.mev).toBeLessThanOrEqual(lm.mavMin);
      expect(lm.mavMin).toBeLessThanOrEqual(lm.mavMax);
      // MRV at the highest tabulated frequency must be ≥ MAV.max.
      const mrvFreq4 = lm.mrvByFrequency[4] ?? lm.mrvByFrequency[3] ?? lm.mrvByFrequency[2] ?? 0;
      expect(mrvFreq4, `${slug} MRV@4 < MAV.max`).toBeGreaterThanOrEqual(lm.mavMax);
    }
  });

  it('13 priority muscle entries present (canonical-aligned slugs)', () => {
    const expected = [
      'glutes', 'lats', 'delts', 'chest', 'quads',
      'hamstrings', 'hip_abductors', 'calves', 'triceps', 'biceps', 'traps',
      'forearms', 'core',
    ];
    for (const slug of expected) {
      expect(landmarkFor(slug), `missing ${slug}`).toBeTruthy();
    }
    expect(Object.keys(VOLUME_LANDMARKS).length).toBe(expected.length);
  });

  it('only hip_abductors is flagged extrapolated', () => {
    const extrapolated = Object.values(VOLUME_LANDMARKS).filter(l => l.source === 'extrapolated');
    expect(extrapolated.map(l => l.slug)).toEqual(['hip_abductors']);
  });

  it('glutes MEV is 0 (RP indirect-work convention)', () => {
    expect(landmarkFor('glutes')!.mev).toBe(0);
  });

  it('back / lats MV is 8', () => {
    expect(landmarkFor('lats')!.mv).toBe(8);
  });

  it('delts uses combined RP-2025 rear+side guidance: MEV=8, MAV 16-22, MRV@4=35', () => {
    const delts = landmarkFor('delts')!;
    expect(delts.mev).toBe(8);
    expect(delts.mavMin).toBe(16);
    expect(delts.mavMax).toBe(22);
    expect(delts.mrvByFrequency[4]).toBe(35);
  });

  it('does not include legacy split slugs side_delts / rear_delts (canonical taxonomy uses single delts row)', () => {
    expect(landmarkFor('side_delts')).toBeUndefined();
    expect(landmarkFor('rear_delts')).toBeUndefined();
  });
});

describe('landmarkFor', () => {
  it('returns undefined for unknown slug', () => {
    expect(landmarkFor('unknown_slug')).toBeUndefined();
  });

  it('returns the glute entry', () => {
    const g = landmarkFor('glutes')!;
    expect(g.mv).toBe(0);
    expect(g.mev).toBe(0);
    expect(g.mavMin).toBe(4);
    expect(g.mavMax).toBe(12);
  });
});

describe('mrvAt', () => {
  const glutes = landmarkFor('glutes')!;

  it('returns exact value when frequency is tabulated', () => {
    expect(mrvAt(glutes, 2)).toBe(12);
    expect(mrvAt(glutes, 3)).toBe(18);
    expect(mrvAt(glutes, 4)).toBe(25);
  });

  it('falls back to nearest tabulated freq when not exact', () => {
    // Glutes only has 2/3/4; freq=5 should fall back (closest is 4).
    expect(mrvAt(glutes, 5 as Frequency)).toBe(25);
  });

  it('falls back to single-value freq=4 entry for muscles without a freq table', () => {
    // Chest only has freq=4 = 22 in the seed.
    const chest = landmarkFor('chest')!;
    expect(mrvAt(chest, 4)).toBe(22);
    expect(mrvAt(chest, 2)).toBe(22);
  });
});

describe('zoneFor', () => {
  const lats = landmarkFor('lats')!; // mev=10, mavMax=22, mrv@4=30

  it('under MEV → "under"', () => {
    expect(zoneFor(5, 4, lats)).toBe('under');
    expect(zoneFor(0, 4, lats)).toBe('under');
  });

  it('between MEV and MAV.max → "in-zone"', () => {
    expect(zoneFor(10, 4, lats)).toBe('in-zone');
    expect(zoneFor(20, 4, lats)).toBe('in-zone');
    expect(zoneFor(22, 4, lats)).toBe('in-zone');
  });

  it('between MAV.max and MRV → "over"', () => {
    expect(zoneFor(23, 4, lats)).toBe('over');
    expect(zoneFor(29, 4, lats)).toBe('over');
  });

  it('at or above MRV → "risk"', () => {
    expect(zoneFor(30, 4, lats)).toBe('risk');
    expect(zoneFor(40, 4, lats)).toBe('risk');
  });

  it('respects frequency-dependent MRV', () => {
    // Glutes MRV: freq2=12, freq4=25. 15 sets at freq2 = risk; at freq4 = over (above MAV 12 but under MRV 25).
    const glutes = landmarkFor('glutes')!;
    expect(zoneFor(15, 2, glutes)).toBe('risk');
    expect(zoneFor(15, 4, glutes)).toBe('over');
  });
});
