'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

/**
 * Run a callback whenever the app/tab returns to the foreground.
 *
 * Wires up both visibility signals so iOS resume + web tab-switch are both
 * covered:
 *   - `document.visibilitychange` — fires on web tab focus and in
 *     Capacitor's WKWebView when the app comes back to foreground.
 *   - `App.appStateChange` (Capacitor) — iOS-native foreground signal,
 *     belt-and-braces in case visibilitychange doesn't fire on app resume
 *     (it's been flaky across iOS versions).
 *
 * Does NOT fire on mount — pair this with a normal initial-fetch useEffect.
 * Pages that fetch from the server into useState (no Dexie liveQuery) use
 * this so external mutations (MCP uploads, other devices, background sync)
 * become visible after the app is backgrounded and brought back up.
 *
 * Wrap the callback in useCallback at the call site so this effect doesn't
 * tear down and re-arm on every render.
 */
export function useRefetchOnVisible(callback: () => void): void {
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) callback();
    };

    document.addEventListener('visibilitychange', onVisible);

    let capCleanup: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) callback();
      }).then((handle) => {
        capCleanup = () => handle.remove();
      });
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      capCleanup?.();
    };
  }, [callback]);
}
