import { describe, it, expect } from 'vitest';
import { estimate1RM, calculatePRs } from './pr';

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

// ===== calculatePRs =====

describe('calculatePRs', () => {
  it('returns all nulls for empty array', () => {
    const result = calculatePRs([]);
    expect(result.estimated1RM).toBeNull();
    expect(result.heaviestWeight).toBeNull();
    expect(result.mostReps).toBeNull();
  });

  it('returns the single set for all categories when only one set', () => {
    const sets = [{ weight: 100, repetitions: 5, date: '2026-01-01' }];
    const result = calculatePRs(sets);

    expect(result.estimated1RM).not.toBeNull();
    expect(result.heaviestWeight).not.toBeNull();
    expect(result.mostReps).not.toBeNull();

    expect(result.estimated1RM?.weight).toBe(100);
    expect(result.heaviestWeight?.weight).toBe(100);
    expect(result.mostReps?.repetitions).toBe(5);
  });

  it('picks the set with highest estimated 1RM', () => {
    const sets = [
      { weight: 100, repetitions: 5, date: '2026-01-01' },
      { weight: 80, repetitions: 15, date: '2026-01-02' },  // higher 1RM
      { weight: 120, repetitions: 1, date: '2026-01-03' },
    ];
    // 100*(1+5/30)=116.67, 80*(1+15/30)=120, 120*(1+1/30)=124
    const result = calculatePRs(sets);
    expect(result.estimated1RM?.weight).toBe(120);
    expect(result.estimated1RM?.repetitions).toBe(1);
  });

  it('picks the set with heaviest weight', () => {
    const sets = [
      { weight: 100, repetitions: 5, date: '2026-01-01' },
      { weight: 120, repetitions: 1, date: '2026-01-02' },
      { weight: 80, repetitions: 12, date: '2026-01-03' },
    ];
    const result = calculatePRs(sets);
    expect(result.heaviestWeight?.weight).toBe(120);
  });

  it('picks the set with most reps', () => {
    const sets = [
      { weight: 100, repetitions: 5, date: '2026-01-01' },
      { weight: 60, repetitions: 20, date: '2026-01-02' },
      { weight: 80, repetitions: 12, date: '2026-01-03' },
    ];
    const result = calculatePRs(sets);
    expect(result.mostReps?.repetitions).toBe(20);
    expect(result.mostReps?.weight).toBe(60);
  });

  it('includes estimated_1rm in each PR record', () => {
    const sets = [{ weight: 100, repetitions: 10, date: '2026-01-01' }];
    const result = calculatePRs(sets);
    expect(result.estimated1RM?.estimated_1rm).toBeCloseTo(133.33, 1);
    expect(result.heaviestWeight?.estimated_1rm).toBeCloseTo(133.33, 1);
    expect(result.mostReps?.estimated_1rm).toBeCloseTo(133.33, 1);
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
    expect(result.heaviestWeight?.date).toBe('2026-01-01');
  });
});
