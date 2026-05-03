'use client';

import { useCallback, useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { ExternalLink, RefreshCw, HeartPulse, SlidersHorizontal } from 'lucide-react';
import { HealthKit } from '@/lib/healthkit';
import { markPermissionsRequested } from '@/features/health/healthService';
import {
  connectHealthKit,
  runForegroundSync,
  type SyncResult,
} from '@/features/health/healthSync';
import { apiBase } from '@/lib/api/client';
import { HealthKitPermissionsSheet } from '@/components/HealthKitPermissionsSheet';
import { HK_RAW_ENTRIES } from '@/lib/healthkit-catalog';

// Derived from the catalog so this summary cannot drift from the actual request set.
// Buckets reads/writes by category so the line stays stable as types are added.
const HK_SUMMARY = (() => {
	const bucket = (pred: (t: { access: string }) => boolean) => {
		const cats = new Set<string>();
		for (const t of HK_RAW_ENTRIES) if (pred(t)) cats.add(t.category);
		return [...cats].map((c) => ({
			activity: 'activity', clinical: 'vitals', bodycomp: 'body comp',
			workouts: 'workouts', sleep: 'sleep', nutrition: 'nutrition',
			medications: 'medications',
		}[c] ?? c)).join(', ');
	};
	return {
		reads: bucket((t) => t.access === 'read' || t.access === 'readWrite'),
		writes: bucket((t) => t.access === 'write' || t.access === 'readWrite'),
	};
})();

// Coarse status — iOS hides per-type read auth, so pretending we know more
// than "unavailable | not-connected | connected | error" is false precision.
type Status = 'unavailable' | 'not-connected' | 'connected' | 'syncing' | 'error';

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function HealthKitSettings() {
  const [status, setStatus] = useState<Status>('not-connected');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [permsSheetOpen, setPermsSheetOpen] = useState(false);

  const applySyncResult = useCallback((result: SyncResult) => {
    if (result.ok) {
      setStatus('connected');
      setLastSyncAt(new Date().toISOString());
      setErrorMessage(null);
      setConsecutiveErrors(0);
    } else if (result.reason === 'unavailable') {
      setStatus('unavailable');
    } else if (result.reason === 'not_requested' || result.reason === 'revoked') {
      setStatus('not-connected');
    } else {
      setStatus(prev => (prev === 'connected' ? 'connected' : 'error'));
      setErrorMessage(result.reason ?? 'unknown error');
      setConsecutiveErrors(n => n + 1);
    }
  }, []);

  const probeStatus = useCallback(async () => {
    try {
      const { available } = await HealthKit.isAvailable();
      if (!available) {
        setStatus('unavailable');
        return;
      }

      // Server state is truth — if any metric has ever successfully synced,
      // we've previously connected. localStorage is too fragile (can be cleared
      // on app reinstall or when the webview cache is purged).
      let serverSaysConnected = false;
      let serverLastSync: string | null = null;
      try {
        const res = await fetch(`${apiBase()}/api/healthkit/sync`);
        if (res.ok) {
          const { state } = (await res.json()) as { state: Record<string, { last_successful_sync_at: string | null }> };
          for (const s of Object.values(state ?? {})) {
            if (s.last_successful_sync_at) {
              serverSaysConnected = true;
              if (!serverLastSync || s.last_successful_sync_at > serverLastSync) {
                serverLastSync = s.last_successful_sync_at;
              }
            }
          }
        }
      } catch {
        // Network unavailable — fall through to native sync attempt
      }

      if (serverSaysConnected) {
        // Forward-migrate the localStorage flag so old call sites work
        markPermissionsRequested();
        setLastSyncAt(serverLastSync);
        // Kick off a fresh sync in the background; don't block the UI
        setStatus('connected');
        runForegroundSync().then(applySyncResult).catch(() => undefined);
        return;
      }

      // No server record → either never connected, or first-ever sync hasn't
      // completed. Try a sync: if native grants return true, we'll connect.
      // If not, we show "not-connected".
      setStatus('syncing');
      const result = await runForegroundSync();
      if (result.ok) {
        applySyncResult(result);
      } else if (result.reason === 'not_requested' || result.reason === 'revoked') {
        setStatus('not-connected');
      } else {
        applySyncResult(result);
      }
    } catch {
      setStatus('not-connected');
    }
  }, [applySyncResult]);

  useEffect(() => {
    probeStatus();

    const handle = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) probeStatus();
    });
    return () => {
      handle.then(h => h.remove());
    };
  }, [probeStatus]);

  const handleConnect = useCallback(async () => {
    setStatus('syncing');
    setErrorMessage(null);
    try {
      const result = await connectHealthKit();
      if (result.ok || result.reason === 'not_requested') {
        // connectHealthKit always calls markPermissionsRequested — if the user
        // had already granted before, we just re-sync here.
        applySyncResult(result);
      } else if (result.reason === 'revoked') {
        setStatus('not-connected');
        setErrorMessage('Permission denied. Grant access in Apple Health to connect.');
      } else {
        applySyncResult(result);
      }
    } catch (e) {
      setStatus('error');
      setErrorMessage(e instanceof Error ? e.message : 'Could not connect — try again.');
    }
  }, [applySyncResult]);

  const handleSyncNow = useCallback(async () => {
    setStatus('syncing');
    markPermissionsRequested();
    try {
      const result = await runForegroundSync();
      applySyncResult(result);
    } catch {
      setStatus('error');
      setErrorMessage('Sync failed — try again.');
    }
  }, [applySyncResult]);

  const handleManageInHealth = useCallback(() => {
    // Prefer the Health app deep link; fall back to iOS Settings if unavailable.
    try {
      window.open('x-apple-health://', '_system');
    } catch {
      window.open('app-settings:', '_system');
    }
  }, []);

  if (status === 'unavailable') {
    return (
      <div>
        <p className="text-label-section mb-1 px-1">Apple Health</p>
        <div className="ios-section">
          <div className="px-4 py-3">
            <p className="text-sm font-medium">Unavailable on this device</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              HealthKit needs an iPhone. Connect from the Rebirth iOS app to sync your workouts and recovery data.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const showSyncError = status === 'error' && consecutiveErrors >= 3;

  return (
    <div>
      <p className="text-label-section mb-1 px-1">Apple Health</p>
      <div className="ios-section">
        {/* Status row */}
        <div className="ios-row justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 bg-pink-500/20">
              <HeartPulse className="w-4 h-4 text-pink-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                {status === 'connected' && 'Connected'}
                {status === 'not-connected' && 'Not connected'}
                {status === 'syncing' && 'Syncing…'}
                {status === 'error' && (showSyncError ? 'Sync error' : 'Connected')}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {status === 'connected' && lastSyncAt && `Last synced ${formatAgo(lastSyncAt)}`}
                {status === 'not-connected' && 'Tap Connect to share workouts, heart rate, and sleep with your coach.'}
                {status === 'syncing' && 'Fetching from HealthKit…'}
                {showSyncError && (errorMessage ?? 'Tap Sync now to retry.')}
                {status === 'error' && !showSyncError && lastSyncAt && `Last synced ${formatAgo(lastSyncAt)}`}
              </p>
            </div>
          </div>
        </div>

        {/* Action rows */}
        {status === 'not-connected' && (
          <button
            onClick={handleConnect}
            className="ios-row justify-between w-full text-left"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 bg-primary">
                <RefreshCw className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="text-sm font-medium text-primary">Connect to Apple Health</span>
            </div>
          </button>
        )}

        {(status === 'connected' || status === 'syncing' || status === 'error') && (
          <>
            <button
              onClick={handleSyncNow}
              disabled={status === 'syncing'}
              className="ios-row justify-between w-full text-left disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 bg-blue-500/20">
                  <RefreshCw
                    className={`w-4 h-4 text-blue-400 ${status === 'syncing' ? 'animate-spin' : ''}`}
                  />
                </div>
                <span className="text-sm font-medium">Sync now</span>
              </div>
            </button>
            <button
              onClick={() => setPermsSheetOpen(true)}
              className="ios-row justify-between w-full text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 bg-violet-500/20">
                  <SlidersHorizontal className="w-4 h-4 text-violet-400" />
                </div>
                <span className="text-sm font-medium">Edit permissions</span>
              </div>
              <span className="text-xs text-muted-foreground">Reads &amp; writes</span>
            </button>
            <button
              onClick={handleManageInHealth}
              className="ios-row justify-between w-full text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 bg-secondary">
                  <ExternalLink className="w-4 h-4 text-muted-foreground" />
                </div>
                <span className="text-sm font-medium">Manage in Apple Health</span>
              </div>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </button>
          </>
        )}

        {status === 'not-connected' && (
          <button
            onClick={() => setPermsSheetOpen(true)}
            className="ios-row justify-between w-full text-left"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 bg-violet-500/20">
                <SlidersHorizontal className="w-4 h-4 text-violet-400" />
              </div>
              <span className="text-sm font-medium">Edit permissions</span>
            </div>
            <span className="text-xs text-muted-foreground">Reads &amp; writes</span>
          </button>
        )}
      </div>

      {/* Reads / writes summary — derived from the catalog so it can't drift. */}
      <div className="px-1 mt-2 space-y-1">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Reads:</span>{' '}
          {HK_SUMMARY.reads}.
        </p>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Writes:</span>{' '}
          {HK_SUMMARY.writes}.
        </p>
      </div>

      <HealthKitPermissionsSheet open={permsSheetOpen} onClose={() => setPermsSheetOpen(false)} />
    </div>
  );
}
