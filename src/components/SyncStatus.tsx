'use client';

import { useEffect, useState } from 'react';
import { syncEngine, type SyncStatus as SyncStatusType } from '@/lib/sync';
import { hydrateExercises, isExercisesReady, subscribeExercisesReady } from '@/db/local';

export function SyncStatus() {
  const [status, setStatus] = useState<SyncStatusType>('idle');
  const [exercisesReady, setExercisesReady] = useState(isExercisesReady());
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    // Hydrate exercise library on mount
    hydrateExercises();

    // Start sync engine
    syncEngine.start();

    const unsub = syncEngine.subscribe(s => {
      setStatus(s);
      if (s !== 'error') setShowError(false);
    });
    const unsubEx = subscribeExercisesReady(setExercisesReady);

    return () => {
      unsub();
      unsubEx();
      syncEngine.stop();
    };
  }, []);

  // Show loading overlay while exercises are hydrating for the first time
  if (!exercisesReady) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading exercises…</p>
        </div>
      </div>
    );
  }

  // Don't render anything when idle and synced (most of the time)
  if (status === 'idle') return null;

  return (
    <div className="fixed left-0 right-0 z-50 flex items-center justify-center py-1 pointer-events-none" style={{ bottom: 'calc(var(--tab-bar-inner-height) + env(safe-area-inset-bottom, 0px) + 8px)' }}>
      <div
        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium shadow-lg bg-zinc-900/90 backdrop-blur-sm border border-zinc-800 pointer-events-auto"
        onClick={() => status === 'error' && setShowError(v => !v)}
      >
        {status === 'syncing' && (
          <>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-zinc-300">Syncing…</span>
          </>
        )}
        {status === 'offline' && (
          <>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-500" />
            <span className="text-zinc-400">Offline</span>
          </>
        )}
        {status === 'error' && (
          <>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
            <span className="text-zinc-300">
              Sync error{showError && syncEngine.lastError ? `: ${syncEngine.lastError}` : ''}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
