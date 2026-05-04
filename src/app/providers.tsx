'use client';

import { useEffect, useState, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { markScheduleTap } from '@/lib/workout-schedule';
import { werePermissionsRequested } from '@/features/health/healthService';
import { runForegroundSync } from '@/features/health/healthSync';
import { hydrateExercises } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import { processPendingUploads } from '@/lib/photo-upload-queue';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: true,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

// Listens for workout-schedule notification taps and routes to /workout.
function NotificationRouter() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cleanup: (() => void) | undefined;

    LocalNotifications.addListener('localNotificationActionPerformed', action => {
      if (action.notification.extra?.type === 'workout-schedule') {
        markScheduleTap();
        router.push('/workout');
      }
    }).then(handle => {
      cleanup = () => handle.remove();
    });

    return () => cleanup?.();
  }, [router]);

  return null;
}

// Boots Dexie hydration + sync engine on mount, and consolidates all
// foreground-sync triggers (HealthKit + main sync engine) into a single
// listener so we don't run two parallel resume-sync layers.
//
// Rate-limit: HealthKit sync at most once every 2 minutes to avoid iOS
// rapid-firing appStateChange. The main sync engine has its own internal
// guards (`_pulling`, `_pushing`) and is cheap (15s polling already), so it
// fires on every visible/active event.
const HEALTHKIT_SYNC_MIN_INTERVAL_MS = 2 * 60 * 1000;

function AppBootstrap() {
  const lastHealthkitSyncAt = useRef(0);

  useEffect(() => {
    // Hydrate the exercise catalog so the workout view never shows
    // "Unknown Exercise" on cold start. Idempotent.
    hydrateExercises();

    // Start the sync engine. Idempotent — safe under React StrictMode
    // remount and route remounts.
    syncEngine.start();

    // Consolidated foreground sync trigger.
    const triggerForegroundSync = () => {
      if (!navigator.onLine) return;

      // Main app sync runs every time we come to foreground (no cooldown
      // beyond the engine's internal `_pulling` guard). MCP-driven changes
      // appear within a single 15s tick at worst, instantly when returning
      // from background.
      syncEngine.sync();

      // Drain the queued photo uploads (progress_photos captured offline).
      // The helper is idempotent + concurrency-guarded internally.
      processPendingUploads().catch(() => undefined);

      // HealthKit sync is more expensive (HKQueryDescriptors round-trip
      // through native bridge); throttle to 2 min minimum.
      if (Capacitor.isNativePlatform() && werePermissionsRequested()) {
        const now = Date.now();
        if (now - lastHealthkitSyncAt.current >= HEALTHKIT_SYNC_MIN_INTERVAL_MS) {
          lastHealthkitSyncAt.current = now;
          runForegroundSync().catch(() => undefined);
        }
      }
    };

    // visibilitychange catches tab/PWA web-side visibility transitions.
    const onVisible = () => { if (!document.hidden) triggerForegroundSync(); };
    document.addEventListener('visibilitychange', onVisible);

    // Drain queued photo uploads when network returns. syncEngine has its
    // own online listener; we hook here too so progress-photo retries aren't
    // gated on a foreground/visibility transition.
    const onOnline = () => { processPendingUploads().catch(() => undefined); };
    window.addEventListener('online', onOnline);

    // App.appStateChange catches Capacitor native foreground/background.
    let capCleanup: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) triggerForegroundSync();
      }).then(handle => {
        capCleanup = () => handle.remove();
      });
    }

    // Initial trigger on mount (catches the case where the app was already
    // open in the background when JS booted).
    if (Capacitor.isNativePlatform() && werePermissionsRequested()) {
      lastHealthkitSyncAt.current = Date.now();
      runForegroundSync().catch(() => undefined);
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      capCleanup?.();
      // Don't stop syncEngine — it's a singleton across the app lifetime.
    };
  }, []);

  return null;
}

// E2E test bridge mount. Gated on a build-time env var so non-E2E builds
// never load the bridge module — the dynamic `import()` is dead-eliminated
// by webpack when NEXT_PUBLIC_E2E !== '1'. scripts/check-no-test-bridge.sh
// belt-and-braces greps the static export for `__rebirthTestBridge`.
function TestBridgeMount() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_E2E !== '1') return;
    import('@/lib/test-bridge').then(m => m.mountTestBridge());
  }, []);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <NotificationRouter />
      <AppBootstrap />
      <TestBridgeMount />
      {children}
      {process.env.NODE_ENV === 'development' ? (
        <ReactQueryDevtools buttonPosition="bottom-left" />
      ) : null}
    </QueryClientProvider>
  );
}
