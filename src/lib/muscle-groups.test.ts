import { describe, it, expect } from 'vitest';
import { exerciseMatchesMuscleGroup, muscleGroupSearchTerms } from './muscle-groups';

describe('muscleGroupSearchTerms', () => {
  it('returns canonical chest slugs', () => {
    expect(muscleGroupSearchTerms('chest')).toEqual(['chest']);
  });

  it('returns all back parent_group slugs', () => {
    const back = muscleGroupSearchTerms('back');
    expect(back).toContain('lats');
    expect(back).toContain('rhomboids');
    expect(back).toContain('mid_traps');
    expect(back).toContain('lower_traps');
    expect(back).toContain('erectors');
  });

  it('maps abdominals UI key to core', () => {
    expect(muscleGroupSearchTerms('abdominals')).toEqual(['core']);
  });

  it('returns empty for unknown group', () => {
    expect(muscleGroupSearchTerms('unknown')).toEqual([]);
  });
});

describe('exerciseMatchesMuscleGroup', () => {
  it('matches canonical chest slug to chest UI key', () => {
    expect(exerciseMatchesMuscleGroup(['chest'], ['triceps'], 'chest')).toBe(true);
  });

  it('matches lats to back', () => {
    expect(exerciseMatchesMuscleGroup(['lats'], [], 'back')).toBe(true);
  });

  it('matches via secondary muscles too', () => {
    expect(exerciseMatchesMuscleGroup(['chest'], ['triceps'], 'arms')).toBe(true);
  });

  it('does not match chest for pure leg exercise', () => {
    expect(exerciseMatchesMuscleGroup(['quads'], [], 'chest')).toBe(false);
  });
});
