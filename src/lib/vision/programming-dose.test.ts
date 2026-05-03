import { describe, it, expect } from 'vitest';
import {
  ProgrammingDoseSchema,
  resolveCardioTargets,
} from './programming-dose';

describe('ProgrammingDoseSchema', () => {
  it('accepts a complete blob with all three cardio fields', () => {
    const result = ProgrammingDoseSchema.safeParse({
      cardio_floor_minutes_weekly: { target: 240, rationale: 'general health' },
      cardio_zone2_minutes_weekly: { target: 180 },
      cardio_intervals_minutes_weekly: { target: 60, rationale: '2x weekly HIIT' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty blob (every field optional)', () => {
    const result = ProgrammingDoseSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('passes through unknown fields (existing per-muscle volume keys)', () => {
    const result = ProgrammingDoseSchema.safeParse({
      cardio_floor_minutes_weekly: { target: 240 },
      glutes_sets_weekly: { target: 16 },
      lats_sets_weekly: { target: 14 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).glutes_sets_weekly).toEqual({ target: 16 });
    }
  });

  it('rejects negative target values', () => {
    const result = ProgrammingDoseSchema.safeParse({
      cardio_zone2_minutes_weekly: { target: -10 },
    });
    expect(result.success).toBe(false);
  });
});

describe('resolveCardioTargets', () => {
  it('returns all-null when nothing is set', () => {
    expect(resolveCardioTargets({})).toEqual({
      total: null, zone2: null, intervals: null, any_set: false, split: false,
    });
  });

  it('umbrella only → not split, any_set true', () => {
    expect(resolveCardioTargets({
      cardio_floor_minutes_weekly: { target: 240 },
    })).toEqual({
      total: 240, zone2: null, intervals: null, any_set: true, split: false,
    });
  });

  it('zone2 only → split true', () => {
    expect(resolveCardioTargets({
      cardio_zone2_minutes_weekly: { target: 180 },
    })).toEqual({
      total: null, zone2: 180, intervals: null, any_set: true, split: true,
    });
  });

  it('intervals only → split true', () => {
    expect(resolveCardioTargets({
      cardio_intervals_minutes_weekly: { target: 60 },
    })).toEqual({
      total: null, zone2: null, intervals: 60, any_set: true, split: true,
    });
  });

  it('umbrella + both subs → split true, all values present', () => {
    expect(resolveCardioTargets({
      cardio_floor_minutes_weekly: { target: 240 },
      cardio_zone2_minutes_weekly: { target: 180 },
      cardio_intervals_minutes_weekly: { target: 60 },
    })).toEqual({
      total: 240, zone2: 180, intervals: 60, any_set: true, split: true,
    });
  });

  it('null/undefined safe — does not throw on garbage', () => {
    expect(resolveCardioTargets(null)).toEqual({
      total: null, zone2: null, intervals: null, any_set: false, split: false,
    });
    expect(resolveCardioTargets(undefined)).toEqual({
      total: null, zone2: null, intervals: null, any_set: false, split: false,
    });
    expect(resolveCardioTargets('not an object')).toEqual({
      total: null, zone2: null, intervals: null, any_set: false, split: false,
    });
  });

  it('treats target=0 as "set" (Lou explicitly nulled the floor)', () => {
    expect(resolveCardioTargets({
      cardio_floor_minutes_weekly: { target: 0 },
    })).toEqual({
      total: 0, zone2: null, intervals: null, any_set: true, split: false,
    });
  });

  it('drops malformed sub-target gracefully', () => {
    // Bad target type → safeParse fails → treated as empty dose
    expect(resolveCardioTargets({
      cardio_zone2_minutes_weekly: { target: 'not a number' },
    })).toEqual({
      total: null, zone2: null, intervals: null, any_set: false, split: false,
    });
  });
});
