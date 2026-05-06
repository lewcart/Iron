import { describe, it, expect } from 'vitest';
import {
  restoreState,
  onStart,
  onStop,
  onSwitchComplete,
  onResumeFromPause,
  onLogFirstOnly,
  finalDurationSeconds,
  computeElapsed,
  computeSwitchRemaining,
  isOwnerTab,
  newTabId,
  SWITCH_DURATION_MS,
  type StopwatchState,
} from './stopwatch-utils';

const makeState = (overrides: Partial<StopwatchState> = {}): StopwatchState => ({
  setRowKey: 'we-uuid:set-uuid',
  ownerTabId: 'tab-1',
  hasSides: false,
  phase: 'counting',
  side: 1,
  startedAt: 1_000_000,
  side1Elapsed: null,
  side2Elapsed: null,
  switchEndTime: null,
  updatedAt: 1_000_000,
  ...overrides,
});

describe('computeElapsed', () => {
  it('returns whole seconds, ceil', () => {
    expect(computeElapsed(1_000_000, 1_030_400)).toBe(31);
    expect(computeElapsed(1_000_000, 1_000_400)).toBe(1);
  });

  it('clamps negative to 0', () => {
    expect(computeElapsed(1_000_000, 999_500)).toBe(0);
  });
});

describe('computeSwitchRemaining', () => {
  it('counts down from 10', () => {
    const end = 1_010_000;
    expect(computeSwitchRemaining(end, 1_000_000)).toBe(10);
    expect(computeSwitchRemaining(end, 1_005_000)).toBe(5);
    expect(computeSwitchRemaining(end, 1_009_999)).toBe(0);
  });

  it('clamps negative to 0', () => {
    expect(computeSwitchRemaining(1_000_000, 1_010_000)).toBe(0);
  });
});

describe('restoreState — switch_expired_paused gating', () => {
  it('switching past switchEndTime → switch_expired_paused (NOT counting side 2)', () => {
    const s = makeState({
      hasSides: true,
      phase: 'switching',
      side: 1,
      side1Elapsed: 42,
      switchEndTime: 1_010_000,
    });
    const restored = restoreState(s, 1_500_000); // 8+ minutes past switchEndTime
    expect(restored.phase).toBe('switch_expired_paused');
    expect(restored.side).toBe(1);
    expect(restored.side1Elapsed).toBe(42);
    expect(restored.switchEndTime).toBeNull();
  });

  it('switching before switchEndTime → unchanged', () => {
    const s = makeState({
      hasSides: true,
      phase: 'switching',
      side: 1,
      switchEndTime: 1_010_000,
    });
    const restored = restoreState(s, 1_005_000);
    expect(restored.phase).toBe('switching');
    expect(restored.switchEndTime).toBe(1_010_000);
  });

  it('counting phase passes through unchanged', () => {
    const s = makeState({ phase: 'counting' });
    const restored = restoreState(s, 1_999_999_999);
    expect(restored.phase).toBe('counting');
  });
});

describe('onStop', () => {
  it('non-unilateral counting → done with side1Elapsed', () => {
    const s = makeState({ hasSides: false, startedAt: 1_000_000 });
    const next = onStop(s, 1_042_000);
    expect(next.phase).toBe('done');
    expect(next.side1Elapsed).toBe(42);
    expect(next.side2Elapsed).toBeNull();
  });

  it('unilateral side 1 counting → switching with switchEndTime', () => {
    const s = makeState({ hasSides: true, side: 1, startedAt: 1_000_000 });
    const next = onStop(s, 1_042_000);
    expect(next.phase).toBe('switching');
    expect(next.side1Elapsed).toBe(42);
    expect(next.switchEndTime).toBe(1_042_000 + SWITCH_DURATION_MS);
  });

  it('unilateral side 2 counting → done with side2Elapsed', () => {
    const s = makeState({
      hasSides: true,
      side: 2,
      startedAt: 1_100_000,
      side1Elapsed: 42,
    });
    const next = onStop(s, 1_138_000);
    expect(next.phase).toBe('done');
    expect(next.side1Elapsed).toBe(42);
    expect(next.side2Elapsed).toBe(38);
  });

  it('non-counting phases pass through', () => {
    const s = makeState({ phase: 'switching' });
    expect(onStop(s, 1_000_000).phase).toBe('switching');
  });
});

