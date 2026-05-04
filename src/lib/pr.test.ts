import { describe, it, expect } from 'vitest';
import {
  estimate1RM,
  calculatePRs,
  isNewEstimated1RM,
  calculateTimePRs,
  isNewLongestHold,
} from './pr';

// ===== estimate1RM =====

describe('estimate1RM', () => {
  it('calculates correctly for 100kg × 10 reps', () => {
    // 100 * (1 + 10/30) = 100 * 1.333... ≈ 133.33
    expect(estimate1RM(100, 10)).toBeCloseTo(133.33, 1);
  });

  it('returns 0 when weight is 0', () => {
    expect(estimate1RM(0, 10)).toBe(0);
  });

  it('returns 0 when reps is 0', () => {
    expect(estimate1RM(100, 0)).toBe(0);
  });

  it('returns weight when reps is 1', () => {
    // 100 * (1 + 1/30) = 100 * 1.0333... ≈ 103.33
    expect(estimate1RM(100, 1)).toBeCloseTo(103.33, 1);
  });

  it('returns weight × 2 when reps is 30', () => {
    // weight * (1 + 30/30) = weight * 2
    expect(estimate1RM(80, 30)).toBeCloseTo(160, 5);
  });

  it('handles fractional weights', () => {
    expect(estimate1RM(62.5, 5)).toBeCloseTo(62.5 * (1 + 5 / 30), 5);
  });

  it('returns 0 when both weight and reps are 0', () => {
    expect(estimate1RM(0, 0)).toBe(0);
  });
});

// ===== isNewEstimated1RM =====

describe('isNewEstimated1RM', () => {
  it('returns true when estimated 1RM exceeds all-time best', () => {
    // estimate1RM(100, 10) ≈ 133.33
    expect(isNewEstimated1RM(100, 10, 130)).toBe(true);
  });

  it('returns false when estimated 1RM equals all-time best', () => {
    const orm = 100 * (1 + 10 / 30); // ≈ 133.33
    expect(isNewEstimated1RM(100, 10, orm)).toBe(false);
  });

  it('returns false when estimated 1RM is below all-time best', () => {
    expect(isNewEstimated1RM(80, 5, 200)).toBe(false);
  });

  it('returns false when weight is 0', () => {
    expect(isNewEstimated1RM(0, 10, 0)).toBe(false);
  });

  it('returns false when reps is 0', () => {
    expect(isNewEstimated1RM(100, 0, 0)).toBe(false);
  });

  it('returns true against a zero all-time best (first ever set)', () => {
    expect(isNewEstimated1RM(60, 5, 0)).toBe(true);
  });
});

// ===== calculatePRs =====

