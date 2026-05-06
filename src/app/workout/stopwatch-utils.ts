// Background-safe stopwatch (count-up) — pure utility functions.
//
// Mirrors rest-timer-utils.ts but for an upward-counting timer with a
// side-cycling state machine. Separated from the React hook so the state
// transitions are unit-testable in Node.
//
// Design decisions captured in PLAN-exercise-timer.md (autoplan output).
// Highlights:
//   - State machine: idle → counting → switching → switch_expired_paused
//                    → counting (side 2) → done. switching auto-fires
//     once the 10s window elapses; switch_expired_paused captures the
//     "user backgrounded the app for 20 minutes during the switch"
//     case so we never silently credit fake side-2 elapsed.
//   - Two-tab arbitration: each tab generates ownerTabId on mount; only
//     the matching tab commits on Stop.
//   - Persistence: localStorage namespace `rebirth-stopwatch-*`. Separate
//     from the rest-timer namespace so a running rest timer and a running
//     stopwatch coexist.

export const STOPWATCH_STATE_KEY = 'rebirth-stopwatch-state';

export type StopwatchPhase =
  | 'idle'
  | 'counting'
  | 'switching'
  | 'switch_expired_paused'
  | 'done';

export interface StopwatchState {
  /** workoutExerciseUuid + setUuid concatenation. Lets restore re-attach
   *  to the same SetRow; orphan-detected via Dexie lookup. */
  setRowKey: string;
  /** Random per-tab id (crypto.randomUUID()). Only the tab that owns the
   *  state commits on Stop; other tabs go read-only. */
  ownerTabId: string;
  /** True when the exercise.has_sides flag is set. Drives whether the
   *  switching phase fires after side-1 stop. */
  hasSides: boolean;
  /** Current phase of the state machine. */
  phase: StopwatchPhase;
  /** 1 = first side (or only side for !hasSides exercises), 2 = second. */
  side: 1 | 2;
  /** Epoch ms when the CURRENT phase began. Elapsed = now - startedAt
   *  for `counting` phases; ignored for `idle` / `switch_expired_paused`. */
  startedAt: number;
  /** Final logged seconds for side 1, captured on Stop. Only set after
   *  side-1 stops (i.e. during switching, switch_expired_paused, or
   *  side-2 phases). */
  side1Elapsed: number | null;
  /** Final logged seconds for side 2, captured on Stop. Only set in
   *  `done` for hasSides=true. */
  side2Elapsed: number | null;
  /** Epoch ms when the 10s switch window expires. Only set during
   *  `switching`. */
  switchEndTime: number | null;
  /** Last localStorage write timestamp. Used to detect stale state. */
  updatedAt: number;
}

export interface TimerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function persistStopwatch(storage: TimerStorage, state: StopwatchState): void {
  storage.setItem(STOPWATCH_STATE_KEY, JSON.stringify({ ...state, updatedAt: Date.now() }));
}

export function clearPersistedStopwatch(storage: TimerStorage): void {
  storage.removeItem(STOPWATCH_STATE_KEY);
}

export function readPersistedStopwatch(storage: TimerStorage): StopwatchState | null {
  const raw = storage.getItem(STOPWATCH_STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StopwatchState>;
    // Minimal validation — drop on malformed shapes rather than crash.
    if (
      typeof parsed.setRowKey !== 'string' ||
      typeof parsed.ownerTabId !== 'string' ||
      typeof parsed.startedAt !== 'number' ||
      typeof parsed.phase !== 'string'
    ) return null;
    return parsed as StopwatchState;
  } catch {
    return null;
  }
}

/** Whole seconds elapsed in the current phase. Ceil so a 0.4s tick still
 *  reads as 0:01 rather than 0:00. Mirrors computeRemaining's rounding
 *  in rest-timer-utils.ts. */
export function computeElapsed(startedAt: number, now: number): number {
  return Math.max(0, Math.ceil((now - startedAt) / 1000));
}

/** Whole seconds remaining in the switch countdown (10s). Floor instead
 *  of ceil so the displayed value goes 10 → 9 → ... → 0 over the full
 *  ten seconds rather than 10 → 9 over the first half-second. */
export function computeSwitchRemaining(switchEndTime: number, now: number): number {
  return Math.max(0, Math.floor((switchEndTime - now) / 1000));
}

/** SWITCH_DURATION_MS — the 10-second pause between sides. */
export const SWITCH_DURATION_MS = 10_000;

/** STALE_THRESHOLD_MS — when a counting phase exceeds this, the UI
 *  surfaces a stale-timer warning. 1 hour matches the failure-mode
 *  registry's "wildly inflated elapsed" mitigation. */
export const STALE_THRESHOLD_MS = 60 * 60 * 1000;

/** STALE_WARN_MS — softer warning at 10 minutes. */
export const STALE_WARN_MS = 10 * 60 * 1000;

