import { describe, it, expect } from 'vitest';
import { reclassifyWorkout } from './healthkit';
import type { HealthWorkout } from './healthkit';

function makeWorkout(overrides: Partial<HealthWorkout> = {}): HealthWorkout {
  return {
    startTime: 1000000,
    endTime: 1003600000,
    durationMinutes: 60,
    activeCalories: 300,
    activityType: 'Running',
    ...overrides,
  };
}

describe('reclassifyWorkout', () => {
  it('leaves non-remapped activity types unchanged', () => {
    const w = makeWorkout({ activityType: 'Running', activeCalories: 300 });
    expect(reclassifyWorkout(w)).toEqual(w);
  });

  it('leaves Walking unchanged (gym commute, full value)', () => {
    const w = makeWorkout({ activityType: 'Walking', activeCalories: 200 });
    expect(reclassifyWorkout(w)).toEqual(w);
  });

  it('reclassifies Hiking → Dog Walk', () => {
    const w = makeWorkout({ activityType: 'Hiking', activeCalories: 300 });
    const result = reclassifyWorkout(w);
    expect(result.activityType).toBe('Dog Walk');
  });

  it('applies 0.65x intensity multiplier to calories for Hiking', () => {
    const w = makeWorkout({ activityType: 'Hiking', activeCalories: 300 });
    const result = reclassifyWorkout(w);
    expect(result.activeCalories).toBe(195); // 300 * 0.65
  });

  it('rounds fractional calories', () => {
    const w = makeWorkout({ activityType: 'Hiking', activeCalories: 100 });
    const result = reclassifyWorkout(w);
    expect(result.activeCalories).toBe(65); // 100 * 0.65
  });

  it('preserves all other workout fields when reclassifying', () => {
    const w = makeWorkout({ activityType: 'Hiking', activeCalories: 200, durationMinutes: 45 });
    const result = reclassifyWorkout(w);
    expect(result.startTime).toBe(w.startTime);
    expect(result.endTime).toBe(w.endTime);
    expect(result.durationMinutes).toBe(45);
    expect(result.distanceMeters).toBeUndefined();
  });

  it('does not mutate the original workout object', () => {
    const w = makeWorkout({ activityType: 'Hiking', activeCalories: 300 });
    reclassifyWorkout(w);
    expect(w.activityType).toBe('Hiking');
    expect(w.activeCalories).toBe(300);
  });
});
