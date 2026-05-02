import { describe, it, expect } from 'vitest';
import {
  REP_WINDOWS,
  REP_WINDOW_ORDER,
  windowForReps,
  snapToWindow,
  nextWindowUp,
  nextWindowDown,
  windowBounds,
} from './rep-windows';

describe('REP_WINDOWS registry', () => {
  it('has 5 windows in the expected order', () => {
    expect(REP_WINDOW_ORDER).toEqual(['strength', 'power', 'build', 'pump', 'endurance']);
  });

  it('windows form a contiguous spectrum (each window starts where the previous ends)', () => {
    for (let i = 1; i < REP_WINDOW_ORDER.length; i++) {
      const prev = REP_WINDOWS[REP_WINDOW_ORDER[i - 1]];
      const curr = REP_WINDOWS[REP_WINDOW_ORDER[i]];
      expect(curr.min).toBe(prev.max);
    }
  });
});

describe('windowForReps', () => {
  it('returns null below strength minimum', () => {
    expect(windowForReps(3)).toBeNull();
    expect(windowForReps(0)).toBeNull();
  });

  it('lower window claims shared boundary reps (inclusive upper bound)', () => {
    expect(windowForReps(6)).toBe('strength');   // 6 = strength.max, not power.min
    expect(windowForReps(8)).toBe('power');      // 8 = power.max, not build.min
    expect(windowForReps(12)).toBe('build');     // 12 = build.max, not pump.min
    expect(windowForReps(15)).toBe('pump');      // 15 = pump.max, not endurance.min
  });

  it('classifies mid-window reps correctly', () => {
    expect(windowForReps(4)).toBe('strength');
    expect(windowForReps(5)).toBe('strength');
    expect(windowForReps(7)).toBe('power');
    expect(windowForReps(10)).toBe('build');
    expect(windowForReps(13)).toBe('pump');
    expect(windowForReps(20)).toBe('endurance');
  });

  it('catches drift past pump into endurance', () => {
    expect(windowForReps(16)).toBe('endurance');
    expect(windowForReps(30)).toBe('endurance');
    expect(windowForReps(50)).toBe('endurance');
  });
});

describe('snapToWindow', () => {
  it('snaps exact registered ranges', () => {
    expect(snapToWindow(4, 6)).toBe('strength');
    expect(snapToWindow(6, 8)).toBe('power');
    expect(snapToWindow(8, 12)).toBe('build');
    expect(snapToWindow(12, 15)).toBe('pump');
    expect(snapToWindow(15, 30)).toBe('endurance');
  });

  it('returns null for custom (non-snapping) ranges', () => {
    expect(snapToWindow(5, 15)).toBeNull();
    expect(snapToWindow(8, 10)).toBeNull();
    expect(snapToWindow(10, 20)).toBeNull();
  });
});

describe('nextWindowUp / nextWindowDown', () => {
  it('walks the spectrum in both directions', () => {
    expect(nextWindowUp('strength')).toBe('power');
    expect(nextWindowUp('power')).toBe('build');
    expect(nextWindowUp('build')).toBe('pump');
    expect(nextWindowUp('pump')).toBe('endurance');
    expect(nextWindowUp('endurance')).toBeNull();

    expect(nextWindowDown('endurance')).toBe('pump');
    expect(nextWindowDown('pump')).toBe('build');
    expect(nextWindowDown('build')).toBe('power');
    expect(nextWindowDown('power')).toBe('strength');
    expect(nextWindowDown('strength')).toBeNull();
  });
});

describe('windowBounds', () => {
  it('returns the registered min/max for each window', () => {
    expect(windowBounds('strength')).toEqual({ min: 4, max: 6 });
    expect(windowBounds('build')).toEqual({ min: 8, max: 12 });
    expect(windowBounds('endurance')).toEqual({ min: 15, max: 30 });
  });
});
