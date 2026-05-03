import { describe, it, expect } from 'vitest';
import { computeEwma, latestEwma, ewmaDeltaOverDays, HACKERS_DIET_ALPHA } from './ewma';

describe('computeEwma', () => {
  it('W1: empty input → empty output', () => {
    expect(computeEwma([])).toEqual([]);
  });

  it('W2: single point → that point', () => {
    const out = computeEwma([{ date: '2026-04-01', weight: 70 }]);
    expect(out).toHaveLength(1);
    expect(out[0].ewma).toBe(70);
  });

  it('W3: alpha=0.1 matches Walker reference (incremental compute)', () => {
    // Reference: y_n = y_{n-1} + 0.1 * (x_n - y_{n-1})
    // Seeded from x_0.
    const xs = [70, 71, 70, 72];
    const out = computeEwma(xs.map((w, i) => ({ date: `2026-04-0${i + 1}`, weight: w })));
    expect(out[0].ewma).toBe(70);
    // y1 = 70 + 0.1*(71-70) = 70.1
    expect(out[1].ewma).toBeCloseTo(70.1, 2);
    // y2 = 70.1 + 0.1*(70-70.1) = 70.09
    expect(out[2].ewma).toBeCloseTo(70.1, 1);
    // y3 = 70.09 + 0.1*(72-70.09) = 70.281
    expect(out[3].ewma).toBeCloseTo(70.3, 1);
  });

  it('W5: ±1 lb noise around stable mean → smoothed flat', () => {
    const points = [];
    for (let i = 0; i < 30; i++) {
      const noise = i % 2 === 0 ? 1 : -1;
      points.push({ date: `2026-04-${String(i + 1).padStart(2, '0')}`, weight: 70 + noise });
    }
    const out = computeEwma(points);
    const last = out[out.length - 1];
    expect(last.ewma).toBeGreaterThan(69.5);
    expect(last.ewma).toBeLessThan(70.5);
  });

  it('W6: -0.3/day trend + ±1 noise → smoothed line trends down', () => {
    const points = [];
    for (let i = 0; i < 30; i++) {
      const noise = i % 2 === 0 ? 1 : -1;
      const w = 70 - 0.3 * i + noise;
      points.push({ date: `2026-04-${String(i + 1).padStart(2, '0')}`, weight: w });
    }
    const out = computeEwma(points);
    expect(out[out.length - 1].ewma).toBeLessThan(out[0].ewma);
  });

  it('exposes HACKERS_DIET_ALPHA = 0.1', () => {
    expect(HACKERS_DIET_ALPHA).toBe(0.1);
  });
});

describe('latestEwma', () => {
  it('returns undefined for empty input', () => {
    expect(latestEwma([])).toBeUndefined();
  });

  it('returns the latest smoothed value', () => {
    const out = latestEwma([
      { date: '2026-04-01', weight: 70 },
      { date: '2026-04-02', weight: 80 },
    ]);
    // y1 = 70 + 0.1 * 10 = 71
    expect(out).toBe(71);
  });
});

describe('ewmaDeltaOverDays', () => {
  it('returns null when only one point', () => {
    expect(ewmaDeltaOverDays([{ date: '2026-04-01', weight: 70 }], 28)).toBe(null);
  });

  it('W4: delta over 28d window', () => {
    // 30 days of declining weight.
    const points = [];
    for (let i = 0; i < 30; i++) {
      points.push({
        date: `2026-04-${String(i + 1).padStart(2, '0')}`,
        weight: 70 - 0.1 * i,
      });
    }
    const delta = ewmaDeltaOverDays(points, 28);
    expect(delta).not.toBeNull();
    expect(delta!).toBeLessThan(0);
  });

  it('returns null when window predates the data', () => {
    const points = [
      { date: '2026-04-29', weight: 70 },
      { date: '2026-04-30', weight: 71 },
    ];
    // 28-day window from 2026-04-30 → cutoff 2026-04-02; first point is 04-29, AFTER cutoff.
    expect(ewmaDeltaOverDays(points, 28)).toBe(null);
  });
});
