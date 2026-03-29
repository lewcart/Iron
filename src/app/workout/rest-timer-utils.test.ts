import { describe, it, expect, beforeEach } from 'vitest';
import {
  TIMER_END_KEY,
  TIMER_DURATION_KEY,
  persistTimer,
  clearPersistedTimer,
  readPersistedTimer,
  computeRemaining,
  type TimerStorage,
} from './rest-timer-utils';

// In-memory localStorage stub
function makeStorage(): TimerStorage & { store: Record<string, string> } {
  const store: Record<string, string> = {};
  return {
    store,
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
  };
}

describe('computeRemaining', () => {
  it('returns ceiling of seconds left', () => {
    const now = 1000000;
    const endTime = now + 90500; // 90.5 seconds from now
    expect(computeRemaining(endTime, now)).toBe(91);
  });

  it('returns exact seconds when on boundary', () => {
    const now = 1000000;
    const endTime = now + 90000;
    expect(computeRemaining(endTime, now)).toBe(90);
  });

  it('clamps to 0 when already expired', () => {
    const now = 1000000;
    const endTime = now - 5000; // expired 5s ago
    expect(computeRemaining(endTime, now)).toBe(0);
  });

  it('returns 0 when exactly expired', () => {
    const now = 1000000;
    expect(computeRemaining(now, now)).toBe(0);
  });
});

describe('persistTimer / readPersistedTimer / clearPersistedTimer', () => {
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    storage = makeStorage();
  });

  it('persists endTime and duration', () => {
    persistTimer(storage, 9999999, 90);
    expect(storage.store[TIMER_END_KEY]).toBe('9999999');
    expect(storage.store[TIMER_DURATION_KEY]).toBe('90');
  });

  it('reads back what was persisted', () => {
    persistTimer(storage, 1234567890, 120);
    const result = readPersistedTimer(storage);
    expect(result).toEqual({ endTime: 1234567890, duration: 120 });
  });

  it('returns null when nothing is stored', () => {
    expect(readPersistedTimer(storage)).toBeNull();
  });

  it('returns null when endTime is missing', () => {
    storage.setItem(TIMER_DURATION_KEY, '90');
    expect(readPersistedTimer(storage)).toBeNull();
  });

  it('returns null when duration is missing', () => {
    storage.setItem(TIMER_END_KEY, '9999999');
    expect(readPersistedTimer(storage)).toBeNull();
  });

  it('clears both keys', () => {
    persistTimer(storage, 9999999, 90);
    clearPersistedTimer(storage);
    expect(storage.store[TIMER_END_KEY]).toBeUndefined();
    expect(storage.store[TIMER_DURATION_KEY]).toBeUndefined();
    expect(readPersistedTimer(storage)).toBeNull();
  });
});

describe('background-safe timer logic', () => {
  it('timer started 30s ago with 90s duration has 60s remaining', () => {
    const storage = makeStorage();
    const duration = 90;
    const startedAt = Date.now() - 30_000;
    const endTime = startedAt + duration * 1000;
    persistTimer(storage, endTime, duration);

    const saved = readPersistedTimer(storage);
    expect(saved).not.toBeNull();
    const rem = computeRemaining(saved!.endTime, Date.now());
    expect(rem).toBeGreaterThanOrEqual(59);
    expect(rem).toBeLessThanOrEqual(61);
  });

  it('timer that expired while backgrounded shows 0 remaining', () => {
    const storage = makeStorage();
    const endTime = Date.now() - 10_000; // expired 10s ago
    persistTimer(storage, endTime, 90);

    const saved = readPersistedTimer(storage);
    expect(saved).not.toBeNull();
    const rem = computeRemaining(saved!.endTime, Date.now());
    expect(rem).toBe(0);
  });

  it('adjust adds seconds by shifting endTime forward', () => {
    const now = Date.now();
    const endTime = now + 60_000; // 60s remaining
    const newEndTime = endTime + 30_000; // +30s adjustment
    const rem = computeRemaining(newEndTime, now);
    expect(rem).toBe(90);
  });

  it('adjust removing seconds shifts endTime back', () => {
    const now = Date.now();
    const endTime = now + 60_000; // 60s remaining
    const newEndTime = endTime - 30_000; // -30s adjustment
    const rem = computeRemaining(newEndTime, now);
    expect(rem).toBe(30);
  });
});
