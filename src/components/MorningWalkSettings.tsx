'use client';

import { useEffect, useState } from 'react';
import { MapPin, Clock } from 'lucide-react';
import {
  setHomeLocation,
  setGymLocation,
  removeGymLocation,
  setDepartWindows,
  setAutoWalkEnabled,
  cancelActiveWalk,
  getActiveWalkState,
  getGeofenceStatus,
  onWalkStateChanged,
  saveHomeLocationToLS,
  saveGymLocationToLS,
  loadGymLocationFromLS,
  clearGymLocationFromLS,
  saveDepartWindowsToLS,
  loadDepartWindowsFromLS,
  isAutoWalkEnabledFromLS,
  saveAutoWalkEnabledToLS,
  isGeofenceAvailable,
  simulateWalkOutbound,
  simulateWalkInbound,
  requestHKWriteAuth,
  deleteRecentSimulatedWalks,
  openIOSSettings,
  type WalkSnapshot,
  type WalkPhase,
  type DepartWindows,
  DEFAULT_DEPART_WINDOWS,
} from '@/lib/geofence';

function IconBadge({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <div className={`w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 ${bg}`}>
      {children}
    </div>
  );
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${
        on ? 'bg-gradient-to-r from-trans-blue to-trans-pink' : 'bg-secondary'
      }`}
      aria-label="Toggle morning walk automation"
    >
      <span
        className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${
          on ? 'left-0.5 right-auto' : 'right-0.5 left-auto'
        }`}
      />
    </button>
  );
}

