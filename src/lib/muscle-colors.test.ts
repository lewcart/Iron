import { describe, it, expect } from 'vitest';
import { getMuscleColor, getMuscleGroupColor, getSlugColor } from './muscle-colors';
import { MUSCLE_SLUGS } from './muscles';

describe('getMuscleColor', () => {
  it('returns correct color for chest', () => {
    expect(getMuscleColor(['chest'])).toBe('#3b82f6');
  });

  it('returns correct color for back', () => {
    expect(getMuscleColor(['back'])).toBe('#f97316');
  });

  it('returns correct color for shoulders', () => {
    expect(getMuscleColor(['shoulders'])).toBe('#a855f7');
  });

  it('returns correct color for arms', () => {
    expect(getMuscleColor(['arms'])).toBe('#ec4899');
  });

  it('returns correct color for legs', () => {
    expect(getMuscleColor(['legs'])).toBe('#10b981');
  });

  it('returns correct color for abdominals', () => {
    expect(getMuscleColor(['abdominals'])).toBe('#f59e0b');
  });

  it('returns default color for unknown muscle', () => {
    expect(getMuscleColor(['unknown muscle'])).toBe('#6b7280');
  });

  it('returns default color for empty array', () => {
    expect(getMuscleColor([])).toBe('#6b7280');
  });

  it('is case-insensitive', () => {
    expect(getMuscleColor(['Chest'])).toBe('#3b82f6');
    expect(getMuscleColor(['BACK'])).toBe('#f97316');
    expect(getMuscleColor(['Shoulders'])).toBe('#a855f7');
  });

  it('matches compound muscle names containing a key', () => {
    expect(getMuscleColor(['Upper chest'])).toBe('#3b82f6');
    expect(getMuscleColor(['Lower back'])).toBe('#f97316');
    expect(getMuscleColor(['Forearms'])).toBe('#ec4899'); // contains 'arms'
  });

  it('returns color of first matching muscle when multiple given', () => {
    // chest matches before back
    expect(getMuscleColor(['chest', 'back'])).toBe('#3b82f6');
  });

  it('falls through to second muscle if first is unknown', () => {
    expect(getMuscleColor(['unknown', 'legs'])).toBe('#10b981');
  });
});

describe('getMuscleGroupColor', () => {
  it('returns a defined hex for every parent group', () => {
    expect(getMuscleGroupColor('chest')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(getMuscleGroupColor('back')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(getMuscleGroupColor('shoulders')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(getMuscleGroupColor('arms')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(getMuscleGroupColor('core')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(getMuscleGroupColor('legs')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('uses the canonical "core" key (not stale "abdominals")', () => {
    expect(getMuscleGroupColor('core')).toBe('#f59e0b');
  });
});

describe('getSlugColor', () => {
  it('returns a hex for every canonical slug', () => {
    for (const slug of MUSCLE_SLUGS) {
      expect(getSlugColor(slug)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('routes a back muscle to the back hue', () => {
    expect(getSlugColor('lats')).toBe('#f97316');
  });

  it('routes a leg muscle to the legs hue', () => {
    expect(getSlugColor('quads')).toBe('#10b981');
  });
});
