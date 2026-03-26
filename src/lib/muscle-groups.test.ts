import { describe, it, expect } from 'vitest';
import { exerciseMatchesMuscleGroup, muscleGroupSearchTerms } from './muscle-groups';

describe('muscleGroupSearchTerms', () => {
  it('returns anatomical synonyms for chest', () => {
    expect(muscleGroupSearchTerms('chest')).toContain('pectoralis');
  });

  it('returns empty for unknown group', () => {
    expect(muscleGroupSearchTerms('unknown')).toEqual([]);
  });
});

describe('exerciseMatchesMuscleGroup', () => {
  it('matches Iron-style pectoralis to chest', () => {
    expect(
      exerciseMatchesMuscleGroup(['pectoralis major'], ['triceps brachii'], 'chest')
    ).toBe(true);
  });

  it('matches latissimus to back', () => {
    expect(exerciseMatchesMuscleGroup(['latissimus dorsi'], [], 'back')).toBe(true);
  });

  it('does not match chest for pure leg exercise', () => {
    expect(exerciseMatchesMuscleGroup(['quadriceps'], [], 'chest')).toBe(false);
  });
});
