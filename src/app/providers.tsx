'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { markScheduleTap } from '@/lib/workout-schedule';

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

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <NotificationRouter />
      {children}
      {process.env.NODE_ENV === 'development' ? (
        <ReactQueryDevtools buttonPosition="bottom-left" />
      ) : null}
    </QueryClientProvider>
  );
}