/** Compute the next state on app foreground / page reload from a persisted
 *  state. Pure: takes Date.now() as `now` so tests are deterministic.
 *
 *  CRITICAL invariant: a `switching` phase whose `switchEndTime` has
 *  passed must NOT silently transition to `counting(side=2)` — that
 *  would credit "20 minutes away from the app" as a 20-minute side-2
 *  hold. Instead, the user must explicitly tap "Start second side" to
 *  set `startedAt = Date.now()`. The `switch_expired_paused` phase
 *  captures this gating intent. */
export function restoreState(state: StopwatchState, now: number): StopwatchState {
  if (state.phase !== 'switching') return state;
  if (state.switchEndTime == null || now <= state.switchEndTime) return state;
  return {
    ...state,
    phase: 'switch_expired_paused',
    // startedAt is held but irrelevant in this phase; user action sets
    // it when transitioning to counting(side=2).
    switchEndTime: null,
    updatedAt: now,
  };
}

/** Transition: user taps Start from the idle (just-opened) phase. Sets
 *  startedAt = now so elapsed accrues from this moment, not from open()
 *  time. The sheet now opens in `idle` so the user sees the timer ready
 *  but not running — Stop happens via the Stop button in `counting`. */
export function onStart(state: StopwatchState, now: number): StopwatchState {
  if (state.phase !== 'idle') return state;
  return {
    ...state,
    phase: 'counting',
    startedAt: now,
    updatedAt: now,
  };
}

/** Transition: user taps Stop. Returns the next state. For !hasSides or
 *  side=2, transitions to `done` and writes final elapsed values. For
 *  hasSides + side=1, transitions to `switching` with a fresh switchEndTime. */
export function onStop(state: StopwatchState, now: number): StopwatchState {
  const elapsed = computeElapsed(state.startedAt, now);
  if (state.phase !== 'counting') return state;

  if (!state.hasSides) {
    return {
      ...state,
      phase: 'done',
      side1Elapsed: elapsed,
      side2Elapsed: null,
      updatedAt: now,
    };
  }

  if (state.side === 1) {
    return {
      ...state,
      phase: 'switching',
      side1Elapsed: elapsed,
      switchEndTime: now + SWITCH_DURATION_MS,
      updatedAt: now,
    };
  }

  // hasSides && side === 2
  return {
    ...state,
    phase: 'done',
    side2Elapsed: elapsed,
    updatedAt: now,
  };
}

/** Transition: user taps "Skip" during switching, or the switch countdown
 *  reaches zero with the user still in foreground. Auto-fire is intentional
 *  here (the user is watching), distinct from `switch_expired_paused`
 *  which only fires on app-resumption past the deadline. */
export function onSwitchComplete(state: StopwatchState, now: number): StopwatchState {
  if (state.phase !== 'switching') return state;
  return {
    ...state,
    phase: 'counting',
    side: 2,
    startedAt: now,
    switchEndTime: null,
    updatedAt: now,
  };
}

/** Transition: user taps "Start second side" from `switch_expired_paused`. */
export function onResumeFromPause(state: StopwatchState, now: number): StopwatchState {
  if (state.phase !== 'switch_expired_paused') return state;
  return {
    ...state,
    phase: 'counting',
    side: 2,
    startedAt: now,
    updatedAt: now,
  };
}

/** Transition: user taps "Done — log first side only" from
 *  `switch_expired_paused`. Skips side 2. */
export function onLogFirstOnly(state: StopwatchState, now: number): StopwatchState {
  if (state.phase !== 'switch_expired_paused') return state;
  return {
    ...state,
    phase: 'done',
    side2Elapsed: null,
    updatedAt: now,
  };
}

/** Final logged duration. For unilateral exercises, log the AVERAGE of
 *  the two sides — Lou's preference: a single per-set seconds value that
 *  represents how long the hold was on average. Log-first-only still
 *  returns side 1 only (no second side to average against). */
export function finalDurationSeconds(state: StopwatchState): number {
  const s1 = state.side1Elapsed ?? 0;
  const s2 = state.side2Elapsed ?? 0;
  if (!state.hasSides) return s1;
  if (state.side2Elapsed == null) return s1; // log-first-only path
  return Math.round((s1 + s2) / 2);
}

/** Two-tab arbitration: only the tab whose ownerTabId matches the
 *  persisted state may commit on Stop. Other tabs render in read-only
 *  recovery mode. */
export function isOwnerTab(state: StopwatchState, myTabId: string): boolean {
  return state.ownerTabId === myTabId;
}

/** Generate a fresh tab id. Crypto.randomUUID is widely supported on
 *  iOS Safari ≥15 and modern Chrome; the rest-timer flow already
 *  depends on Date.now() epoch math, so single-user app-on-iOS is the
 *  baseline. */
export function newTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts: timestamp + random. Collision risk
  // is negligible in the single-user, two-tab worst case.
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
