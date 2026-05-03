import { describe, it, expect } from 'vitest';
import { isoWeekStart, isoDayOfWeek, emptyWeekFacts } from './week-facts';

describe('isoWeekStart', () => {
  it('returns Monday for a Thursday', () => {
    // 2026-04-30 is a Thursday → Monday = 2026-04-27.
    expect(isoWeekStart(new Date('2026-04-30T12:00:00Z'))).toBe('2026-04-27');
  });

  it('returns Monday for a Sunday (treats Sunday as last day of prior week)', () => {
    // 2026-04-26 is a Sunday → Monday = 2026-04-20.
    expect(isoWeekStart(new Date('2026-04-26T12:00:00Z'))).toBe('2026-04-20');
  });

  it('returns the same day when given a Monday', () => {
    expect(isoWeekStart(new Date('2026-04-27T12:00:00Z'))).toBe('2026-04-27');
  });
});

describe('isoDayOfWeek', () => {
  it('Mon=1', () => {
    expect(isoDayOfWeek(new Date('2026-04-27T12:00:00Z'))).toBe(1);
  });

  it('Sun=7', () => {
    expect(isoDayOfWeek(new Date('2026-04-26T12:00:00Z'))).toBe(7);
  });

  it('Thu=4', () => {
    expect(isoDayOfWeek(new Date('2026-04-30T12:00:00Z'))).toBe(4);
  });
});

describe('emptyWeekFacts', () => {
  it('returns a sane shell', () => {
    const f = emptyWeekFacts(new Date('2026-04-30T12:00:00Z'));
    expect(f.week_start).toBe('2026-04-27');
    expect(f.today).toBe('2026-04-30');
    expect(f.day_of_week).toBe(4);
    expect(f.setsByMuscle).toEqual([]);
    expect(f.bodyweight).toEqual([]);
    expect(f.vision).toBe(null);
    expect(f.recovery.status).toBe('unknown');
  });
});
