'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import {
  STOPWATCH_STATE_KEY,
  computeElapsed,
  computeSwitchRemaining,
  newTabId,
  onLogFirstOnly,
  onResumeFromPause,
  onStop,
  onSwitchComplete,
  persistStopwatch,
  clearPersistedStopwatch,
  readPersistedStopwatch,
  restoreState,
  finalDurationSeconds,
  isOwnerTab,
  SWITCH_DURATION_MS,
  type StopwatchState,
  type StopwatchPhase,
} from './stopwatch-utils';

// In-hook audio: a small 2-tone beep for the switch-sides moment. Distinct
// enough from the rest-timer's 3-tone pattern that the user can identify
// which timer fired without looking. TODO (deferred per autoplan): extract
// to shared audio-alerts util along with rest-timer notify() so both
// share a single AudioContext + 200ms collision-gap lock.
function playSwitchBeep(): void {
  if (typeof window === 'undefined') return;
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const playBeep = (startTime: number, freq: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + dur);
      osc.start(startTime);
      osc.stop(startTime + dur);
    };
    playBeep(ctx.currentTime, 660, 0.12);
    playBeep(ctx.currentTime + 0.18, 880, 0.18);
  } catch { /* AudioContext unavailable — silent fallback per design spec */ }
}

function vibrateSwitch(): void {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate([60, 40, 100]);
  }
}

function notifyOSSwitch(): void {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification('Switch sides', { body: '10 seconds — flip and brace.' });
  }
}

export interface UseStopwatchApi {
  state: StopwatchState | null;
  /** Whole seconds elapsed in the current `counting` phase. 0 in other phases. */
  elapsed: number;
  /** Whole seconds remaining in the switch countdown. 0 in other phases. */
  switchRemaining: number;
  /** True if this tab can commit on Stop. False on a non-owner tab. */
  isOwner: boolean;
  /** True if the persisted state's setRowKey doesn't match a known set. */
  isOrphan: boolean;
  /** Open the sheet for a specific set. Idempotent — re-opening on a
   *  set that's already running just re-attaches. */
  open: (opts: { setRowKey: string; hasSides: boolean }) => void;
  /** User taps Stop. */
  stop: () => void;
  /** User taps Skip during switching. */
  skipSwitch: () => void;
  /** User taps "Start second side" from switch_expired_paused. */
  resumeFromPause: () => void;
  /** User taps "Done — log first only" from switch_expired_paused. */
  logFirstOnly: () => void;
  /** User taps Cancel / Discard. */
  cancel: () => void;
  /** Called by the consumer once the `done` payload has been written
   *  to Dexie. Clears persisted state. */
  consumeDone: () => StopwatchState | null;
}

/** Background-safe count-up stopwatch hook. Mirrors useRestTimer's
 *  persistence + appStateChange story but counts up and runs the
 *  side-cycling state machine. */
