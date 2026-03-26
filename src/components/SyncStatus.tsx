'use client';

import { useEffect, useState } from 'react';
import { syncEngine, type SyncStatus as SyncStatusType } from '@/lib/sync';
import { hydrateExercises } from '@/db/local';

export function SyncStatus() {
  const [status, setStatus] = useState<SyncStatusType>('idle');

  useEffect(() => {
    // Hydrate exercise library on mount
    hydrateExercises();

    // Start sync engine
    syncEngine.start();

    const unsub = syncEngine.subscribe(s => {
      setStatus(s);
    });

    return () => {
      unsub();
      syncEngine.stop();
    };
  }, []);

  // Don't render anything when idle and synced (most of the time)
  if (status === 'idle') return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center py-1 pointer-events-none">
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium shadow-lg bg-zinc-900/90 backdrop-blur-sm border border-zinc-800">
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
            <span className="text-zinc-300">Sync error</span>
          </>
        )}
      </div>
    </div>
  );
}

