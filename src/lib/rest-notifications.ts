/**
 * Local notification helpers for the rest timer.
 *
 * Schedules an OS-level notification at the moment the rest timer expires so
 * the alert fires even when the app is fully backgrounded or suspended.
 *
 * Uses @capacitor/local-notifications on native (iOS/Android) and falls back
 * to the Web Notification API on web/PWA.
 */

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const REST_NOTIFICATION_ID = 1001;

/** Returns true when running inside a Capacitor native shell (not plain web). */
function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Request notification permission.  Should be called once early in the session
 * (e.g. when the workout page mounts) so the OS prompt appears in context.
 */
export async function requestNotificationPermission(): Promise<void> {
  if (isNative()) {
    const { display } = await LocalNotifications.requestPermissions();
    if (display !== 'granted') {
      console.warn('[rest-notifications] Permission not granted:', display);
    }
  } else {
    // Web / PWA fallback
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }
}

/**
 * Schedule (or reschedule) the rest-complete notification.
 *
 * @param endTimeMs  Absolute epoch ms when the timer expires.
 */
export async function scheduleRestNotification(endTimeMs: number): Promise<void> {
  // Cancel any previously scheduled notification first so we don't stack them.
  await cancelRestNotification();

  const at = new Date(endTimeMs);

  if (isNative()) {
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: REST_NOTIFICATION_ID,
            title: 'Rest complete!',
            body: "Time to get back to work!",
            schedule: { at, allowWhileIdle: true },
            sound: 'default',
            // vibration defaults to true on Android when sound is set
            extra: null,
          },
        ],
      });
    } catch (err) {
      console.warn('[rest-notifications] Failed to schedule:', err);
    }
  } else {
    // Web fallback: no way to schedule for the future via Web Notification API,
    // so we do nothing here — the existing AudioContext/vibrate path handles it
    // when the countdown reaches zero while the tab is active.
  }
}

/**
 * Cancel the pending rest notification (call when the user cancels the timer
 * or when the app comes to the foreground and the timer has already expired).
 */
export async function cancelRestNotification(): Promise<void> {
  if (!isNative()) return;
  try {
    await LocalNotifications.cancel({
      notifications: [{ id: REST_NOTIFICATION_ID }],
    });
  } catch {
    // Ignore — no pending notification to cancel is fine.
  }
}
