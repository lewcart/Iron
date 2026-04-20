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

// Kicks off a HealthKit foreground sync on app launch + on app resume, if the
// user has previously connected HealthKit. Rate-limited to once every 2 minutes
// to avoid thrashing when iOS rapid-fires appStateChange events.
const HEALTHKIT_SYNC_MIN_INTERVAL_MS = 2 * 60 * 1000;

function HealthKitResumeSync() {
  const lastSyncAt = useRef(0);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const trigger = () => {
      // Skip sync on boot if we've never connected — the Settings-side probe
      // will discover the real state via server lookup if localStorage was wiped.
      if (!werePermissionsRequested()) return;
      const now = Date.now();
      if (now - lastSyncAt.current < HEALTHKIT_SYNC_MIN_INTERVAL_MS) return;
      lastSyncAt.current = now;
      runForegroundSync().catch(() => undefined);
    };

    // Initial on mount
    trigger();

    let cleanup: (() => void) | undefined;
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) trigger();
    }).then(handle => {
      cleanup = () => handle.remove();
    });

    return () => cleanup?.();
  }, []);

  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <NotificationRouter />
      <HealthKitResumeSync />
      {children}
      {process.env.NODE_ENV === 'development' ? (
        <ReactQueryDevtools buttonPosition="bottom-left" />
      ) : null}
    </QueryClientProvider>
  );
}
