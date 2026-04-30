'use client';

import { useEffect, useState } from 'react';
import { syncEngine, type SyncStatus as SyncStatusType } from '@/lib/sync';

// SyncStatus is a *passive* indicator. It shows a small pill at the bottom
// of the screen when a sync is happening, the device is offline, or push/pull
// has errored. It NEVER blocks the UI with a full-screen overlay.
//
// Hydration of the bundled exercise catalog and starting the sync engine
// happen in providers.tsx, alongside HealthKitResumeSync, so foreground-sync
// triggers are consolidated in one place.

export function SyncStatus() {
  const [status, setStatus] = useState<SyncStatusType>(syncEngine.status);
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    const unsub = syncEngine.subscribe(s => {
      setStatus(s);
      if (s !== 'error') setShowError(false);
    });
    return unsub;
  }, []);

  // Don't render anything when idle and synced (most of the time).
  if (status === 'idle') return null;

  return (
    <div
      className="fixed left-0 right-0 z-50 flex items-center justify-center py-1 pointer-events-none"
      style={{ bottom: 'calc(var(--tab-bar-inner-height) + env(safe-area-inset-bottom, 0px) + 8px)' }}
    >
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
