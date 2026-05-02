import { describe, it, expect } from 'vitest';
import { normalizeMuscleTags } from './muscles';

describe('normalizeMuscleTags', () => {
  it('handles null inputs', () => {
    expect(normalizeMuscleTags(null, null)).toEqual({ primary: [], secondary: [] });
  });

  it('handles non-array inputs', () => {
    expect(normalizeMuscleTags('not-an-array', 42)).toEqual({ primary: [], secondary: [] });
  });

  it('handles empty arrays', () => {
    expect(normalizeMuscleTags([], [])).toEqual({ primary: [], secondary: [] });
  });

  it('passes canonical slugs through', () => {
    expect(normalizeMuscleTags(['chest'], ['triceps', 'delts'])).toEqual({
      primary: ['chest'],
      secondary: ['triceps', 'delts'],
    });
  });

  it('resolves legacy synonyms', () => {
    // "shoulders" → delts; "rear delts" → delts (dedups across primary/secondary)
    expect(normalizeMuscleTags(['shoulders'], ['rear delts'])).toEqual({
      primary: ['delts'],
      secondary: [],
    });
  });

  it('drops unknown values silently', () => {
    expect(normalizeMuscleTags(['chest', 'UNKNOWN'], ['BAD', 'triceps'])).toEqual({
      primary: ['chest'],
      secondary: ['triceps'],
    });
  });

  it('dedupes within a single bucket', () => {
    expect(normalizeMuscleTags(['chest', 'chest'], ['triceps'])).toEqual({
      primary: ['chest'],
      secondary: ['triceps'],
    });
  });

  it('primary wins when same slug appears in both buckets', () => {
    expect(normalizeMuscleTags(['chest'], ['chest', 'triceps'])).toEqual({
      primary: ['chest'],
      secondary: ['triceps'],
    });
  });

  it('skips non-string entries inside an array', () => {
    expect(normalizeMuscleTags(['chest', null, 42, undefined], ['triceps'])).toEqual({
      primary: ['chest'],
      secondary: ['triceps'],
    });
  });

  it('resolves case-insensitively via the synonyms table', () => {
    // resolveMuscleSlug lowercases input
    expect(normalizeMuscleTags(['CHEST'], ['Triceps'])).toEqual({
      primary: ['chest'],
      secondary: ['triceps'],
    });
  });
});
