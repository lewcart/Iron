// Background-safe rest timer — pure utility functions
// These are separated from the hook so they can be unit-tested in Node.

export const TIMER_END_KEY = 'rebirth-rest-end-time';
export const TIMER_DURATION_KEY = 'rebirth-rest-duration';

export interface TimerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function persistTimer(storage: TimerStorage, endTime: number, duration: number): void {
  storage.setItem(TIMER_END_KEY, String(endTime));
  storage.setItem(TIMER_DURATION_KEY, String(duration));
}

export function clearPersistedTimer(storage: TimerStorage): void {
  storage.removeItem(TIMER_END_KEY);
  storage.removeItem(TIMER_DURATION_KEY);
}

export interface PersistedTimer {
  endTime: number;
  duration: number;
}

export function readPersistedTimer(storage: TimerStorage): PersistedTimer | null {
  const endTime = parseInt(storage.getItem(TIMER_END_KEY) ?? '', 10);
  const duration = parseInt(storage.getItem(TIMER_DURATION_KEY) ?? '', 10);
  if (!endTime || !duration || isNaN(endTime) || isNaN(duration)) return null;
  return { endTime, duration };
}

/** Remaining seconds from an absolute endTime epoch, clamped to 0. */
export function computeRemaining(endTime: number, now: number): number {
  return Math.max(0, Math.ceil((endTime - now) / 1000));
}
