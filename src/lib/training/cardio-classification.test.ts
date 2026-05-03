import { describe, it, expect } from 'vitest';
import {
  classifyActivityType,
  aggregateMinutes,
  type ClassifiedWorkout,
} from './cardio-classification';

describe('classifyActivityType', () => {
  it('walking is zone2', () => {
    expect(classifyActivityType('walking', 60)).toBe('zone2');
  });

  it('hiking is zone2 regardless of duration', () => {
    expect(classifyActivityType('hiking', 15)).toBe('zone2');
    expect(classifyActivityType('hiking', 240)).toBe('zone2');
  });

  it('outdoor cycling is zone2', () => {
    expect(classifyActivityType('cycling_outdoor', 90)).toBe('zone2');
  });

  it('high_intensity_interval_training is intervals regardless of duration', () => {
    expect(classifyActivityType('high_intensity_interval_training', 12)).toBe('intervals');
    expect(classifyActivityType('high_intensity_interval_training', 60)).toBe('intervals');
  });

  it('rowing < 30min is intervals (HIIT proxy)', () => {
    expect(classifyActivityType('rowing', 15)).toBe('intervals');
    expect(classifyActivityType('rowing', 29)).toBe('intervals');
  });

  it('rowing >= 30min is zone2 (steady proxy)', () => {
    expect(classifyActivityType('rowing', 30)).toBe('zone2');
    expect(classifyActivityType('rowing', 60)).toBe('zone2');
  });

  it('cycling_indoor short is intervals; long is zone2', () => {
    expect(classifyActivityType('cycling_indoor', 20)).toBe('intervals');
    expect(classifyActivityType('cycling_indoor', 45)).toBe('zone2');
  });

  it('strength activities are uncategorized', () => {
    expect(classifyActivityType('traditional_strength', 60)).toBe('uncategorized');
    expect(classifyActivityType('functional_strength_training', 60)).toBe('uncategorized');
    expect(classifyActivityType('core_training', 30)).toBe('uncategorized');
  });

  it('unknown activity types are uncategorized', () => {
    expect(classifyActivityType('flatulence_olympics', 90)).toBe('uncategorized');
    expect(classifyActivityType('', 30)).toBe('uncategorized');
  });

  it('case-insensitive matching', () => {
    expect(classifyActivityType('WALKING', 60)).toBe('zone2');
    expect(classifyActivityType('Cycling_Outdoor', 60)).toBe('zone2');
  });
});

describe('aggregateMinutes', () => {
  it('sums zone2 and intervals separately, drops uncategorized', () => {
    const workouts: ClassifiedWorkout[] = [
      { category: 'zone2', duration_minutes: 60 },
      { category: 'zone2', duration_minutes: 45 },
      { category: 'intervals', duration_minutes: 20 },
      { category: 'intervals', duration_minutes: 30 },
      { category: 'uncategorized', duration_minutes: 90 }, // strength — dropped
    ];
    expect(aggregateMinutes(workouts)).toEqual({
      zone2: 105,
      intervals: 50,
      total: 155,
    });
  });

  it('empty list returns zeros', () => {
    expect(aggregateMinutes([])).toEqual({ zone2: 0, intervals: 0, total: 0 });
  });

  it('all-strength week returns zeros (silent)', () => {
    const workouts: ClassifiedWorkout[] = [
      { category: 'uncategorized', duration_minutes: 60 },
      { category: 'uncategorized', duration_minutes: 75 },
    ];
    expect(aggregateMinutes(workouts)).toEqual({ zone2: 0, intervals: 0, total: 0 });
  });
});
