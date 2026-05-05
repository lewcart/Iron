// Phone-side rest-timer store. Single source of truth for the active rest
// across the workout page UI, the iOS Live Activity / Dynamic Island, and the
// watch (via buildWatchSnapshot). Designed for single-user (Lou); a
// module-level singleton is fine.
//
// Architectural decisions (validated by /autoplan, see docs/watch-replan.md):
// - Phone is the only writer. The watch sends `watchWroteSet` and the bridge
//   calls startRestTimer({ setUuid, restSec, ... }) from the SAME handler
//   that applies the set update — derived from the set transition, not a
//   separate startRest WC command.
// - `setUuid` is the idempotency key. Duplicate WC delivery within
//   `DEDUP_WINDOW_MS` is rejected (returns `{ started: false }`).
// - Snapshot uses phone-authored `end_at_ms` (absolute epoch ms) so the
//   watch never has to do clock-skew arithmetic.
// - Live Activity (Dynamic Island) is decoration. The store is
//   authoritative; if ActivityKit refuses, the store still publishes state.

import {
  startRestActivity,
  updateRestActivity,
  endRestActivity,
  getCurrentRestActivity,
} from './native/rest-timer-activity';
import {
  TIMER_END_KEY,
  TIMER_DURATION_KEY,
  type TimerStorage,
} from '@/app/workout/rest-timer-utils';
import type { WatchRestTimer } from './watch';

export const TIMER_SET_UUID_KEY = 'rebirth-rest-set-uuid';
export const TIMER_OVERTIME_START_KEY = 'rebirth-rest-overtime-start';
export const TIMER_COMPLETED_AT_KEY = 'rebirth-rest-completed-at';
export const REST_BY_EXERCISE_KEY = 'rebirth-rest-by-exercise';
const REST_DEFAULT_KEY = 'rebirth-rest-default';
const REST_AUTO_START_KEY = 'rebirth-rest-auto-start';
const DEDUP_WINDOW_MS = 5_000;
const TICK_INTERVAL_MS = 500;
const FALLBACK_REST_SEC = 90;

function safeLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  const ls = (window as Window).localStorage;
  if (!ls || typeof ls.getItem !== 'function' || typeof ls.setItem !== 'function') {
    return null;
  }
  return ls;
}

/** Per-exercise last-used rest in seconds. Persists Lou's adjustments per
 *  exercise so the next time he hits the same exercise, the timer prefills
 *  to what worked last time. (TODO: when the schema gains
 *  `routine_exercise.rest_seconds`, prefer that over last-used.) */
export function readRestByExercise(): Record<string, number> {
  const ls = safeLocalStorage();
  if (!ls) return {};
  try {
    const raw = ls.getItem(REST_BY_EXERCISE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed != null ? parsed : {};
  } catch {
    return {};
  }
}

export function writeRestByExercise(exerciseUuid: string, restSec: number): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  const map = readRestByExercise();
  map[exerciseUuid] = restSec;
  ls.setItem(REST_BY_EXERCISE_KEY, JSON.stringify(map));
}

/** Resolves the rest duration for a given exercise. Chain:
 *    1. Per-exercise last-used (writeRestByExercise)
 *    2. Global setting (`rebirth-rest-default`)
 *    3. FALLBACK_REST_SEC (90s)
 *  Lou's /autoplan pick was "per-exercise routine target → last-used → 90s";
 *  the routine_exercise.rest_seconds column is a TODO follow-up — until then,
 *  per-exercise last-used handles the same job. */