export function useStopwatch(opts?: { isSetAttached?: (setRowKey: string) => boolean }): UseStopwatchApi {
  const [state, setState] = useState<StopwatchState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [switchRemaining, setSwitchRemaining] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tabIdRef = useRef<string>('');
  // Single-fire guard for the switch-sides beep. Reset whenever a new
  // switching phase begins.
  const switchFiredRef = useRef(false);
  const isSetAttached = opts?.isSetAttached;

  // Lazy-init the tab id once per mount.
  if (tabIdRef.current === '') {
    tabIdRef.current = newTabId();
  }

  const stopInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const writeState = useCallback((next: StopwatchState | null) => {
    setState(next);
    if (next === null) {
      clearPersistedStopwatch(localStorage);
    } else {
      persistStopwatch(localStorage, next);
    }
  }, []);

  // Single tick: recompute elapsed / switchRemaining and auto-fire the
  // switch transition when the 10s window completes (foreground only —
  // background-resumed expired switch lands on `switch_expired_paused`
  // via restoreState, NOT here).
  const tick = useCallback(() => {
    setState(prev => {
      if (!prev) return prev;
      const now = Date.now();
      if (prev.phase === 'counting') {
        setElapsed(computeElapsed(prev.startedAt, now));
        return prev;
      }
      if (prev.phase === 'switching' && prev.switchEndTime != null) {
        const rem = computeSwitchRemaining(prev.switchEndTime, now);
        setSwitchRemaining(rem);
        if (rem <= 0) {
          if (!switchFiredRef.current) {
            switchFiredRef.current = true;
            playSwitchBeep();
            vibrateSwitch();
            notifyOSSwitch();
          }
          const next = onSwitchComplete(prev, now);
          // Reset the guard for any future switching phase (none today,
          // but defends against future "more than 2 sides" extension).
          switchFiredRef.current = false;
          persistStopwatch(localStorage, next);
          setSwitchRemaining(0);
          return next;
        }
        return prev;
      }
      return prev;
    });
  }, []);

  // Start ticking whenever there's a live state (counting or switching).
  useEffect(() => {
    if (!state) {
      stopInterval();
      return;
    }
    if (state.phase !== 'counting' && state.phase !== 'switching') {
      stopInterval();
      return;
    }
    // Stopwatch poll at 1000ms — count-up displays whole seconds only.
    // (Switch-countdown also at 1000ms; the user reads 10→0.)
    stopInterval();
    intervalRef.current = setInterval(tick, 1000);
    // Run once immediately so initial readout doesn't lag.
    tick();
    return stopInterval;
  }, [state, stopInterval, tick]);

  // Restore on mount: read localStorage, apply the switch-expired-paused
  // rule via restoreState, check for orphan setRowKey.
  useEffect(() => {
    const saved = readPersistedStopwatch(localStorage);
    if (!saved) return;
    const restored = restoreState(saved, Date.now());
    setState(restored);
    if (restored !== saved) {
      persistStopwatch(localStorage, restored);
    }
  }, []);

  // Cross-tab arbitration via the storage event. When another tab writes
  // a new state (or clears it), reflect that here so a non-owner tab
  // updates its UI without a poll.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STOPWATCH_STATE_KEY) return;
      if (e.newValue === null) {
        setState(null);
        return;
      }
      const saved = readPersistedStopwatch(localStorage);
      if (saved) {
        setState(restoreState(saved, Date.now()));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Resync on app foreground (Capacitor native). Mirrors useRestTimer's
  // pattern — a backgrounded stopwatch with phase=switching may have
  // expired during the suspension window.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      const saved = readPersistedStopwatch(localStorage);
      if (!saved) {
        setState(null);
        return;
      }
      const restored = restoreState(saved, Date.now());
      setState(restored);
      if (restored !== saved) {
        persistStopwatch(localStorage, restored);
      }
    }).then(handle => {
      cleanup = () => handle.remove();
    });
    return () => cleanup?.();
  }, []);

  const open: UseStopwatchApi['open'] = useCallback(({ setRowKey, hasSides }) => {
    const now = Date.now();
    const next: StopwatchState = {
      setRowKey,
      ownerTabId: tabIdRef.current,
      hasSides,
      phase: 'counting',
      side: 1,
      startedAt: now,
      side1Elapsed: null,
      side2Elapsed: null,
      switchEndTime: null,
      updatedAt: now,
    };
    switchFiredRef.current = false;
    writeState(next);
    setElapsed(0);
    setSwitchRemaining(0);
  }, [writeState]);

  const stop: UseStopwatchApi['stop'] = useCallback(() => {
    setState(prev => {
      if (!prev) return prev;
      const next = onStop(prev, Date.now());
      if (next !== prev) {
        if (next.phase === 'switching') {
          // Fresh switching phase — reset the fire guard.
          switchFiredRef.current = false;
          setSwitchRemaining(SWITCH_DURATION_MS / 1000);
        }
        persistStopwatch(localStorage, next);
      }
      return next;
    });
  }, []);

  const skipSwitch: UseStopwatchApi['skipSwitch'] = useCallback(() => {
    setState(prev => {
      if (!prev) return prev;
      const next = onSwitchComplete(prev, Date.now());
      if (next !== prev) {
        switchFiredRef.current = false;
        setSwitchRemaining(0);
        persistStopwatch(localStorage, next);
      }
      return next;
    });
  }, []);

  const resumeFromPause: UseStopwatchApi['resumeFromPause'] = useCallback(() => {
    setState(prev => {
      if (!prev) return prev;
      const next = onResumeFromPause(prev, Date.now());
      if (next !== prev) {
        persistStopwatch(localStorage, next);
      }
      return next;
    });
  }, []);

  const logFirstOnly: UseStopwatchApi['logFirstOnly'] = useCallback(() => {
    setState(prev => {
      if (!prev) return prev;
      const next = onLogFirstOnly(prev, Date.now());
      if (next !== prev) {
        persistStopwatch(localStorage, next);
      }
      return next;
    });
  }, []);

  const cancel: UseStopwatchApi['cancel'] = useCallback(() => {
    writeState(null);
    setElapsed(0);
    setSwitchRemaining(0);
  }, [writeState]);

  const consumeDone: UseStopwatchApi['consumeDone'] = useCallback(() => {
    let captured: StopwatchState | null = null;
    setState(prev => {
      captured = prev;
      return null;
    });
    clearPersistedStopwatch(localStorage);
    setElapsed(0);
    setSwitchRemaining(0);
    return captured;
  }, []);

  const isOwner = state ? isOwnerTab(state, tabIdRef.current) : true;
  const isOrphan = state != null && isSetAttached != null && !isSetAttached(state.setRowKey);

  return {
    state,
    elapsed,
    switchRemaining,
    isOwner,
    isOrphan,
    open,
    stop,
    skipSwitch,
    resumeFromPause,
    logFirstOnly,
    cancel,
    consumeDone,
  };
}

export function stopwatchPhaseLabel(phase: StopwatchPhase): string {
  switch (phase) {
    case 'idle': return 'Ready';
    case 'counting': return 'Running';
    case 'switching': return 'Switch sides';
    case 'switch_expired_paused': return 'Paused — start side 2?';
    case 'done': return 'Done';
  }
}

export { finalDurationSeconds };
