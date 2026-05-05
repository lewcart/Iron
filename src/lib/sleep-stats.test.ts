import { describe, it, expect } from 'vitest';
import {
  localClockMinutes,
  circularClockStats,
  minsToHHMM,
  isMainSleepNight,
  consistencyScore,
} from './sleep-stats';

// Build a Date from a Brisbane wall-clock time. Brisbane = AEST UTC+10
// year-round (no DST), so we always pin the offset.
function bne(year: number, month: number, day: number, hh: number, mm: number) {
  const mmStr = String(mm).padStart(2, '0');
  const hhStr = String(hh).padStart(2, '0');
  const monthStr = String(month).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');
  return new Date(`${year}-${monthStr}-${dayStr}T${hhStr}:${mmStr}:00+10:00`);
}

describe('localClockMinutes', () => {
  it('returns minutes since midnight in Australia/Brisbane', () => {
    expect(localClockMinutes(bne(2026, 2, 1, 23, 30))).toBe(23 * 60 + 30);
  });
  it('handles 00:05 correctly', () => {
    expect(localClockMinutes(bne(2026, 2, 1, 0, 5))).toBe(5);
  });
  it('Brisbane has no DST: same offset year-round', () => {
    // Mid-July is winter in Brisbane but the offset is still +10.
    expect(localClockMinutes(bne(2026, 7, 15, 23, 0))).toBe(23 * 60);
  });
});

describe('circularClockStats', () => {
  it('returns ~zero stdev when all timestamps are identical', () => {
    const ts = [bne(2026, 2, 1, 23, 0), bne(2026, 2, 2, 23, 0), bne(2026, 2, 3, 23, 0)];
    const r = circularClockStats(ts);
    expect(r.stdev_min).toBeLessThan(0.5);
    expect(r.mean_min).toBeCloseTo(23 * 60, 0);
  });

  it('treats 23:55 and 00:05 as ~10 minutes apart, not 1430', () => {
    const ts = [
      bne(2026, 2, 1, 23, 55),
      bne(2026, 2, 2, 0, 5),
      bne(2026, 2, 3, 23, 55),
      bne(2026, 2, 4, 0, 5),
      bne(2026, 2, 5, 23, 55),
    ];
    const r = circularClockStats(ts);
    expect(r.stdev_min).toBeLessThan(15);
  });

  it('large stdev when bedtimes are far apart', () => {
    // Bedtimes 21:00, 23:00, 01:00 — span of 4 hours
    const ts = [
      bne(2026, 2, 1, 21, 0),
      bne(2026, 2, 2, 23, 0),
      bne(2026, 2, 3, 1, 0),
    ];
    const r = circularClockStats(ts);
    expect(r.stdev_min).toBeGreaterThan(60);
  });

  it('empty array returns zeros, no crash', () => {
    const r = circularClockStats([]);
    expect(r).toEqual({ mean_min: 0, stdev_min: 0 });
  });
});

describe('minsToHHMM', () => {
  it('formats single-digit components with leading zeros', () => {
    expect(minsToHHMM(5)).toBe('00:05');
    expect(minsToHHMM(60)).toBe('01:00');
    expect(minsToHHMM(23 * 60 + 7)).toBe('23:07');
  });
  it('wraps minutes >= 1440 modulo 24h', () => {
    expect(minsToHHMM(1440)).toBe('00:00');
  });
});

describe('isMainSleepNight', () => {
  it('rejects nights under 4h in bed', () => {
    expect(isMainSleepNight(120, bne(2026, 2, 1, 7, 0).getTime())).toBe(false);
    expect(isMainSleepNight(239, bne(2026, 2, 1, 7, 0).getTime())).toBe(false);
  });

  it('accepts nights >= 4h with a normal wake hour', () => {
    expect(isMainSleepNight(240, bne(2026, 2, 1, 7, 0).getTime())).toBe(true);
    expect(isMainSleepNight(480, bne(2026, 2, 1, 7, 30).getTime())).toBe(true);
  });

  it('rejects redeyes / nap-after-redeye that wake before 04:00 Brisbane', () => {
    // 4h sleep ending at 02:00 Brisbane = nap, not main
    expect(isMainSleepNight(240, bne(2026, 2, 1, 2, 0).getTime())).toBe(false);
  });

  it('accepts wake exactly at 04:00', () => {
    expect(isMainSleepNight(300, bne(2026, 2, 1, 4, 0).getTime())).toBe(true);
  });
});