describe('onSwitchComplete', () => {
  it('switching → counting side 2 with fresh startedAt', () => {
    const s = makeState({
      hasSides: true,
      phase: 'switching',
      side: 1,
      side1Elapsed: 42,
      switchEndTime: 1_010_000,
    });
    const next = onSwitchComplete(s, 1_005_000);
    expect(next.phase).toBe('counting');
    expect(next.side).toBe(2);
    expect(next.startedAt).toBe(1_005_000);
    expect(next.switchEndTime).toBeNull();
    expect(next.side1Elapsed).toBe(42); // preserved
  });
});

describe('onResumeFromPause', () => {
  it('switch_expired_paused → counting side 2', () => {
    const s = makeState({
      hasSides: true,
      phase: 'switch_expired_paused',
      side: 1,
      side1Elapsed: 42,
    });
    const next = onResumeFromPause(s, 2_000_000);
    expect(next.phase).toBe('counting');
    expect(next.side).toBe(2);
    expect(next.startedAt).toBe(2_000_000);
  });
});

describe('onLogFirstOnly', () => {
  it('switch_expired_paused → done, side2 stays null', () => {
    const s = makeState({
      hasSides: true,
      phase: 'switch_expired_paused',
      side1Elapsed: 42,
    });
    const next = onLogFirstOnly(s, 2_000_000);
    expect(next.phase).toBe('done');
    expect(next.side1Elapsed).toBe(42);
    expect(next.side2Elapsed).toBeNull();
  });
});

describe('finalDurationSeconds — average-of-two for unilateral', () => {
  it('non-unilateral returns side1Elapsed', () => {
    const s = makeState({ hasSides: false, side1Elapsed: 42 });
    expect(finalDurationSeconds(s)).toBe(42);
  });

  it('unilateral with both sides logged returns the average', () => {
    const s = makeState({ hasSides: true, side1Elapsed: 42, side2Elapsed: 38 });
    expect(finalDurationSeconds(s)).toBe(40);
  });

  it('unilateral with side 2 longer returns the average (rounded)', () => {
    const s = makeState({ hasSides: true, side1Elapsed: 30, side2Elapsed: 51 });
    expect(finalDurationSeconds(s)).toBe(41);
  });

  it('log-first-only path returns side1Elapsed', () => {
    const s = makeState({ hasSides: true, side1Elapsed: 42, side2Elapsed: null });
    expect(finalDurationSeconds(s)).toBe(42);
  });
});

describe('onStart', () => {
  it('idle → counting with startedAt = now', () => {
    const s = makeState({ phase: 'idle', startedAt: 0 });
    const next = onStart(s, 5_000);
    expect(next.phase).toBe('counting');
    expect(next.startedAt).toBe(5_000);
    expect(next.updatedAt).toBe(5_000);
  });

  it('no-op outside idle (already counting)', () => {
    const s = makeState({ phase: 'counting', startedAt: 1_000 });
    const next = onStart(s, 5_000);
    expect(next).toBe(s);
  });
});

describe('isOwnerTab — two-tab arbitration', () => {
  it('matching ownerTabId allows commit', () => {
    const s = makeState({ ownerTabId: 'tab-A' });
    expect(isOwnerTab(s, 'tab-A')).toBe(true);
  });

  it('mismatched ownerTabId is read-only', () => {
    const s = makeState({ ownerTabId: 'tab-A' });
    expect(isOwnerTab(s, 'tab-B')).toBe(false);
  });
});

describe('newTabId', () => {
  it('produces non-empty unique strings', () => {
    const a = newTabId();
    const b = newTabId();
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});
