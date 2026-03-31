/**
 * Workout schedule notifications
 *
 * Schedules a daily "Your gym flow starts in 5 min, tap to begin" banner at
 * a user-configured time on selected days of the week.
 *
 * Uses UNCalendarNotificationTrigger (via @capacitor/local-notifications) so
 * delivery is exact — no BGTaskScheduler drift.
 *
 * iOS weekday numbers: 1 = Sunday … 7 = Saturday (matches DateComponents).
 */

import { Capacitor } from '@capacitor/core';
import { LocalNotifications, Weekday } from '@capacitor/local-notifications';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkoutScheduleConfig {
  enabled: boolean;
  /** 0-23 */
  hour: number;
  /** 0-59 */
  minute: number;
  /** iOS weekday numbers: 1=Sun, 2=Mon, 3=Tue, 4=Wed, 5=Thu, 6=Fri, 7=Sat */
  days: number[];
}

export const DEFAULT_SCHEDULE: WorkoutScheduleConfig = {
  enabled: false,
  hour: 8,
  minute: 0,
  days: [2, 3, 4, 5, 6], // Mon–Fri
};

// Notification IDs 2001-2007 reserved for schedule (one per weekday slot).
// ID = 2000 + iOS weekday number (1-7).
const NOTIF_ID_BASE = 2000;

// ─── Persistence ──────────────────────────────────────────────────────────────

const LS_KEY = 'rebirth-workout-schedule';

export function loadScheduleConfig(): WorkoutScheduleConfig {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_SCHEDULE };
    return { ...DEFAULT_SCHEDULE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SCHEDULE };
  }
}

export function saveScheduleConfig(config: WorkoutScheduleConfig): void {
  try {
    globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(config));
  } catch {
    // Quota / private mode — silently ignore
  }
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

/** Cancel all previously scheduled workout-reminder notifications. */
async function cancelWorkoutReminders(): Promise<void> {
  const ids = [1, 2, 3, 4, 5, 6, 7].map(d => ({ id: NOTIF_ID_BASE + d }));
  try {
    await LocalNotifications.cancel({ notifications: ids });
  } catch {
    // Nothing pending or plugin unavailable
  }
}

/**
 * Apply a schedule config: cancels existing reminders and, if enabled,
 * schedules new ones via UNCalendarNotificationTrigger.
 *
 * The notification fires 5 minutes *before* the configured hour:minute so the
 * user has time to wrap up and start the session on time.
 */
export async function applyWorkoutSchedule(
  config: WorkoutScheduleConfig,
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  await cancelWorkoutReminders();
  if (!config.enabled || config.days.length === 0) return;

  // Compute reminder time = configured time − 5 min
  let remindH = config.hour;
  let remindM = config.minute - 5;
  if (remindM < 0) {
    remindM += 60;
    remindH = (remindH - 1 + 24) % 24;
  }

  const notifications = config.days.map(weekday => ({
    id: NOTIF_ID_BASE + weekday,
    title: 'Time to train',
    body: 'Your gym flow starts in 5 min — tap to begin',
    schedule: {
      on: {
        weekday: weekday as Weekday,
        hour: remindH,
        minute: remindM,
      },
      // repeats is implicitly true when using `on` — the Swift plugin always
      // passes repeats: true to UNCalendarNotificationTrigger in this path.
    },
    extra: { type: 'workout-schedule' },
    sound: undefined,
    smallIcon: 'ic_stat_icon_config_sample',
  }));

  try {
    await LocalNotifications.schedule({ notifications });
  } catch (err) {
    console.warn('[workout-schedule] Failed to schedule notifications:', err);
  }
}

/** Convenience: save + apply in one call. */
export async function updateWorkoutSchedule(
  config: WorkoutScheduleConfig,
): Promise<void> {
  saveScheduleConfig(config);
  await applyWorkoutSchedule(config);
}

// ─── Session-storage tap flag ─────────────────────────────────────────────────
// Set by the notification listener in providers.tsx when a workout-schedule
// notification is tapped.  Consumed (and cleared) by the workout page on mount.

export const SCHEDULE_TAP_KEY = 'rebirth-schedule-tap';

export function markScheduleTap(): void {
  try {
    globalThis.sessionStorage?.setItem(SCHEDULE_TAP_KEY, '1');
  } catch {
    // Private mode
  }
}

export function consumeScheduleTap(): boolean {
  try {
    const hit = globalThis.sessionStorage?.getItem(SCHEDULE_TAP_KEY) === '1';
    if (hit) globalThis.sessionStorage?.removeItem(SCHEDULE_TAP_KEY);
    return hit;
  } catch {
    return false;
  }
}