export function resolveRestSec(opts: { exerciseUuid?: string | null }): number {
  if (opts.exerciseUuid) {
    const map = readRestByExercise();
    const lastUsed = map[opts.exerciseUuid];
    if (typeof lastUsed === 'number' && lastUsed > 0) return lastUsed;
  }
  const ls = safeLocalStorage();
  if (ls) {
    const raw = ls.getItem(REST_DEFAULT_KEY);
    const n = raw == null ? NaN : parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return FALLBACK_REST_SEC;
}

/** Whether auto-rest-start is enabled (settings toggle). Defaults to true. */
export function isAutoRestEnabled(): boolean {
  const ls = safeLocalStorage();
  if (!ls) return true;
  return ls.getItem(REST_AUTO_START_KEY) !== 'false';
}

export interface RestTimerStartArgs {
  setUuid: string;
  restSec: number;
  exerciseName?: string;
  setNumber?: number;
  /** When the originating set completed, epoch ms. Used as the dedup
   *  identity when present — distinguishes accidental duplicate WC delivery
   *  (same setUuid, same completedAtMs → reject) from intentional
   *  un-complete + recomplete on the same set within the dedup window
   *  (same setUuid, different completedAtMs → accept). When omitted (e.g.
   *  manual rest-timer presets), falls back to a time-window heuristic. */
  completedAtMs?: number;
  /** Fires once when the timer crosses zero. Hook layer wires audio /
   *  vibrate / OS notification here so the store stays free of platform
   *  side effects beyond ActivityKit. */
  onZeroCross?: () => void;
}

interface InternalState {
  endAtMs: number;
  durationSec: number;
  setUuid: string;
  overtimeStartMs: number | null;
  /** completedAtMs of the originating set transition, when known. Used by
   *  start()'s dedup to distinguish duplicate WC delivery from intentional
   *  un-complete + recomplete. */
  completedAtMs: number | null;
}

export interface DerivedState {
  selected: number | null;
  remaining: number;
  overtime: number;
  isOvertime: boolean;
  running: boolean;
  progress: number;
}

export interface RestTimerStoreOptions {
  storage?: TimerStorage;
  liveActivity?: {
    start: typeof startRestActivity;
    update: typeof updateRestActivity;
    end: typeof endRestActivity;
  };
  /** Whether to roll into overtime at zero (vs auto-stop). Defaults to
   *  reading `rebirth-rest-keep-running` from localStorage. */
  getKeepRunning?: () => boolean;
  /** Allows tests to inject a manual scheduler. */
  scheduler?: {
    setInterval: (cb: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
    now: () => number;
  };
}

export type Listener = (snap: WatchRestTimer | null) => void;

const noopStorage: TimerStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function defaultStorage(): TimerStorage {
  // Server-side rendering and partial polyfills (some Next.js prerender
  // environments expose `localStorage` as an object whose getItem isn't a
  // function) both need to fall through to the noop. safeLocalStorage()
  // gates on `window` and verifies the methods.
  return safeLocalStorage() ?? noopStorage;
}

function defaultKeepRunning(): boolean {
  const ls = safeLocalStorage();
  if (!ls) return false;
  return ls.getItem('rebirth-rest-keep-running') === 'true';
}

export class RestTimerStore {
  private state: InternalState | null = null;
  private listeners = new Set<Listener>();
  private storage: TimerStorage;
  private liveActivity: NonNullable<RestTimerStoreOptions['liveActivity']>;
  private getKeepRunning: () => boolean;
  private scheduler: NonNullable<RestTimerStoreOptions['scheduler']>;
  private intervalHandle: unknown = null;
  private lastStartedAt = 0;
  /** The latest onZeroCross callback registered via start(). Survives
   *  zero-cross firing so that extend() — which resets the timer back
   *  into countdown from overtime — re-arms the same callback for the
   *  next zero-cross (review C2). */
  private zeroCrossCb: (() => void) | null = null;
  private zeroCrossFired = false;

  constructor(opts: RestTimerStoreOptions = {}) {
    this.storage = opts.storage ?? defaultStorage();
    this.liveActivity = opts.liveActivity ?? {
      start: startRestActivity,
      update: updateRestActivity,
      end: endRestActivity,
    };
    this.getKeepRunning = opts.getKeepRunning ?? defaultKeepRunning;
    this.scheduler = opts.scheduler ?? {
      setInterval: (cb, ms) => setInterval(cb, ms),
      clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
      now: () => Date.now(),
    };
    this.hydrate();
  }

  private hydrate(): void {
    const endRaw = this.storage.getItem(TIMER_END_KEY);
    const durRaw = this.storage.getItem(TIMER_DURATION_KEY);
    if (!endRaw || !durRaw) return;
    const endAtMs = Number(endRaw);
    const durationSec = Number(durRaw);
    if (!Number.isFinite(endAtMs) || !Number.isFinite(durationSec)) {
      this.persist();
      return;
    }
    const setUuid = this.storage.getItem(TIMER_SET_UUID_KEY) ?? '__legacy__';
    const overRaw = this.storage.getItem(TIMER_OVERTIME_START_KEY);
    const overtimeStartMs = overRaw && Number.isFinite(Number(overRaw)) ? Number(overRaw) : null;
    const completedRaw = this.storage.getItem(TIMER_COMPLETED_AT_KEY);
    const completedAtMs = completedRaw && Number.isFinite(Number(completedRaw)) ? Number(completedRaw) : null;
    this.state = { endAtMs, durationSec, setUuid, overtimeStartMs, completedAtMs };
    this.startTicking();
  }

  private persist(): void {
    if (this.state == null) {
      this.storage.removeItem(TIMER_END_KEY);
      this.storage.removeItem(TIMER_DURATION_KEY);
      this.storage.removeItem(TIMER_SET_UUID_KEY);
      this.storage.removeItem(TIMER_OVERTIME_START_KEY);
      this.storage.removeItem(TIMER_COMPLETED_AT_KEY);
      return;
    }
    this.storage.setItem(TIMER_END_KEY, String(this.state.endAtMs));
    this.storage.setItem(TIMER_DURATION_KEY, String(this.state.durationSec));
    this.storage.setItem(TIMER_SET_UUID_KEY, this.state.setUuid);
    if (this.state.overtimeStartMs != null) {
      this.storage.setItem(TIMER_OVERTIME_START_KEY, String(this.state.overtimeStartMs));
    } else {
      this.storage.removeItem(TIMER_OVERTIME_START_KEY);
    }
    if (this.state.completedAtMs != null) {
      this.storage.setItem(TIMER_COMPLETED_AT_KEY, String(this.state.completedAtMs));
    } else {
      this.storage.removeItem(TIMER_COMPLETED_AT_KEY);
    }
  }

  private notify(): void {
    const snap = this.getSnapshot();
    for (const cb of this.listeners) cb(snap);
  }

  private startTicking(): void {
    if (this.intervalHandle != null) return;
    this.intervalHandle = this.scheduler.setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  private stopTicking(): void {
    if (this.intervalHandle == null) return;
    this.scheduler.clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }

  private tick(): void {
    if (this.state == null) {
      this.stopTicking();
      return;
    }
    const now = this.scheduler.now();
    const remainingMs = this.state.endAtMs - now;
    if (remainingMs > 0) {
      this.notify();
      return;
    }
    if (this.state.overtimeStartMs == null) {
      this.fireZeroCross();
      if (this.getKeepRunning()) {
        this.markOvertime(now);
      } else {
        this.end();
        return;
      }
    }
    this.notify();
  }

  /** Fires the zero-cross callback at most once per timer-period. Wraps the
   *  callback so a thrown hook (audio/vibrate failures, etc.) doesn't wedge
   *  the store's state machine — the user-visible UI keeps advancing. */
  private fireZeroCross(): void {
    if (this.zeroCrossFired) return;
    this.zeroCrossFired = true;
    try {
      this.zeroCrossCb?.();
    } catch (err) {
      console.warn('[rest-timer-state] zero-cross callback threw:', err);
    }
  }

  start(args: RestTimerStartArgs, now?: number): { started: boolean } {
    const t = now ?? this.scheduler.now();
    // Dedup: same setUuid AND same completedAtMs (when both sides have it) is
    // a true duplicate WC delivery — drop it. If completedAtMs differs, it's
    // an intentional un-complete + recomplete and a new timer should fire.
    // When either side lacks completedAtMs (e.g. manual presets), fall back
    // to the time-window heuristic.
    if (this.state?.setUuid === args.setUuid) {
      const haveBoth = args.completedAtMs != null && this.state.completedAtMs != null;
      const sameCompletion = haveBoth && this.state.completedAtMs === args.completedAtMs;
      const withinTimeWindow = t - this.lastStartedAt < DEDUP_WINDOW_MS;
      if (sameCompletion || (!haveBoth && withinTimeWindow)) {
        return { started: false };
      }
    }
    this.lastStartedAt = t;
    const endAtMs = t + args.restSec * 1000;
    this.state = {
      endAtMs,
      durationSec: args.restSec,
      setUuid: args.setUuid,
      overtimeStartMs: null,
      completedAtMs: args.completedAtMs ?? null,
    };
    this.zeroCrossCb = args.onZeroCross ?? null;
    this.zeroCrossFired = false;
    this.persist();
    void this.liveActivity.start({
      endTime: endAtMs,
      duration: args.restSec,
      exerciseName: args.exerciseName,
      setNumber: args.setNumber,
    });
    this.startTicking();
    this.notify();
    return { started: true };
  }

  extend(seconds: number): void {
    if (this.state == null) return;
    // Clamp to "now" when extending out of overtime so the new end-time is
    // genuinely `seconds` from this moment — not still in the past (review C3).
    const now = this.scheduler.now();
    const baseEndAt = Math.max(this.state.endAtMs, now);
    this.state = {
      endAtMs: baseEndAt + seconds * 1000,
      durationSec: this.state.durationSec,
      setUuid: this.state.setUuid,
      completedAtMs: this.state.completedAtMs,
      overtimeStartMs: null,
    };
    // Re-arm zero-cross — extending out of overtime begins a fresh countdown
    // and the next zero-cross deserves the same audio/vibrate cue (review C2).
    this.zeroCrossFired = false;
    this.persist();
    void this.liveActivity.update({
      endTime: this.state.endAtMs,
      overtimeStartNull: true,
    });
    this.startTicking();
    this.notify();
  }

  end(opts?: { setUuid?: string }): void {
    if (this.state == null) return;
    if (opts?.setUuid && opts.setUuid !== this.state.setUuid) return;
    this.state = null;
    this.zeroCrossCb = null;
    this.zeroCrossFired = false;
    this.persist();
    void this.liveActivity.end();
    this.stopTicking();
    this.notify();
  }

  markOvertime(now?: number): void {
    if (this.state == null || this.state.overtimeStartMs != null) return;
    const t = now ?? this.scheduler.now();
    this.state = {
      endAtMs: this.state.endAtMs,
      durationSec: this.state.durationSec,
      setUuid: this.state.setUuid,
      completedAtMs: this.state.completedAtMs,
      overtimeStartMs: t,
    };
    this.persist();
    void this.liveActivity.update({ overtimeStart: t });
    this.notify();
  }

  /** Reconciles in-memory state against the iOS Live Activity. Call once on
   *  app foreground / hydration so a process-killed-mid-rest can clean up
   *  orphan Activities (or pick up a Live Activity Lou's about to see).
   *  Best-effort — failures are silent. */
  async reconcileWithNative(): Promise<void> {
    let native;
    try {
      native = await getCurrentRestActivity();
    } catch {
      return;
    }
    if (this.state == null && native.active) {
      // Orphan Activity (JS state died, Activity persists). Clean up.
      try { await endRestActivity(); } catch { /* best-effort */ }
      return;
    }
    if (this.state != null && !native.active) {
      // Orphan in-memory state (Activity dismissed externally — user killed
      // it from Lock Screen, or Live Activities globally disabled mid-rest).
      // The store is authoritative for the watch snapshot, but keeping a
      // ghost here is misleading; sync down to match.
      this.end();
      return;
    }
    if (this.state != null && native.active && native.end_at_ms != null) {
      // Both present. If they disagree on end-time by > 5s, the Live
      // Activity is the source of truth for the OS-level countdown — sync
      // localStorage to match so the watch snapshot tracks reality.
      if (Math.abs(this.state.endAtMs - native.end_at_ms) > 5_000) {
        this.state = { ...this.state, endAtMs: native.end_at_ms };
        this.persist();
        this.notify();
      }
    }
  }

  /** Foreground re-sync (Capacitor appStateChange). Cheap to call repeatedly. */
  resync(): void {
    if (this.state == null) return;
    const now = this.scheduler.now();
    if (now >= this.state.endAtMs && this.state.overtimeStartMs == null) {
      this.fireZeroCross();
      if (this.getKeepRunning()) {
        this.markOvertime(now);
      } else {
        this.end();
        return;
      }
    }
    this.notify();
  }

  getSnapshot(): WatchRestTimer | null {
    if (this.state == null) return null;
    return {
      end_at_ms: this.state.endAtMs,
      duration_sec: this.state.durationSec,
      overtime_start_ms: this.state.overtimeStartMs,
      set_uuid: this.state.setUuid,
    };
  }

  getDerived(): DerivedState {
    const now = this.scheduler.now();
    if (this.state == null) {
      return { selected: null, remaining: 0, overtime: 0, isOvertime: false, running: false, progress: 0 };
    }
    const isOvertime = this.state.overtimeStartMs != null;
    if (isOvertime) {
      const overSec = Math.floor((now - (this.state.overtimeStartMs ?? this.state.endAtMs)) / 1000);
      return {
        selected: this.state.durationSec,
        remaining: 0,
        overtime: Math.max(0, overSec),
        isOvertime: true,
        running: true,
        progress: 0,
      };
    }
    const remainingMs = this.state.endAtMs - now;
    const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
    return {
      selected: this.state.durationSec,
      remaining: remainingSec,
      overtime: 0,
      isOvertime: false,
      running: true,
      progress: this.state.durationSec > 0 ? remainingSec / this.state.durationSec : 0,
    };
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}

let _singleton: RestTimerStore | null = null;

function store(): RestTimerStore {
  if (_singleton == null) _singleton = new RestTimerStore();
  return _singleton;
}

export function startRestTimer(args: RestTimerStartArgs): { started: boolean } {
  return store().start(args);
}

/** Reconciles in-memory state with iOS Live Activity. Call on app foreground
 *  to detect process-kill orphans. Best-effort, async. */
export async function reconcileRestTimerNative(): Promise<void> {
  await store().reconcileWithNative();
}

export function extendRestTimer(args: { setUuid?: string; seconds: number }): void {
  store().extend(args.seconds);
}

export function endRestTimer(opts?: { setUuid?: string }): void {
  store().end(opts);
}

export function resyncRestTimer(): void {
  store().resync();
}

export function getRestTimer(): WatchRestTimer | null {
  return store().getSnapshot();
}

export function getRestTimerDerived(): DerivedState {
  return store().getDerived();
}

export function subscribeRestTimer(cb: Listener): () => void {
  return store().subscribe(cb);
}

/** Test-only: replace the singleton with a fresh store. */
export function __setRestTimerStoreForTest(s: RestTimerStore | null): void {
  _singleton = s;
}
