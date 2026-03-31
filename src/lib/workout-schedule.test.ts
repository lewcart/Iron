import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_SCHEDULE,
  loadScheduleConfig,
  saveScheduleConfig,
  markScheduleTap,
  consumeScheduleTap,
  type WorkoutScheduleConfig,
} from './workout-schedule';

// ─── Storage mock (node-compatible) ──────────────────────────────────────────

function makeStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: makeStorage(), configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: makeStorage(), configurable: true });
});

// ─── loadScheduleConfig ───────────────────────────────────────────────────────

describe('loadScheduleConfig', () => {
  it('returns defaults when nothing is stored', () => {
    const cfg = loadScheduleConfig();
    expect(cfg).toEqual(DEFAULT_SCHEDULE);
  });

  it('merges stored partial config with defaults', () => {
    localStorage.setItem('rebirth-workout-schedule', JSON.stringify({ enabled: true, hour: 7 }));
    const cfg = loadScheduleConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.hour).toBe(7);
    expect(cfg.minute).toBe(DEFAULT_SCHEDULE.minute);
    expect(cfg.days).toEqual(DEFAULT_SCHEDULE.days);
  });

  it('returns defaults when stored JSON is corrupt', () => {
    localStorage.setItem('rebirth-workout-schedule', 'not json {{');
    const cfg = loadScheduleConfig();
    expect(cfg).toEqual(DEFAULT_SCHEDULE);
  });
});

// ─── saveScheduleConfig ───────────────────────────────────────────────────────

describe('saveScheduleConfig', () => {
  it('persists config to localStorage', () => {
    const cfg: WorkoutScheduleConfig = { enabled: true, hour: 6, minute: 30, days: [2, 4, 6] };
    saveScheduleConfig(cfg);
    const stored = JSON.parse(localStorage.getItem('rebirth-workout-schedule') ?? '{}');
    expect(stored).toEqual(cfg);
  });

  it('round-trips through load', () => {
    const cfg: WorkoutScheduleConfig = { enabled: true, hour: 20, minute: 0, days: [1, 7] };
    saveScheduleConfig(cfg);
    expect(loadScheduleConfig()).toEqual(cfg);
  });
});

// ─── markScheduleTap / consumeScheduleTap ────────────────────────────────────

describe('markScheduleTap / consumeScheduleTap', () => {
  it('returns false when no tap is pending', () => {
    expect(consumeScheduleTap()).toBe(false);
  });

  it('returns true after mark and clears the flag', () => {
    markScheduleTap();
    expect(consumeScheduleTap()).toBe(true);
    // Second consume should be false — flag was cleared
    expect(consumeScheduleTap()).toBe(false);
  });

  it('flag survives multiple marks but only triggers once', () => {
    markScheduleTap();
    markScheduleTap(); // redundant, same key
    expect(consumeScheduleTap()).toBe(true);
    expect(consumeScheduleTap()).toBe(false);
  });
});

// ─── Default schedule shape ───────────────────────────────────────────────────

describe('DEFAULT_SCHEDULE', () => {
  it('is disabled by default', () => {
    expect(DEFAULT_SCHEDULE.enabled).toBe(false);
  });

  it('covers Mon–Fri by default (iOS weekday 2–6)', () => {
    expect(DEFAULT_SCHEDULE.days).toEqual([2, 3, 4, 5, 6]);
  });

  it('defaults to 08:00', () => {
    expect(DEFAULT_SCHEDULE.hour).toBe(8);
    expect(DEFAULT_SCHEDULE.minute).toBe(0);
  });
});