describe('consistencyScore', () => {
  function night(date: string, bed: string, wake: string) {
    // bed/wake are 'HH:MM' Brisbane local time.
    // Bedtime is the *previous* calendar day if bed is after noon.
    const [bh, bm] = bed.split(':').map(Number);
    const [wh, wm] = wake.split(':').map(Number);
    const [y, m, d] = date.split('-').map(Number);
    const bedDay = bh >= 12 ? d - 1 : d;
    const bedDate = bne(y, m, bedDay, bh, bm);
    const wakeDate = bne(y, m, d, wh, wm);
    return { start_at: bedDate, end_at: wakeDate };
  }

  it('returns null with fewer than 5 nights', () => {
    const nights = [
      night('2026-02-02', '23:00', '07:00'),
      night('2026-02-03', '23:00', '07:00'),
      night('2026-02-04', '23:00', '07:00'),
      night('2026-02-05', '23:00', '07:00'),
    ];
    expect(consistencyScore(nights)).toBeNull();
  });

  it('returns null when fewer than 5 nights have envelope data', () => {
    const nights = [
      night('2026-02-02', '23:00', '07:00'),
      night('2026-02-03', '23:00', '07:00'),
      night('2026-02-04', '23:00', '07:00'),
      night('2026-02-05', '23:00', '07:00'),
      { start_at: null, end_at: null },
      { start_at: null, end_at: null },
    ];
    expect(consistencyScore(nights)).toBeNull();
  });

  it('returns high score for very consistent nights', () => {
    const nights = [
      night('2026-02-02', '23:00', '07:00'),
      night('2026-02-03', '23:00', '07:00'),
      night('2026-02-04', '23:00', '07:00'),
      night('2026-02-05', '23:00', '07:00'),
      night('2026-02-06', '23:00', '07:00'),
    ];
    const r = consistencyScore(nights)!;
    expect(r.score).toBeGreaterThanOrEqual(99);
    expect(r.bedtime_stdev_min).toBeLessThanOrEqual(1);
    expect(r.waketime_stdev_min).toBeLessThanOrEqual(1);
    expect(r.typical_bedtime).toBe('23:00');
    expect(r.typical_waketime).toBe('07:00');
  });

  it('lower score when bedtimes vary by ~30 min', () => {
    const nights = [
      night('2026-02-02', '22:30', '07:00'),
      night('2026-02-03', '23:00', '07:00'),
      night('2026-02-04', '23:30', '07:00'),
      night('2026-02-05', '22:30', '07:00'),
      night('2026-02-06', '23:30', '07:00'),
    ];
    const r = consistencyScore(nights)!;
    expect(r.score).toBeGreaterThan(60);
    expect(r.score).toBeLessThan(99);
    expect(r.bedtime_stdev_min).toBeGreaterThan(15);
    expect(r.bedtime_stdev_min).toBeLessThan(45);
  });

  it('handles bedtimes that wrap midnight', () => {
    // Some nights bed at 23:55, others at 00:05 — should be ~10min apart
    const nights = [
      night('2026-02-02', '23:55', '07:00'),
      night('2026-02-03', '00:05', '07:00'),
      night('2026-02-04', '23:55', '07:00'),
      night('2026-02-05', '00:05', '07:00'),
      night('2026-02-06', '23:55', '07:00'),
    ];
    const r = consistencyScore(nights)!;
    expect(r.bedtime_stdev_min).toBeLessThan(15);
    expect(r.score).toBeGreaterThan(80);
  });

  it('matches the documented example: ~14m bed/wake stdev → score in mid-80s', () => {
    // Spread bedtimes/waketimes evenly over ±20 min from a center
    const nights = [
      night('2026-02-02', '22:40', '06:40'),
      night('2026-02-03', '23:00', '07:00'),
      night('2026-02-04', '23:20', '07:20'),
      night('2026-02-05', '22:50', '06:50'),
      night('2026-02-06', '23:10', '07:10'),
    ];
    const r = consistencyScore(nights)!;
    // Stdevs land around 14m; (14+14)/2 = 14, score ≈ 86.
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.score).toBeLessThanOrEqual(95);
    expect(r.bedtime_stdev_min).toBeGreaterThanOrEqual(10);
    expect(r.bedtime_stdev_min).toBeLessThanOrEqual(20);
  });
});
