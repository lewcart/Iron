/**
 * rest-timer-activity — iOS Live Activity bridge for the rest timer.
 *
 * The native RestTimerPlugin starts/updates/ends an ActivityKit Live
 * Activity so the rest countdown appears on the Lock Screen and in the
 * Dynamic Island.
 *
 * This TS wrapper:
 *   - no-ops on web (plugin isn't available)
 *   - respects the user's `rebirth-rest-live-activity` setting — when the
 *     toggle in Settings is OFF we skip the plugin calls entirely so no
 *     Activity is ever started
 *
 * Usage:
 *   await startRestActivity({ endTime, duration, exerciseName, setNumber });
 *   await updateRestActivity({ endTime });        // e.g. if user adds +30s
 *   await endRestActivity();
 */

import { registerPlugin, Capacitor } from '@capacitor/core';

export const REST_LIVE_ACTIVITY_LS_KEY = 'rebirth-rest-live-activity';

export interface StartRestActivityOptions {
  /** Absolute epoch ms when the rest period ends. */
  endTime: number;
  /** Original rest duration in seconds (used for progress display). */
  duration: number;
  /** Exercise the user is resting between sets of. */
  exerciseName?: string;
  /** Which set just finished (1-indexed). */
  setNumber?: number;
  /** Optional — if supplied, the widget starts in red count-UP mode from this epoch ms. */
  overtimeStart?: number;
}

export interface UpdateRestActivityOptions {
  /** New absolute epoch ms when the rest period ends. Omit to keep the existing value. */
  endTime?: number;
  /** Reserved for future pause/resume support. */
  paused?: boolean;
  /** Set to an epoch ms to switch the widget into red count-UP mode. */
  overtimeStart?: number;
  /** Set to `true` to clear overtime mode and return to countdown. */
  overtimeStartNull?: boolean;
}

interface RestTimerPluginInterface {
  start(options: StartRestActivityOptions): Promise<void>;
  update(options: UpdateRestActivityOptions): Promise<void>;
  end(): Promise<void>;
}

const RestTimerPlugin = registerPlugin<RestTimerPluginInterface>(
  'RestTimer',
  {
    // Web stub — Live Activities are iOS-only.
    web: {
      start: async () => {},
      update: async () => {},
      end: async () => {},
    },
  }
);

/**
 * Returns true when the user has the Live Activity toggle enabled.
 * Defaults to `true` when no value is set (opt-out, not opt-in).
 */
function isLiveActivityEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  // Stored as 'true' / 'false'; anything other than 'false' is enabled.
  return localStorage.getItem(REST_LIVE_ACTIVITY_LS_KEY) !== 'false';
}

/** Start a Live Activity for the current rest timer. Silent no-op on web or when disabled. */
export async function startRestActivity(options: StartRestActivityOptions): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!isLiveActivityEnabled()) return;
  try {
    await RestTimerPlugin.start(options);
  } catch (err) {
    console.warn('[rest-timer-activity] start failed:', err);
  }
}

/** Update the end time of the running Live Activity (e.g. when the user taps +30s). */
export async function updateRestActivity(options: UpdateRestActivityOptions): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!isLiveActivityEnabled()) return;
  try {
    await RestTimerPlugin.update(options);
  } catch (err) {
    console.warn('[rest-timer-activity] update failed:', err);
  }
}

/** End the running Live Activity. Always safe to call; no-op on web. */
export async function endRestActivity(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  // Always try to end — if the user toggled the setting off mid-activity we
  // still want to clean up any Activity that was started while it was on.
  try {
    await RestTimerPlugin.end();
  } catch (err) {
    console.warn('[rest-timer-activity] end failed:', err);
  }
}