function formatDistanceMeters(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function formatDurationSeconds(s: number): string {
  const m = Math.round(s / 60);
  return `${m} min`;
}

function isActivePhase(phase: WalkPhase): boolean {
  return phase === 'walkOutboundActive' || phase === 'walkInboundActive';
}

export function MorningWalkSettings() {
  const available = isGeofenceAvailable();
  const [enabled, setEnabled] = useState(false);
  const [homeSet, setHomeSet] = useState(false);
  const [gymSet, setGymSet] = useState(false);
  const [gymRadius, setGymRadius] = useState(100);
  const [windows, setWindows] = useState<DepartWindows>(DEFAULT_DEPART_WINDOWS);
  const [snap, setSnap] = useState<WalkSnapshot | null>(null);
  const [permRevoked, setPermRevoked] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [simRunning, setSimRunning] = useState(false);
  const [simResult, setSimResult] = useState<string | null>(null);

  // Initial sync
  useEffect(() => {
    if (!available) return;
    setEnabled(isAutoWalkEnabledFromLS());
    setWindows(loadDepartWindowsFromLS());
    const gym = loadGymLocationFromLS();
    if (gym) {
      setGymSet(true);
      setGymRadius(gym.radius ?? 100);
    }
    getGeofenceStatus().then((s) => {
      setHomeSet(Boolean(s.homeMonitored));
      setGymSet(Boolean(s.gymMonitored));
      if (s.gymRadius) setGymRadius(s.gymRadius);
    });
    getActiveWalkState().then((s) => setSnap(s));

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
    return () => unsub();
  }, [available]);

  // Foreground reconciliation — pull on visibility change.
  useEffect(() => {
    if (!available) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        getActiveWalkState().then((s) => {
          setSnap(s);
          if (s.hkWriteLikelyDenied) setPermRevoked(true);
        });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [available]);

  if (!available) return null;

  const handleMasterToggle = async () => {
    const next = !enabled;
    setEnabled(next);
    saveAutoWalkEnabledToLS(next);
    try {
      await setAutoWalkEnabled(next);
      // First-time enable: trigger the iOS HealthKit permission sheet now
      // (one well-timed prompt) so the dev simulate path + real morning save
      // both work without per-tap reprompts.
      if (next) {
        await requestHKWriteAuth();
      }
    } catch (err) {
      console.warn('[MorningWalk] setAutoWalkEnabled failed', err);
    }
  };

  const handleSetHome = async () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        try {
          const status = await setHomeLocation({ lat, lon, radius: 175 });
          if (status.monitoring) {
            saveHomeLocationToLS(lat, lon, 175);
            setHomeSet(true);
          }
        } catch (err) {
          console.error('[MorningWalk] setHomeLocation failed', err);
        }
      },
      (err) => console.error('[MorningWalk] getCurrentPosition (home) failed', err),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSetGym = async () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        try {
          const status = await setGymLocation({ lat, lon, radius: gymRadius });
          if (status.monitoring) {
            saveGymLocationToLS(lat, lon, gymRadius);
            setGymSet(true);
          }
        } catch (err) {
          console.error('[MorningWalk] setGymLocation failed', err);
        }
      },
      (err) => console.error('[MorningWalk] getCurrentPosition failed', err),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleRemoveGym = async () => {
    await removeGymLocation();
    clearGymLocationFromLS();
    setGymSet(false);
  };

  const handleGymRadiusChange = async (r: number) => {
    setGymRadius(r);
    if (!gymSet) return;
    const saved = loadGymLocationFromLS();
    if (!saved) return;
    await setGymLocation({ ...saved, radius: r });
    saveGymLocationToLS(saved.lat, saved.lon, r);
  };

  const handleWindowChange = async (
    bucket: 'weekday' | 'weekend',
    field: 'start' | 'end',
    value: string
  ) => {
    const next: DepartWindows = {
      ...windows,
      [bucket]: { ...windows[bucket], [field]: value },
    };
    setWindows(next);
    saveDepartWindowsToLS(next);
    try {
      await setDepartWindows(next);
    } catch (err) {
      console.warn('[MorningWalk] setDepartWindows failed', err);
    }
  };

  const handleCancelWalk = async () => {
    try {
      await cancelActiveWalk();
    } catch (err) {
      console.warn('[MorningWalk] cancelActiveWalk failed', err);
    }
  };

  const handleSimulateOutbound = async () => {
    setSimRunning(true);
    setSimResult(null);
    try {
      const r = await simulateWalkOutbound();
      setSimResult(`Walk-1 simulated (${r.durationMinutes} min). Check Apple Health.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSimResult(`Walk-1 sim failed: ${msg}`);
    } finally {
      setSimRunning(false);
    }
  };

  const handleSimulateInbound = async () => {
    setSimRunning(true);
    setSimResult(null);
    try {
      const r = await simulateWalkInbound();
      setSimResult(`Walk-2 simulated (${r.durationMinutes} min). Check Apple Health.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSimResult(`Walk-2 sim failed: ${msg}`);
    } finally {
      setSimRunning(false);
    }
  };

  const handleDeleteSimWalks = async () => {
    setSimRunning(true);
    setSimResult(null);
    try {
      const r = await deleteRecentSimulatedWalks();
      setSimResult(`Deleted ${r.deleted} Rebirth walk${r.deleted === 1 ? '' : 's'} from the last hour.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSimResult(`Delete failed: ${msg}`);
    } finally {
      setSimRunning(false);
    }
  };

  const phase = snap?.phase ?? 'idle';
  const isActive = isActivePhase(phase);

  return (
    <div>
      <p className="text-label-section mb-1 px-1">Auto-log Morning Walks</p>
      <div className="ios-section">
        {/* Today's flow / status row */}
        <TodaysFlow phase={phase} snap={snap} />

        {/* Active walk banner — only when recording */}
        {isActive && snap && (
          <div className="ios-row justify-between bg-trans-pink/10">
            <div className="flex items-center gap-3 min-w-0">
              <IconBadge bg="bg-trans-pink">
                <MapPin className="w-4 h-4 text-white" />
              </IconBadge>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">
                  {phase === 'walkOutboundActive' ? 'Walk to gym recording' : 'Walk home recording'}
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatDistanceMeters(snap.distanceMeters)} · {formatDurationSeconds(snap.durationSeconds)}
                </p>
              </div>
            </div>
            <button
              onClick={handleCancelWalk}
              className="px-3 py-2 rounded-md bg-red-600 text-white text-sm font-medium min-h-[44px] min-w-[44px]"
              aria-label="Cancel active walk"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Permission-revoked banner */}
        {permRevoked && (
          <div className="ios-row bg-red-50 dark:bg-red-950/40">
            <p className="text-sm text-red-700 dark:text-red-300">
              Health write permission was denied. Tap to retry the next walk.
            </p>
          </div>
        )}

        {/* Master toggle */}
        <div className="ios-row justify-between">
          <div className="flex items-center gap-3">
            <IconBadge bg="bg-green-600">
              <MapPin className="w-4 h-4 text-white" />
            </IconBadge>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium">Auto-log walks</span>
              <p className="text-xs text-muted-foreground mt-0.5 pr-4">
                Records walks to/from the gym during your morning windows.
              </p>
            </div>
          </div>
          <Toggle on={enabled} onToggle={handleMasterToggle} />
        </div>

        {/* Home + gym setup */}
        {enabled && (
          <>
            {/* Home location — shared with the existing Auto-end at Home geofence */}
            <div className="ios-row justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <IconBadge bg="bg-pink-600">
                  <MapPin className="w-4 h-4 text-white" />
                </IconBadge>
                <div>
                  <span className="text-sm font-medium">Home location</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {homeSet
                      ? 'Set — shared with Auto-end at Home'
                      : 'Not set — leaving home triggers walk-1'}
                  </p>
                </div>
              </div>
              {!homeSet && (
                <button
                  onClick={handleSetHome}
                  className="px-3 py-2 text-sm bg-secondary rounded-md min-h-[44px]"
                >
                  Set
                </button>
              )}
            </div>

            <div className="ios-row justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <IconBadge bg="bg-blue-600">
                  <MapPin className="w-4 h-4 text-white" />
                </IconBadge>
                <div>
                  <span className="text-sm font-medium">Gym location</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {gymSet ? 'Set — uses current location' : 'Not set'}
                  </p>
                </div>
              </div>
              {gymSet ? (
                <button
                  onClick={handleRemoveGym}
                  className="px-3 py-2 text-sm text-red-600 min-h-[44px]"
                >
                  Clear
                </button>
              ) : (
                <button
                  onClick={handleSetGym}
                  className="px-3 py-2 text-sm bg-secondary rounded-md min-h-[44px]"
                >
                  Set
                </button>
              )}
            </div>

            {gymSet && (
              <div className="ios-row justify-between">
                <span className="text-sm font-medium">Gym radius</span>
                <select
                  value={gymRadius}
                  onChange={(e) => handleGymRadiusChange(Number(e.target.value))}
                  className="text-sm text-muted-foreground bg-transparent outline-none text-right"
                >
                  {[75, 100, 125, 150].map((r) => (
                    <option key={r} value={r}>{r} m</option>
                  ))}
                </select>
              </div>
            )}

            {/* Time windows */}
            <div className="ios-row justify-between">
              <div className="flex items-center gap-3">
                <IconBadge bg="bg-purple-600">
                  <Clock className="w-4 h-4 text-white" />
                </IconBadge>
                <span className="text-sm font-medium">Weekday window</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={windows.weekday.start}
                  onChange={(e) => handleWindowChange('weekday', 'start', e.target.value)}
                  className="text-sm bg-transparent outline-none"
                />
                <span className="text-xs text-muted-foreground">–</span>
                <input
                  type="time"
                  value={windows.weekday.end}
                  onChange={(e) => handleWindowChange('weekday', 'end', e.target.value)}
                  className="text-sm bg-transparent outline-none"
                />
              </div>
            </div>

            <div className="ios-row justify-between">
              <div className="flex items-center gap-3">
                <IconBadge bg="bg-purple-600">
                  <Clock className="w-4 h-4 text-white" />
                </IconBadge>
                <span className="text-sm font-medium">Weekend window</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={windows.weekend.start}
                  onChange={(e) => handleWindowChange('weekend', 'start', e.target.value)}
                  className="text-sm bg-transparent outline-none"
                />
                <span className="text-xs text-muted-foreground">–</span>
                <input
                  type="time"
                  value={windows.weekend.end}
                  onChange={(e) => handleWindowChange('weekend', 'end', e.target.value)}
                  className="text-sm bg-transparent outline-none"
                />
              </div>
            </div>
          </>
        )}
      </div>
      {enabled && (!homeSet || !gymSet) && (
        <p className="text-xs text-muted-foreground px-1 mt-1">
          {!homeSet
            ? 'Set Home while standing at home for best accuracy.'
            : 'Set Gym while standing inside the gym for best accuracy.'}
        </p>
      )}

      {enabled && gymSet && (
        <div className="mt-3">
          <button
            onClick={() => setDevOpen(!devOpen)}
            className="text-xs text-muted-foreground px-1"
          >
            {devOpen ? '▼' : '▶'} Dev tools
          </button>
          {devOpen && (
            <div className="ios-section mt-1">
              <div className="ios-row flex-col items-stretch gap-2 py-3">
                <p className="text-xs text-muted-foreground">
                  Run a fake morning flow without leaving the house. Each button saves a
                  real Apple Health workout with a synthetic GPS route around the
                  midpoint between your home and gym.
                </p>
                <div className="flex flex-col gap-2 mt-1">
                  <button
                    onClick={handleSimulateOutbound}
                    disabled={simRunning}
                    className="px-3 py-2 rounded-md bg-secondary text-sm font-medium min-h-[44px] disabled:opacity-50"
                  >
                    Simulate walk-1 (depart → gym, 18 min)
                  </button>
                  <p className="text-xs text-muted-foreground">
                    Then tap Start workout in Rebirth, log a set, tap Finish to wire walk-2.
                  </p>
                  <button
                    onClick={handleSimulateInbound}
                    disabled={simRunning}
                    className="px-3 py-2 rounded-md bg-secondary text-sm font-medium min-h-[44px] disabled:opacity-50"
                  >
                    Simulate walk-2 (gym → home, 16 min)
                  </button>
                  <button
                    onClick={handleDeleteSimWalks}
                    disabled={simRunning}
                    className="px-3 py-2 rounded-md text-sm font-medium min-h-[44px] text-red-600 border border-red-600/40 disabled:opacity-50 mt-1"
                  >
                    Delete Rebirth walks from last hour
                  </button>
                  <button
                    onClick={() => openIOSSettings()}
                    className="px-3 py-2 rounded-md text-sm font-medium min-h-[44px] bg-secondary mt-1"
                  >
                    Open iOS Settings → Rebirth
                  </button>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    From there, tap <b>Health Access</b> and toggle ON: Workouts, Workout Routes,
                    Distance Walking + Running, and Active Energy.
                  </p>
                  {simResult && (
                    <p className="text-xs text-foreground mt-1">{simResult}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TodaysFlow({ phase, snap }: { phase: WalkPhase; snap: WalkSnapshot | null }) {
  // Empty state — no flow yet
  if (phase === 'idle' && !snap?.flowId) {
    return (
      <div className="ios-row">
        <p className="text-xs text-muted-foreground">
          No morning flows yet. Tomorrow at 04:30, leaving home will start one.
        </p>
      </div>
    );
  }

  if (phase === 'completed') {
    return (
      <div className="ios-row">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Today</span>
          <span className="text-sm font-medium">Both walks saved</span>
        </div>
      </div>
    );
  }

  if (phase === 'partialMissedInbound') {
    return (
      <div className="ios-row">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Today</span>
          <span className="text-sm font-medium">Walk to gym saved · return walk missed</span>
        </div>
      </div>
    );
  }

  if (phase === 'failedSaveAwaitingRetry') {
    return (
      <div className="ios-row bg-amber-50 dark:bg-amber-950/40">
        <p className="text-sm text-amber-800 dark:text-amber-200">
          Route captured but Health save failed. Tap to retry.
        </p>
      </div>
    );
  }

  if (phase === 'atGymWalkSaved') {
    return (
      <div className="ios-row">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Today</span>
          <span className="text-sm font-medium">Walk to gym saved · ready to lift</span>
        </div>
      </div>
    );
  }

  if (phase === 'strengthActive') {
    return (
      <div className="ios-row">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Today</span>
          <span className="text-sm font-medium">Strength workout in progress</span>
        </div>
      </div>
    );
  }

  return null;
}
