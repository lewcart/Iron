import { describe, it, expect } from 'vitest';
import { computeHrvBalance, type HrvDailyPoint } from './hrv-balance';

function days(n: number, startIso: string): string[] {
  const out: string[] = [];
  const startMs = Date.parse(startIso);
  for (let i = 0; i < n; i++) {
    out.push(new Date(startMs + i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

function series(values: number[], startIso: string): HrvDailyPoint[] {
  const dts = days(values.length, startIso);
  return values.map((v, i) => ({ date: dts[i], value: v }));
}

describe('computeHrvBalance', () => {
  it('H4: <21 of 28 days have data → needs-data', () => {
    const points = series([50, 50, 50], '2026-04-01');
    const out = computeHrvBalance(points, { asOf: '2026-04-28' });
    expect(out.status).toBe('needs-data');
    if (out.status === 'needs-data') {
      expect(out.baseline_days).toBe(3);
      expect(out.reason).toMatch(/3 of 28/);
    }
  });

  it('H2: 7-day mean within ±1 SD → "in-band"', () => {
    // 28 days at value 50 (sd=0). 7-day window also at 50 → in-band.
    const points = series(Array(28).fill(50), '2026-04-01');
    const out = computeHrvBalance(points, { asOf: '2026-04-28' });
    expect(out.status).toBe('ok');
    if (out.status === 'ok') {
      expect(out.state).toBe('in-band');
    }
  });

  it('H1: 7-day mean above (baseline + 1 SD) → "above"', () => {
    // 21 days at 50, then 7 days at 60. SD across 28-day window = ~5.
    // Baseline mean = (21*50 + 7*60)/28 = 52.5
    // 7-day mean = 60
    const values = [...Array(21).fill(50), ...Array(7).fill(60)];
    const out = computeHrvBalance(series(values, '2026-04-01'), { asOf: '2026-04-28' });
    expect(out.status).toBe('ok');
    if (out.status === 'ok') {
      expect(out.state).toBe('above');
    }
  });

  it('H3: 7-day mean below (baseline - 1 SD) → "below"', () => {
    const values = [...Array(21).fill(50), ...Array(7).fill(40)];
    const out = computeHrvBalance(series(values, '2026-04-01'), { asOf: '2026-04-28' });
    expect(out.status).toBe('ok');
    if (out.status === 'ok') {
      expect(out.state).toBe('below');
      expect(out.consecutive_below_days).toBeGreaterThan(0);
    }
  });

  it('H5: tracks consecutive_below_days at end of series', () => {
    // 28 days, last 5 below the band.
    const values = [...Array(23).fill(50), ...Array(5).fill(20)];
    const out = computeHrvBalance(series(values, '2026-04-01'), { asOf: '2026-04-28' });
    expect(out.status).toBe('ok');
    if (out.status === 'ok') {
      expect(out.consecutive_below_days).toBe(5);
    }
  });

  it('handles empty input → needs-data', () => {
    const out = computeHrvBalance([]);
    expect(out.status).toBe('needs-data');
  });

  it('rejects invalid asOf date', () => {
    const out = computeHrvBalance(series([50, 50, 50], '2026-04-01'), { asOf: 'invalid' });
    expect(out.status).toBe('needs-data');
  });

  it('uses lowered minBaselineDays when caller asks', () => {
    const out = computeHrvBalance(series(Array(10).fill(50), '2026-04-01'), {
      asOf: '2026-04-10',
      minBaselineDays: 7,
    });
    expect(out.status).toBe('ok');
  });
});