describe('calculatePRs', () => {
  it('returns null for empty array', () => {
    const result = calculatePRs([]);
    expect(result.estimated1RM).toBeNull();
  });

  it('returns the only set when one set', () => {
    const sets = [{ weight: 100, repetitions: 5, date: '2026-01-01' }];
    const result = calculatePRs(sets);
    expect(result.estimated1RM).not.toBeNull();
    expect(result.estimated1RM?.weight).toBe(100);
    expect(result.estimated1RM?.repetitions).toBe(5);
  });

  it('picks the set with highest estimated 1RM', () => {
    const sets = [
      { weight: 100, repetitions: 5, date: '2026-01-01' },
      { weight: 80, repetitions: 15, date: '2026-01-02' },
      { weight: 120, repetitions: 1, date: '2026-01-03' },
    ];
    // 100*(1+5/30)=116.67, 80*(1+15/30)=120, 120*(1+1/30)=124
    const result = calculatePRs(sets);
    expect(result.estimated1RM?.weight).toBe(120);
    expect(result.estimated1RM?.repetitions).toBe(1);
  });

  it('rejects pure-volume gaming: high reps at low weight does not beat heavier 1RM', () => {
    const sets = [
      { weight: 100, repetitions: 5, date: '2026-01-01' },   // e1RM 116.67
      { weight: 60, repetitions: 20, date: '2026-01-02' },   // e1RM 100
    ];
    const result = calculatePRs(sets);
    expect(result.estimated1RM?.weight).toBe(100);
    expect(result.estimated1RM?.repetitions).toBe(5);
  });

  it('includes estimated_1rm on the record', () => {
    const sets = [{ weight: 100, repetitions: 10, date: '2026-01-01' }];
    const result = calculatePRs(sets);
    expect(result.estimated1RM?.estimated_1rm).toBeCloseTo(133.33, 1);
  });

  it('preserves date and workout_uuid on the record', () => {
    const sets = [
      {
        weight: 100,
        repetitions: 5,
        date: '2026-03-15',
        workout_uuid: 'wo-123',
        exercise_uuid: 'ex-456',
      },
    ];
    const result = calculatePRs(sets);
    expect(result.estimated1RM?.date).toBe('2026-03-15');
    expect(result.estimated1RM?.workout_uuid).toBe('wo-123');
    expect(result.estimated1RM?.exercise_uuid).toBe('ex-456');
  });

  it('handles multiple sets with same best value (picks first encountered)', () => {
    const sets = [
      { weight: 100, repetitions: 10, date: '2026-01-01' },
      { weight: 100, repetitions: 10, date: '2026-01-02' },
    ];
    const result = calculatePRs(sets);
    // First set wins (strict greater-than comparison)
    expect(result.estimated1RM?.date).toBe('2026-01-01');
  });
});

// ===== calculateTimePRs =====

describe('calculateTimePRs', () => {
  it('returns null + 0 for empty array', () => {
    const result = calculateTimePRs([]);
    expect(result.longestHold).toBeNull();
    expect(result.totalSeconds).toBe(0);
  });

  it('picks the single set when only one provided', () => {
    const result = calculateTimePRs([{ duration_seconds: 60, date: '2026-01-01' }]);
    expect(result.longestHold?.duration_seconds).toBe(60);
    expect(result.totalSeconds).toBe(60);
  });

  it('picks the longest hold across multiple sets', () => {
    const sets = [
      { duration_seconds: 30, date: '2026-01-01' },
      { duration_seconds: 90, date: '2026-01-02' },
      { duration_seconds: 60, date: '2026-01-03' },
    ];
    const result = calculateTimePRs(sets);
    expect(result.longestHold?.duration_seconds).toBe(90);
    expect(result.longestHold?.date).toBe('2026-01-02');
    expect(result.totalSeconds).toBe(180);
  });

  it('preserves workout_uuid + exercise_uuid on the record', () => {
    const sets = [{
      duration_seconds: 75,
      date: '2026-03-15',
      workout_uuid: 'wo-time-1',
      exercise_uuid: 'plank-uuid',
    }];
    const result = calculateTimePRs(sets);
    expect(result.longestHold?.workout_uuid).toBe('wo-time-1');
    expect(result.longestHold?.exercise_uuid).toBe('plank-uuid');
  });

  it('first-encountered wins on tie (strict greater-than)', () => {
    const sets = [
      { duration_seconds: 60, date: '2026-01-01' },
      { duration_seconds: 60, date: '2026-01-02' },
    ];
    expect(calculateTimePRs(sets).longestHold?.date).toBe('2026-01-01');
  });
});

// ===== isNewLongestHold =====

describe('isNewLongestHold', () => {
  it('returns true when duration exceeds all-time best', () => {
    expect(isNewLongestHold(120, 90)).toBe(true);
  });

  it('returns false when duration equals all-time best', () => {
    expect(isNewLongestHold(90, 90)).toBe(false);
  });

  it('returns false when duration is below all-time best', () => {
    expect(isNewLongestHold(60, 90)).toBe(false);
  });

  it('returns false when duration is 0', () => {
    expect(isNewLongestHold(0, 0)).toBe(false);
  });

  it('returns true against zero all-time best (first ever set)', () => {
    expect(isNewLongestHold(30, 0)).toBe(true);
  });
});
