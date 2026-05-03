import { describe, it, expect } from 'vitest';
import { buildAnchorLiftTrend, type AnchorLiftSetInput } from './anchor-lift-trend';

function set(weight: number, reps: number, weUuid: string, completed = true): AnchorLiftSetInput {
  return {
    is_completed: completed,
    weight,
    repetitions: reps,
    workout_exercise_uuid: weUuid,
  };
}

describe('buildAnchorLiftTrend', () => {
  it('E5: empty input → needs-data with short "no recent log" copy (mobile-safe)', () => {
    const trend = buildAnchorLiftTrend([], new Map(), { anchorDisplayName: 'Hip Thrust' });
    expect(trend.status).toBe('needs-data');
    if (trend.status === 'needs-data') {
      // Copy must stay short — the AnchorLiftTrendTile right column truncates
      // mid-word at 375px when this string is long. Keep ≤ 20 chars.
      expect(trend.reason.length).toBeLessThanOrEqual(20);
      expect(trend.reason.toLowerCase()).toContain('no recent log');
    }
  });

  it('E7: only 1 session → needs-data with "N more sessions needed" (mobile-safe copy)', () => {
    const trend = buildAnchorLiftTrend(
      [set(100, 5, 'we1')],
      new Map([['we1', '2026-04-01']]),
      { anchorDisplayName: 'Hip Thrust' },
    );
    expect(trend.status).toBe('needs-data');
    if (trend.status === 'needs-data') {
      expect(trend.reason).toMatch(/2 more sessions? needed/);
      // Ensure short enough for the right column.
      expect(trend.reason.length).toBeLessThanOrEqual(28);
    }
  });

  it('E4: 4 sessions → ok with sorted ascending series', () => {
    const sets = [
      set(100, 5, 'we1'),
      set(110, 5, 'we2'),
      set(110, 6, 'we3'),
      set(115, 5, 'we4'),
    ];
    const dates = new Map([
      ['we1', '2026-04-01'],
      ['we2', '2026-04-08'],
      ['we3', '2026-04-15'],
      ['we4', '2026-04-22'],
    ]);
    const trend = buildAnchorLiftTrend(sets, dates);
    expect(trend.status).toBe('ok');
    if (trend.status === 'ok') {
      expect(trend.sessions).toHaveLength(4);
      expect(trend.sessions[0].date).toBe('2026-04-01');
      expect(trend.sessions[3].date).toBe('2026-04-22');
      expect(trend.delta_kg).toBeGreaterThan(0);
    }
  });

  it('takes the highest e1RM per date (multiple sets same day)', () => {
    const sets = [
      set(100, 5, 'we1'), // e1rm ~ 116.7
      set(80, 12, 'we1'), // e1rm = 80*(1+12/30) = 112
      set(110, 5, 'we2'),
      set(115, 5, 'we3'),
    ];
    const dates = new Map([
      ['we1', '2026-04-01'],
      ['we2', '2026-04-08'],
      ['we3', '2026-04-15'],
    ]);
    const trend = buildAnchorLiftTrend(sets, dates);
    expect(trend.status).toBe('ok');
    if (trend.status === 'ok') {
      expect(trend.sessions[0].e1rm).toBeCloseTo(116.7, 1);
      expect(trend.sessions[0].best_weight).toBe(100);
      expect(trend.sessions[0].best_reps).toBe(5);
    }
  });

  it('filters out incomplete sets', () => {
    const sets = [
      set(100, 5, 'we1', false), // incomplete — must be ignored
      set(110, 5, 'we1'),
      set(115, 5, 'we2'),
      set(120, 5, 'we3'),
    ];
    const dates = new Map([['we1', '2026-04-01'], ['we2', '2026-04-08'], ['we3', '2026-04-15']]);
    const trend = buildAnchorLiftTrend(sets, dates);
    expect(trend.status).toBe('ok');
    if (trend.status === 'ok') {
      expect(trend.sessions[0].best_weight).toBe(110);
    }
  });

  it('filters out zero-weight or zero-rep sets', () => {
    const sets = [
      set(0, 5, 'we1'),
      set(100, 0, 'we1'),
      set(100, 5, 'we1'),
      set(110, 5, 'we2'),
      set(120, 5, 'we3'),
    ];
    const dates = new Map([['we1', '2026-04-01'], ['we2', '2026-04-08'], ['we3', '2026-04-15']]);
    const trend = buildAnchorLiftTrend(sets, dates);
    expect(trend.status).toBe('ok');
    if (trend.status === 'ok') {
      expect(trend.sessions[0].best_weight).toBe(100);
    }
  });

  it('computes delta_pct correctly', () => {
    const sets = [
      set(100, 5, 'we1'),
      set(110, 5, 'we2'),
      set(120, 5, 'we3'),
    ];
    const dates = new Map([['we1', '2026-04-01'], ['we2', '2026-04-08'], ['we3', '2026-04-15']]);
    const trend = buildAnchorLiftTrend(sets, dates);
    expect(trend.status).toBe('ok');
    if (trend.status === 'ok') {
      // 100 → 120 = +20% on weight; e1rm scales linearly with weight at fixed reps
      expect(trend.delta_pct).toBeCloseTo(20, 1);
    }
  });

  it('respects custom minSessions threshold', () => {
    const sets = [
      set(100, 5, 'we1'),
      set(110, 5, 'we2'),
    ];
    const dates = new Map([['we1', '2026-04-01'], ['we2', '2026-04-08']]);
    const trend = buildAnchorLiftTrend(sets, dates, { minSessions: 2 });
    expect(trend.status).toBe('ok');
  });

  it('returns needs-data when set has unknown workout_exercise_uuid', () => {
    const sets = [set(100, 5, 'we1')];
    const dates = new Map<string, string>(); // empty
    const trend = buildAnchorLiftTrend(sets, dates);
    expect(trend.status).toBe('needs-data');
  });
});
