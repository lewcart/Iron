'use client';

import { useEffect, useState } from 'react';
import { Footprints } from 'lucide-react';
import {
  finishActiveWalkNow,
  getActiveWalkState,
  isGeofenceAvailable,
  onWalkStateChanged,
  type WalkPhase,
  type WalkSnapshot,
} from '@/lib/geofence';

function isActivePhase(phase: WalkPhase): boolean {
  return phase === 'walkOutboundActive' || phase === 'walkInboundActive';
}

function formatDuration(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.round(s / 60);
  return `${m} min`;
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function ActiveWalkBanner() {
  const available = isGeofenceAvailable();
  const [snap, setSnap] = useState<WalkSnapshot | null>(null);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    getActiveWalkState().then((s) => {
      if (!cancelled) setSnap(s);
    });
    const unsub = onWalkStateChanged((evt) => {
      setSnap({
        phase: evt.phase,
        flowId: evt.flowId,
        startedAt: evt.startedAt,
        distanceMeters: evt.distanceMeters,
        durationSeconds: evt.durationSeconds,
        lastSampleAt: evt.lastSampleAt,
      });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [available]);

  useEffect(() => {
    if (!available) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        getActiveWalkState().then(setSnap);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [available]);

  if (!available || !snap || !isActivePhase(snap.phase)) return null;

  const handleFinish = async () => {
    setFinishing(true);
    try {
      await finishActiveWalkNow();
    } catch (err) {
      console.warn('[ActiveWalkBanner] finishActiveWalkNow failed', err);
    } finally {
      setFinishing(false);
    }
  };

  const legLabel = snap.phase === 'walkOutboundActive' ? 'Morning walk' : 'Walk home';

  return (
    <button
      onClick={handleFinish}
      disabled={finishing}
      className="w-full flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-trans-blue/15 to-trans-pink/15 border-b border-border min-h-[44px] active:opacity-70 transition-opacity"
      aria-label="Finish active walk"
    >
      <Footprints className="h-4 w-4 text-primary flex-shrink-0" strokeWidth={2} />
      <span className="flex-1 text-left text-sm font-medium truncate">
        {legLabel} active
        <span className="ml-2 text-muted-foreground text-xs font-normal">
          {formatDistance(snap.distanceMeters)} · {formatDuration(snap.durationSeconds)}
        </span>
      </span>
      <span className="text-primary text-sm font-semibold">
        {finishing ? 'Saving…' : 'Finish'}
      </span>
    </button>
  );
}
