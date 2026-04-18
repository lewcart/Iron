/**
 * inspo-burst-control — iOS 18 Lock Screen control bridge.
 *
 * The native FitspoControlWidget (ControlWidget) sets a shared UserDefaults
 * flag (`fitspoBurstPending`) and opens the app.  AppDelegate detects the flag
 * on `applicationDidBecomeActive` and posts an internal notification.
 * `InspoBurstPlugin` picks that up and emits the `burstTrigger` Capacitor event.
 *
 * Usage:
 *   const unsub = onNativeBurstTrigger(() => triggerCapture());
 *   // later…
 *   unsub();
 */

import { registerPlugin, Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

interface InspoBurstPluginInterface {
  addListener(
    event: 'burstTrigger',
    handler: () => void
  ): Promise<PluginListenerHandle>;
  /** Save a base64-encoded JPEG to the user's iOS Photos library. */
  savePhoto(options: { base64: string }): Promise<void>;
}

const InspoBurstPlugin = registerPlugin<InspoBurstPluginInterface>('InspoBurst', {
  // Web stub — no-op, the control and Photos library only exist on native iOS.
  web: {
    addListener: async (
      _event: string,
      _handler: () => void
    ): Promise<PluginListenerHandle> => {
      return { remove: async () => {} };
    },
    savePhoto: async () => {},
  },
});

/**
 * Subscribe to burst-trigger events fired by the iOS 18 Lock Screen control.
 * Returns an unsubscribe function.
 *
 * Only fires on native iOS; silently no-ops on web.
 */
export function onNativeBurstTrigger(handler: () => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};

  let handle: PluginListenerHandle | null = null;
  InspoBurstPlugin.addListener('burstTrigger', handler).then((h) => {
    handle = h;
  });

  return () => {
    handle?.remove();
  };
}

/**
 * Save a JPEG Blob to the user's iOS Photos library. No-op on web.
 * Triggers the add-only permission prompt on first call. Safe to call for
 * every burst frame — PHPhotoLibrary handles concurrent writes.
 */
export async function savePhotoToLibrary(blob: Blob): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const base64 = await blobToBase64(blob);
  await InspoBurstPlugin.savePhoto({ base64 });
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        // result is a data URL like "data:image/jpeg;base64,XXXX" — strip the prefix
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      } else {
        reject(new Error('FileReader returned non-string'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}
