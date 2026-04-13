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
}

const InspoBurstPlugin = registerPlugin<InspoBurstPluginInterface>('InspoBurst', {
  // Web stub — no-op, the control only exists on native iOS 18.
  web: {
    addListener: async (
      _event: string,
      _handler: () => void
    ): Promise<PluginListenerHandle> => {
      return { remove: async () => {} };
    },
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
