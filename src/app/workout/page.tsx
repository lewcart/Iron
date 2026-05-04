'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { App } from '@capacitor/app';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import {
  persistTimer as _persistTimer,
  clearPersistedTimer as _clearPersistedTimer,
  readPersistedTimer as _readPersistedTimer,
  computeRemaining,
} from './rest-timer-utils';
import { useStopwatch } from './useStopwatch';
import { StopwatchSheet } from './StopwatchSheet';
import {
  requestNotificationPermission,
  scheduleRestNotification,
  cancelRestNotification,
} from '@/lib/rest-notifications';
import {
  startRestActivity,
  updateRestActivity,
  endRestActivity,
} from '@/lib/native/rest-timer-activity';
import { consumeScheduleTap } from '@/lib/workout-schedule';
import { HealthSection } from '@/components/HealthSection';
import Link from 'next/link';
import { Check, ChevronDown, ChevronRight, ChevronsUp, ChevronUp, ClipboardList, Clock, Dumbbell, Equal, GripVertical, Info, Plus, Search, Timer, X } from 'lucide-react';
import { ExerciseDetailModal } from '@/components/ExerciseDetailModal';
import type { WorkoutPlan, WorkoutRoutine, WorkoutRoutineExercise, WorkoutRoutineSet, Exercise } from '@/types';
import { formatTime, calcCompletedSets, calcTotalVolume } from './workout-utils';
import { uuid as genUUID } from '@/lib/uuid';
import { useUnit } from '@/context/UnitContext';
import { useCurrentWorkoutFull, useExercises, getAutoFillValues, getAllTimeBest1RM, getLastSessionSetsForExercise, getGoalWindowForWorkoutExercise } from '@/lib/useLocalDB';
import { recommendForExercise, type ExerciseRecommendation } from '@/lib/progression';
import { REP_WINDOWS, type RepWindow } from '@/lib/rep-windows';
import { usePlansFull } from '@/lib/useLocalDB-plans';
import type { LocalWorkoutExerciseEntry, LocalWorkoutWithExercises } from '@/lib/useLocalDB';
import { isNewEstimated1RM } from '@/lib/pr';
import type { LocalWorkoutSet } from '@/db/local';
import {
  startWorkout as mutStartWorkout,
  finishWorkout as mutFinishWorkout,
  deleteWorkout as mutDeleteWorkout,
  addExerciseToWorkout,
  removeExerciseFromWorkout,
  addSet as mutAddSet,
  updateSet as mutUpdateSet,
  deleteSet as mutDeleteSet,
  reorderExercises,
} from '@/lib/mutations';
import {
  DndContext,
  closestCenter,
  TouchSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import { apiBase } from '@/lib/api/client';

// ─── Settings (localStorage-backed) ──────────────────────────────────────────
function getRestSettings() {
  if (typeof window === 'undefined') return { defaultRest: 90, autoStart: true };
  return {
    defaultRest: parseInt(localStorage.getItem('rebirth-rest-default') ?? '90', 10),
    autoStart: localStorage.getItem('rebirth-rest-auto-start') !== 'false',
  };
}

function getKeepRestRunning(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('rebirth-rest-keep-running') === 'true';
}

// ─── Rest timer hook (background-safe) ───────────────────────────────────────
// Uses absolute endTime rather than elapsed ticks so the countdown stays
// accurate when the app is backgrounded or suspended by iOS.
// State is persisted to localStorage so it survives JS suspension.

const persistTimer = (endTime: number, duration: number) =>
  _persistTimer(localStorage, endTime, duration);
const clearPersistedTimer = () => _clearPersistedTimer(localStorage);
const readPersistedTimer = () => _readPersistedTimer(localStorage);

function useRestTimer() {
  const [selected, setSelected] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [overtime, setOvertime] = useState(0); // seconds past endTime (0 when still counting down)
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Absolute epoch ms when the timer expires — the source of truth
  const endTimeRef = useRef<number | null>(null);
  // Whether we've already crossed zero and are counting up.
  const overtimeStartedRef = useRef(false);
  // Guard so `notify()` fires exactly once per rest period (even if we stay
  // running in overtime for a while).
  const notifiedRef = useRef(false);

  const notify = useCallback(() => {
    // Vibrate (Android / Chrome — not supported on iOS)
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
    // Audio beep — works on iOS PWA when the page is active
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const playBeep = (startTime: number, freq: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.15);
        osc.start(startTime);
        osc.stop(startTime + 0.15);
      };
      playBeep(ctx.currentTime, 880);
      playBeep(ctx.currentTime + 0.2, 880);
      playBeep(ctx.currentTime + 0.4, 1100);
    } catch { /* AudioContext unavailable */ }
    // System notification (iOS 16.4+ PWA, Android, desktop)
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('Rest complete!', { body: 'Time to get back to work!' });
    }
  }, []);

  const stopInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startInterval = useCallback(() => {
    stopInterval();
    intervalRef.current = setInterval(() => {
      if (endTimeRef.current === null) return;
      const now = Date.now();
      const rem = computeRemaining(endTimeRef.current, now);
      if (rem <= 0) {
        // Fire notification once as we cross zero.
        if (!notifiedRef.current) {
          notifiedRef.current = true;
          setTimeout(notify, 0);
        }
        const keepRunning = getKeepRestRunning();
        if (keepRunning) {
          // Enter / stay in overtime mode — count UP past endTime.
          if (!overtimeStartedRef.current) {
            overtimeStartedRef.current = true;
            // Tell the Live Activity to switch to red count-up. Widget
            // renders autonomously from here; no per-tick updates needed.
            void updateRestActivity({ overtimeStart: endTimeRef.current });
          }
          const over = Math.floor((now - endTimeRef.current) / 1000);
          setRemaining(0);
          setOvertime(over);
        } else {
          stopInterval();
          endTimeRef.current = null;
          overtimeStartedRef.current = false;
          clearPersistedTimer();
          // Live Activity auto-dismisses at endDate, but call end() anyway in
          // case ActivityKit hasn't cleared it yet — belt & braces.
          void endRestActivity();
          setRunning(false);
          setRemaining(0);
          setOvertime(0);
        }
      } else {
        setRemaining(rem);
        setOvertime(0);
      }
    }, 500); // 500ms poll so display never lags more than half a second
  }, [notify, stopInterval]);

  const start = useCallback((seconds: number, context?: { exerciseName?: string; setNumber?: number }) => {
    const endTime = Date.now() + seconds * 1000;
    endTimeRef.current = endTime;
    overtimeStartedRef.current = false;
    notifiedRef.current = false;
    persistTimer(endTime, seconds);
    scheduleRestNotification(endTime);
    setSelected(seconds);
    setRemaining(seconds);
    setOvertime(0);
    setRunning(true);
    // Fire-and-forget native Live Activity — silent no-op on web / unsupported.
    void startRestActivity({
      endTime,
      duration: seconds,
      exerciseName: context?.exerciseName,
      setNumber: context?.setNumber,
    });
  }, []);

  const cancel = useCallback(() => {
    stopInterval();
    endTimeRef.current = null;
    overtimeStartedRef.current = false;
    notifiedRef.current = false;
    clearPersistedTimer();
    cancelRestNotification();
    void endRestActivity();
    setRunning(false);
    setSelected(null);
    setRemaining(0);
    setOvertime(0);
  }, [stopInterval]);

  const adjust = useCallback((delta: number) => {
    if (endTimeRef.current === null) return;
    endTimeRef.current = endTimeRef.current + delta * 1000;
    setSelected(prev => (prev !== null ? prev + delta : prev));
    const rem = computeRemaining(endTimeRef.current, Date.now());
    if (rem <= 0) {
      cancel();
    } else {
      setRemaining(rem);
      // Re-persist with updated endTime (keep original duration as reference)
      const saved = readPersistedTimer();
      persistTimer(endTimeRef.current, saved?.duration ?? rem);
      scheduleRestNotification(endTimeRef.current);
      void updateRestActivity({ endTime: endTimeRef.current });
    }
  }, [cancel]);

  // Start/stop the interval whenever `running` changes
  useEffect(() => {
    if (running) {
      startInterval();
    } else {
      stopInterval();
    }
    return stopInterval;
  }, [running, startInterval, stopInterval]);

  // Request OS notification permission on first mount
  useEffect(() => { requestNotificationPermission(); }, []);

  // Restore timer state on mount (in case page reloaded mid-timer)
  useEffect(() => {
    const saved = readPersistedTimer();
    if (!saved) return;
    const rem = Math.ceil((saved.endTime - Date.now()) / 1000);
    if (rem > 0) {
      endTimeRef.current = saved.endTime;
      setSelected(saved.duration);
      setRemaining(rem);
      setRunning(true);
    } else {
      clearPersistedTimer();
    }
  }, []);

  // Re-sync timer when the app returns to the foreground (Capacitor native)
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive || endTimeRef.current === null) return;
      const now = Date.now();
      const rem = computeRemaining(endTimeRef.current, now);
      if (rem <= 0) {
        // Timer expired while backgrounded — native notification already fired;
        // cancel it in case it's still pending.
        cancelRestNotification();
        if (!notifiedRef.current) {
          notifiedRef.current = true;
          notify();
        }
        const keepRunning = getKeepRestRunning();
        if (keepRunning) {
          // Re-enter overtime mode. Widget already switched via the tick
          // that ran before backgrounding, OR we need to switch now.
          if (!overtimeStartedRef.current) {
            overtimeStartedRef.current = true;
            void updateRestActivity({ overtimeStart: endTimeRef.current });
          }
          setRemaining(0);
          setOvertime(Math.floor((now - endTimeRef.current) / 1000));
        } else {
          endTimeRef.current = null;
          overtimeStartedRef.current = false;
          clearPersistedTimer();
          void endRestActivity();
          setRunning(false);
          setRemaining(0);
          setOvertime(0);
        }
      } else {
        setRemaining(rem);
        setOvertime(0);
      }
    }).then(handle => {
      cleanup = () => handle.remove();
    });
    return () => cleanup?.();
  }, [notify]);

  const progress = selected ? remaining / selected : 0;
  const isOvertime = overtime > 0;
  return { selected, remaining, overtime, isOvertime, running, progress, start, cancel, adjust };
}

// ─── Elapsed timer ───────────────────────────────────────────────────────────
function useElapsed(startTime: string | null) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startTime) return;
    const tick = () => setElapsed(Math.floor((Date.now() - new Date(startTime).getTime()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime]);
  return elapsed;
}

// ─── Running summary panel ────────────────────────────────────────────────────
function formatVolume(volumeKg: number, unit: string, toDisplay: (kg: number) => number): string {
  if (unit === 'kg') {
    return volumeKg >= 1000
      ? `${(volumeKg / 1000).toFixed(1)}t`
      : `${volumeKg.toFixed(0)}kg`;
  }
  const lbs = toDisplay(volumeKg);
  return `${Math.round(lbs).toLocaleString()}lbs`;
}

function WorkoutSummaryBar({
  elapsed,
  exercises,
  restTimer,
  onOpenRestTimer,
}: {
  elapsed: number;
  exercises: LocalWorkoutWithExercises['exercises'];
  restTimer: ReturnType<typeof useRestTimer>;
  onOpenRestTimer: () => void;
}) {
  const completedSets = calcCompletedSets(exercises);
  const timerActive = restTimer.running || (restTimer.selected !== null && restTimer.remaining === 0);
  const inOvertime = restTimer.isOvertime;
  const expired = restTimer.selected !== null && restTimer.remaining === 0 && !restTimer.running && !inOvertime;
  const red = inOvertime || expired;

  let timerLabel = '—';
  if (inOvertime) {
    timerLabel = `+${formatTime(restTimer.overtime)}`;
  } else if (timerActive) {
    timerLabel = formatTime(restTimer.remaining);
  }

  return (
    <div className="bg-background border-b border-border flex items-center justify-between px-3 py-2">
      <div className="flex flex-col items-center min-w-0">
        <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Time</span>
        <span className="text-sm font-mono font-semibold tabular-nums">{formatTime(elapsed)}</span>
      </div>
      <div className="w-px h-7 bg-border" />
      <div className="flex flex-col items-center min-w-0">
        <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Sets</span>
        <span className="text-sm font-semibold">{completedSets}</span>
      </div>
      <div className="w-px h-7 bg-border" />
      <div className="flex flex-col items-center min-w-0">
        <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Exercises</span>
        <span className="text-sm font-semibold">{exercises.length}</span>
      </div>
      <div className="w-px h-7 bg-border" />
      {/* Rest timer column — always present, tappable */}
      <button onClick={onOpenRestTimer} className="flex flex-col items-center min-w-0">
        <span className={`text-[10px] font-medium uppercase tracking-wide ${
          red ? 'text-red-500' : timerActive ? 'text-primary' : 'text-muted-foreground'
        }`}>
          {inOvertime ? 'Over' : 'Rest'}
        </span>
        <span className={`text-sm font-mono font-semibold tabular-nums ${
          red ? 'text-red-500' : timerActive ? 'text-primary' : 'text-muted-foreground'
        }`}>
          {timerLabel}
        </span>
      </button>
    </div>
  );
}

// ─── Finish confirmation modal ────────────────────────────────────────────────
function FinishWorkoutModal({
  elapsed,
  exercises,
  onConfirm,
  onCancel,
}: {
  elapsed: number;
  exercises: LocalWorkoutWithExercises['exercises'];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { unit, toDisplay } = useUnit();
  const completedSets = calcCompletedSets(exercises);
  const totalVolume = calcTotalVolume(exercises);
  const exerciseCount = exercises.length;

  // Per-exercise goal_window resolution — needed so the recommendation rule
  // takes the window-aware path. Falls back to legacy set-level min/max
  // when an exercise has no goal_window assigned.
  const [goalWindowByExercise, setGoalWindowByExercise] = useState<Map<string, RepWindow | null>>(new Map());
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      exercises.map(we =>
        getGoalWindowForWorkoutExercise(we.workout_uuid, we.exercise_uuid).then(w => [we.exercise_uuid, w] as const),
      ),
    ).then(pairs => {
      if (!cancelled) setGoalWindowByExercise(new Map(pairs));
    });
    return () => { cancelled = true; };
  }, [exercises]);

  // Per-exercise recommendation for the next session — computed against this
  // session's just-logged sets so the cue is locked in before the user closes
  // the modal. Mirrors the inline badge on the next session's exercise card.
  const nextSessionRecs = exercises
    .map(we => {
      const mode = we.exercise?.tracking_mode ?? 'reps';
      const goalWindow = goalWindowByExercise.get(we.exercise_uuid) ?? null;
      const rec = recommendForExercise(we.sets, mode, goalWindow);
      return rec ? { title: we.exercise?.title ?? '', rec } : null;
    })
    .filter((x): x is { title: string; rec: ExerciseRecommendation } => x != null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Card */}
      <div className="relative w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 text-center border-b border-zinc-800">
          <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
            <Check className="h-6 w-6 text-green-500" strokeWidth={2.5} />
          </div>
          <h2 className="text-lg font-bold text-zinc-100">Finish Workout?</h2>
          <p className="text-sm text-zinc-400 mt-1">Are you sure you want to finish this workout?</p>
        </div>

        {/* Summary stats */}
        <div className="px-6 py-4 grid grid-cols-2 gap-3">
          <div className="bg-zinc-800/60 rounded-xl p-3 text-center">
            <p className="text-xs text-zinc-400 mb-0.5">Duration</p>
            <p className="text-base font-semibold text-zinc-100 tabular-nums font-mono">{formatTime(elapsed)}</p>
          </div>
          <div className="bg-zinc-800/60 rounded-xl p-3 text-center">
            <p className="text-xs text-zinc-400 mb-0.5">Exercises</p>
            <p className="text-base font-semibold text-zinc-100">{exerciseCount}</p>
          </div>
          <div className="bg-zinc-800/60 rounded-xl p-3 text-center">
            <p className="text-xs text-zinc-400 mb-0.5">Sets Completed</p>
            <p className="text-base font-semibold text-zinc-100">{completedSets}</p>
          </div>
          <div className="bg-zinc-800/60 rounded-xl p-3 text-center">
            <p className="text-xs text-zinc-400 mb-0.5">Total Volume</p>
            <p className="text-base font-semibold text-zinc-100">
              {formatVolume(totalVolume, unit, toDisplay)}
            </p>
          </div>
        </div>

        {/* Next session — per-exercise progression cues. Hidden when no sets
            had enough signal to produce a recommendation. */}
        {nextSessionRecs.length > 0 && (
          <div className="px-6 pb-4">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500 font-medium mb-2">
              Next Session
            </p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {nextSessionRecs.map(({ title, rec }, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-zinc-200 truncate flex-1 min-w-0">{title}</span>
                  <RecommendationBadge rec={rec} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-6 pb-6 flex flex-col gap-2">
          <button
            onClick={onConfirm}
            className="w-full h-12 rounded-xl bg-green-500 hover:bg-green-600 text-white font-semibold text-sm transition-colors"
          >
            Finish Workout
          </button>
          <button
            onClick={onCancel}
            className="w-full h-12 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold text-sm transition-colors"
          >
            Keep Going
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Rest timer sheet ─────────────────────────────────────────────────────────
const REST_PRESETS = [60, 90, 120, 150, 180, 30];

function RestTimerSheet({
  selected,
  remaining,
  overtime,
  isOvertime,
  running,
  progress,
  onStart,
  onCancel,
  onAdjust,
  onClose,
}: {
  selected: number | null;
  remaining: number;
  overtime: number;
  isOvertime: boolean;
  running: boolean;
  progress: number;
  onStart: (seconds: number) => void;
  onCancel: () => void;
  onAdjust: (delta: number) => void;
  onClose: () => void;
}) {
  const circumference = 2 * Math.PI * 100;
  // In overtime the ring is fully drawn and red; in countdown it shrinks.
  const dashOffset = isOvertime ? 0 : circumference * (1 - progress);
  const expired = selected !== null && remaining === 0 && !running && !isOvertime;
  const red = isOvertime || expired;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-safe-plus pb-3 border-b border-border">
        <button onClick={onClose} className="text-primary font-medium text-base">Close</button>
        <h2 className="font-semibold">Rest Timer</h2>
        <div className="w-14" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-8 p-8">
        {!running && !expired && !isOvertime ? (
          <>
            <p className="text-muted-foreground text-sm">Select a rest duration</p>
            <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
              {REST_PRESETS.map(s => (
                <button
                  key={s}
                  onClick={() => onStart(s)}
                  className="aspect-square rounded-full bg-secondary flex items-center justify-center text-base font-semibold"
                >
                  {formatTime(s)}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Progress ring */}
            <div className="relative w-60 h-60">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 240 240">
                <circle cx="120" cy="120" r="100" fill="none" stroke="hsl(var(--secondary))" strokeWidth="12" />
                <circle
                  cx="120" cy="120" r="100" fill="none"
                  stroke={red ? '#ef4444' : 'hsl(var(--primary))'}
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  style={{ transition: running ? 'stroke-dashoffset 1s linear' : 'none' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-5xl font-light tabular-nums ${red ? 'text-red-500' : ''}`}>
                  {isOvertime ? `+${formatTime(overtime)}` : formatTime(remaining)}
                </span>
                <span className="text-sm text-muted-foreground mt-1">{formatTime(selected ?? 0)}</span>
                {isOvertime && (
                  <span className="text-sm text-red-400 font-medium mt-2">Over rest</span>
                )}
                {expired && (
                  <span className="text-sm text-red-400 font-medium mt-2">Rest over!</span>
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="flex gap-4">
              <button
                onClick={() => onAdjust(-10)}
                className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center font-semibold text-sm"
              >
                −10s
              </button>
              <button
                onClick={() => onAdjust(10)}
                className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center font-semibold text-sm"
              >
                +10s
              </button>
              <button
                onClick={onCancel}
                className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center font-semibold text-sm"
              >
                Cancel
              </button>
            </div>

            {/* Restart with presets when expired */}
            {expired && (
              <div className="flex gap-3">
                {REST_PRESETS.slice(0, 4).map(s => (
                  <button
                    key={s}
                    onClick={() => onStart(s)}
                    className="px-3 py-2 rounded-xl bg-secondary text-sm font-semibold"
                  >
                    {formatTime(s)}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Muscle group colour map ──────────────────────────────────────────────────
const MUSCLE_BADGE_COLORS: Record<string, string> = {
  chest: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  back: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  shoulders: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  arms: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  legs: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  abdominals: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
};

function getMuscleChipClass(muscle: string): string {
  const key = muscle.toLowerCase();
  for (const [k, v] of Object.entries(MUSCLE_BADGE_COLORS)) {
    if (key.includes(k)) return v;
  }
  return 'bg-zinc-700/60 text-zinc-300 border-zinc-600/50';
}

const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'arms', 'legs', 'abdominals'];

// ─── Exercise selector sheet (offline-first) ──────────────────────────────────
function AddExerciseSheet({
  onAdd,
  onClose,
}: {
  onAdd: (exercise: Exercise) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);

  // Reads from local IndexedDB — works fully offline
  const exercises = useExercises({
    search: search || undefined,
    muscleGroup: selectedMuscle ?? undefined,
  });

  // Group by primary muscle (only when no muscle filter active)
  const grouped: Record<string, typeof exercises> = {};
  for (const ex of exercises) {
    const muscle = ex.primary_muscles[0] ?? 'Other';
    if (!grouped[muscle]) grouped[muscle] = [];
    grouped[muscle].push(ex);
  }
  const groups = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-safe-plus pb-3 border-b border-border">
        <button onClick={onClose} className="text-primary font-medium text-base min-h-[44px] flex items-center">Cancel</button>
        <h2 className="font-semibold">Add Exercise</h2>
        <div className="w-14" />
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            type="text"
            placeholder="Search exercises"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-secondary rounded-lg text-sm outline-none min-h-[44px]"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Muscle group filter chips */}
      <div className="px-4 py-2 border-b border-border overflow-x-auto">
        <div className="flex gap-2 w-max">
          <button
            onClick={() => setSelectedMuscle(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap min-h-[36px] ${
              selectedMuscle === null
                ? 'bg-blue-500 text-white border-blue-500'
                : 'bg-zinc-800/60 text-zinc-300 border-zinc-700 hover:border-zinc-500'
            }`}
          >
            All
          </button>
          {MUSCLE_GROUPS.map(muscle => (
            <button
              key={muscle}
              onClick={() => setSelectedMuscle(selectedMuscle === muscle ? null : muscle)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors capitalize whitespace-nowrap min-h-[36px] ${
                selectedMuscle === muscle
                  ? 'bg-blue-500 text-white border-blue-500'
                  : `${getMuscleChipClass(muscle)} hover:opacity-80`
              }`}
            >
              {muscle}
            </button>
          ))}
        </div>
      </div>

      {/* Exercise list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
        {groups.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground text-sm">No exercises found</p>
        ) : (
          groups.map(([muscle, exs]) => (
            <div key={muscle}>
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 capitalize px-1">{muscle}</p>
              <div className="ios-section">
                {exs.map((ex) => (
                  <button
                    key={ex.uuid}
                    onClick={() => onAdd(ex as unknown as Exercise)}
                    className="ios-row w-full text-left min-h-[56px]"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{ex.title}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {ex.primary_muscles.slice(0, 2).map(m => (
                          <span
                            key={m}
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize ${getMuscleChipClass(m)}`}
                          >
                            {m}
                          </span>
                        ))}
                        {ex.secondary_muscles.slice(0, 1).map(m => (
                          <span
                            key={m}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-zinc-800/40 text-zinc-400 border-zinc-700/50 capitalize"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Set row ──────────────────────────────────────────────────────────────────
// Window pill — the GOAL (permanent label, where this exercise lives on the
// strength↔endurance spectrum). Trans-flag-mapped: extreme windows (Strength,
// Endurance) get solid backgrounds; middle windows get soft tinted pills.
// Distinct visual weight from RecommendationBadge so they read as different
// kinds of information when shown side-by-side.
const WINDOW_STYLE: Record<RepWindow, string> = {
  strength:  'bg-sky-400 text-white',                  // solid trans-blue
  power:     'bg-sky-500/15 text-sky-300',             // soft blue
  build:     'bg-purple-500/15 text-purple-300',       // soft purple (the bridge)
  pump:      'bg-pink-500/15 text-pink-300',           // soft trans-pink
  endurance: 'bg-pink-400 text-white',                 // solid trans-pink (catch only)
};

function WindowPill({ window: win }: { window: RepWindow }) {
  const w = REP_WINDOWS[win];
  return (
    <span
      className={
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums '
        + WINDOW_STYLE[win]
      }
      title={`Goal: ${w.label} (${w.min}–${w.max} reps)`}
    >
      <span>{w.label}</span>
      <span className="opacity-60">{w.min}–{w.max}</span>
    </span>
  );
}

// Inline recommendation pill — shown on the exercise card next session and in
// the finish-workout summary. Color tracks intensity (red = high, amber = medium
// push, blue = back off, muted = hold).
function RecommendationBadge({ rec }: { rec: ExerciseRecommendation }) {
  const Icon =
    rec.kind === 'back-off'
      ? ChevronDown
      : rec.kind === 'hold'
        ? Equal
        : rec.intensity === 'high'
          ? ChevronsUp
          : ChevronUp;
  // Trans-mapped palette — solid bg + white text so the badge reads as ACTION
  // against the soft tinted window pills (the GOAL). Same hue family across
  // both surfaces, different intensity. more-reps uses purple (the build-zone
  // bridge color); go-heavier/go-longer use pink (warm = push hard); back-off
  // uses sky blue (cool = retreat); hold stays muted.
  const color =
    rec.kind === 'back-off'
      ? 'bg-sky-500 text-white'
      : rec.kind === 'hold'
        ? 'bg-secondary text-muted-foreground'
        : rec.kind === 'more-reps'
          ? 'bg-purple-500 text-white'
          : rec.intensity === 'high'
            ? 'bg-pink-500 text-white'
            : 'bg-pink-400 text-white';
  return (
    <span
      className={
        'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium '
        + color
      }
      title={`Next time: ${rec.label}`}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      <span>{rec.label}</span>
    </span>
  );
}

// RIR fallback when no prior session exists. RIR 2 (≈ 2 reps in reserve) is a
// reasonable mid-difficulty assumption that the slider lets the user adjust.
const RIR_DEFAULT_FALLBACK = 2;
const RIR_PX_PER_STEP = 16;

// Press-and-hold slider for capturing Reps in Reserve (0–5). Vertical drag:
// up = +1, down = -1, clamped 0–5. The pointer is captured on press so the
// drag survives even if the finger leaves the pill bounds. Live value is
// rendered from `dragValue` during the gesture; we only commit (call onChange)
// on pointerup, which avoids spamming Dexie writes mid-drag and mirrors how
// native sliders settle.
function RirSlider({
  value,
  defaultValue,
  onChange,
}: {
  value: number | null;
  defaultValue: number;
  onChange: (rir: number) => Promise<void>;
}) {
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const startY = useRef(0);
  const startVal = useRef(0);

  const display = dragValue ?? value ?? defaultValue;
  const isExplicit = value != null || dragValue != null;

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    startVal.current = value ?? defaultValue;
    setDragValue(startVal.current);
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    const dy = startY.current - e.clientY;
    const steps = Math.round(dy / RIR_PX_PER_STEP);
    const next = Math.max(0, Math.min(5, startVal.current + steps));
    setDragValue(next);
  };

  const finish = async (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    const target = e.currentTarget;
    try { target.releasePointerCapture(e.pointerId); } catch {}
    const finalVal = dragValue ?? value ?? defaultValue;
    setDragging(false);
    setDragValue(null);
    if (finalVal !== value) {
      await onChange(finalVal);
    }
  };

  const onKeyDown = async (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const cur = value ?? defaultValue;
    const next = Math.max(0, Math.min(5, cur + (e.key === 'ArrowUp' ? 1 : -1)));
    if (next !== value) await onChange(next);
  };

  const stopTouch = (e: React.TouchEvent) => e.stopPropagation();

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onTouchStart={stopTouch}
      onTouchMove={stopTouch}
      onTouchEnd={stopTouch}
      onKeyDown={onKeyDown}
      aria-label={`RIR ${display}, hold and slide up or down to change`}
      className={
        'flex-shrink-0 h-7 px-2.5 rounded-full text-[11px] flex items-center gap-1.5 select-none touch-none transition-all ' +
        (dragging
          ? 'bg-primary text-primary-foreground scale-110 ring-2 ring-primary/30'
          : isExplicit
            ? 'bg-primary/15 text-primary'
            : 'bg-secondary text-muted-foreground')
      }
    >
      <span className="text-[9px] tracking-wide uppercase opacity-70">RIR</span>
      <span className="font-bold tabular-nums text-sm leading-none w-3 text-center">{display}</span>
    </button>
  );
}

// ─── RPE chip strip (time-mode rows only) ─────────────────────────────────────
//
// Time-mode exercises (planks, holds, isometrics) collect RPE 1-10 as the
// proximity-to-failure proxy — RIR doesn't translate cleanly to a hold.
// The server bridges RPE → RIR (rir = clamp(10 - rpe, 0, 5)) on sync push
// so the existing RIR-weighted effective_set_count math at queries.ts:1367
// continues to credit time-mode sets. Single source of truth: client only
// writes `rpe`; the rir column is server-derived for time-mode rows.
//
// Anchor copy under chips 6-10 (where RPE meaning matters for the bridge).
// 6 easy / 7 mod / 8 hard / 9 near / 10 fail.

function RpeChipStrip({
  value,
  legacyRirFallback,
  onChange,
}: {
  value: number | null;
  legacyRirFallback: number | null;
  onChange: (rpe: number | null) => Promise<void>;
}) {
  // Display-only fallback for legacy time-mode rows that have rir but no rpe.
  // Reverse-bridge gives Lou a starting point without writing until they
  // actually pick a chip. Once they pick, the row commits and the legacy
  // rir gets server-overwritten on next sync push.
  const displayValue = value ?? (legacyRirFallback != null ? Math.max(1, Math.min(10, 10 - legacyRirFallback)) : null);
  const isLegacy = value == null && legacyRirFallback != null;

  const anchors: Record<number, string> = {
    6: 'easy',
    7: 'mod',
    8: 'hard',
    9: 'near',
    10: 'fail',
  };

  return (
    <div className="px-3 pt-1 pb-2 -mt-1 border-b border-border last:border-0">
      <div className="flex items-center gap-1 justify-between" role="radiogroup" aria-label="RPE 1 to 10">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => {
          const selected = displayValue === n;
          const muted = isLegacy && selected;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`RPE ${n}${anchors[n] ? ' (' + anchors[n] + ')' : ''}`}
              onClick={() => { void onChange(n); }}
              className={
                'flex-1 h-7 rounded-md text-xs font-semibold tabular-nums transition-all min-w-0 ' +
                (selected
                  ? muted
                    ? 'bg-primary/30 text-primary-foreground/70 ring-1 ring-primary/40'
                    : 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground active:bg-secondary/70')
              }
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1 justify-between mt-0.5 px-px">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
          <span
            key={n}
            className="flex-1 text-center text-[8px] uppercase tracking-wide text-muted-foreground/60 select-none"
          >
            {anchors[n] ?? ''}
          </span>
        ))}
      </div>
      {isLegacy && (
        <p className="text-[10px] text-muted-foreground/70 mt-1 text-center">
          Legacy RIR — tap to confirm RPE
        </p>
      )}
    </div>
  );
}

// ─── SetRow ───────────────────────────────────────────────────────────────────

function SetRow({
  setNumber,
  set,
  workoutExerciseUuid,
  trackingMode,
  hasSides,
  onUpdate,
  onUpdateDuration,
  onEdit,
  onEditDuration,
  onUpdateRir,
  onUpdateRpe,
  onOpenStopwatch,
  onDelete,
  allTimeBest1RM,
  previousRir,
  stopwatchRunning,
  stopwatchElapsed,
}: {
  setNumber: number;
  set: LocalWorkoutSet;
  workoutExerciseUuid: string;
  trackingMode: 'reps' | 'time';
  hasSides: boolean;
  onUpdate: (weUuid: string, setUuid: string, weight: number, reps: number) => Promise<void>;
  onUpdateDuration: (weUuid: string, setUuid: string, weight: number, durationSeconds: number) => Promise<void>;
  onEdit: (weUuid: string, setUuid: string, weight: number, reps: number) => Promise<void>;
  onEditDuration: (weUuid: string, setUuid: string, weight: number, durationSeconds: number) => Promise<void>;
  onUpdateRir: (setUuid: string, rir: number | null) => Promise<void>;
  onUpdateRpe: (setUuid: string, rpe: number | null) => Promise<void>;
  onOpenStopwatch: (setRowKey: string, hasSides: boolean, replacingSeconds: number | null) => void;
  onDelete: (setUuid: string) => Promise<void>;
  allTimeBest1RM?: number | null;
  previousRir?: number | null;
  stopwatchRunning?: boolean;
  stopwatchElapsed?: number;
}) {
  const { toDisplay, fromInput, label } = useUnit();
  const [weight, setWeight] = useState(
    set.weight != null ? toDisplay(set.weight).toString() : ''
  );
  const [reps, setReps] = useState(set.repetitions?.toString() ?? '');
  const [duration, setDuration] = useState(
    set.duration_seconds != null ? String(set.duration_seconds) : ''
  );
  const [saving, setSaving] = useState(false);

  // Live PD detection — compare current estimated 1RM against all-time best.
  // No is_completed guard: badge persists naturally after completion since
  // weight/reps values don't change once the set is ticked off. Only meaningful
  // for rep-mode; time-mode uses isNewLongestHold checked elsewhere.
  const currentWeightKg = fromInput(parseFloat(weight) || 0);
  const currentReps = parseInt(reps) || 0;
  const isLivePD = trackingMode === 'reps'
    && allTimeBest1RM != null
    && isNewEstimated1RM(currentWeightKg, currentReps, allTimeBest1RM);

  const rirDefault = previousRir ?? RIR_DEFAULT_FALLBACK;

  const handleComplete = async () => {
    setSaving(true);
    const wasCompleted = set.is_completed;
    const weightKg = fromInput(parseFloat(weight) || 0);
    if (trackingMode === 'time') {
      const seconds = parseInt(duration) || 0;
      await onUpdateDuration(workoutExerciseUuid, set.uuid, weightKg, seconds);
    } else {
      await onUpdate(workoutExerciseUuid, set.uuid, weightKg, parseInt(reps) || 0);
    }
    // First-completion auto-fill: write the previous-session RIR for this set
    // position (or RIR_DEFAULT_FALLBACK) so a single tap captures completion +
    // a sensible RIR. The inline slider lets the user adjust without a second
    // tap-to-open step.
    //
    // Time-mode SKIPS the auto-fill: RPE is not auto-defaulted to keep the
    // server-side RIR bridge accurate (a fake RPE would silently credit
    // hypertrophy junk-set math). User must pick a chip explicitly.
    if (!wasCompleted && set.rir == null && trackingMode === 'reps') {
      await onUpdateRir(set.uuid, rirDefault);
    }
    setSaving(false);
  };

  const completed = set.is_completed;

  // Persist edits to weight/reps/duration after a set is already completed.
  // Without this, the inputs stay editable but changes never reach Dexie/sync,
  // so the next session pulls the stale values.
  const handleRepsBlur = async () => {
    if (!completed || trackingMode !== 'reps') return;
    const weightKg = fromInput(parseFloat(weight) || 0);
    const repsInt = parseInt(reps) || 0;
    if (weightKg === (set.weight ?? 0) && repsInt === (set.repetitions ?? 0)) return;
    await onEdit(workoutExerciseUuid, set.uuid, weightKg, repsInt);
  };

  const handleTimeBlur = async () => {
    if (!completed || trackingMode !== 'time') return;
    const weightKg = fromInput(parseFloat(weight) || 0);
    const seconds = parseInt(duration) || 0;
    if (weightKg === (set.weight ?? 0) && seconds === (set.duration_seconds ?? 0)) return;
    await onEditDuration(workoutExerciseUuid, set.uuid, weightKg, seconds);
  };
  const isPR = set.is_pr;
  const showPD = isPR || isLivePD;

  const repsPlaceholder = (() => {
    const min = set.min_target_reps;
    const max = set.max_target_reps;
    if (min != null && max != null) return min === max ? `${min}` : `${min}–${max}`;
    if (min != null) return `${min}`;
    if (max != null) return `${max}`;
    return '—';
  })();

  // Each set row packs weight + reps/time on the left so the freed area on
  // the right can host the RIR slider once the set is ticked. Pre-completion
  // that area is empty — the row stays uncluttered while the user is still
  // entering numbers.
  //
  // Time-mode adds a Timer icon button next to the duration input that opens
  // the stopwatch sheet, and replaces the RIR slider with a full-width RPE
  // chip strip on its own row below the inputs (10 chips don't fit beside
  // the inputs on a 375px iPhone). When the stopwatch is running for THIS
  // set, the duration value is replaced by a live mm:ss readout.
  const stopwatchActive = !!stopwatchRunning;
  const liveSeconds = stopwatchActive ? (stopwatchElapsed ?? 0) : null;

  const inner = (
    <div className={`flex flex-col border-b border-border last:border-0 ${completed ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 py-1.5 px-3">
        <div className="w-5 text-center text-xs font-semibold text-muted-foreground">{setNumber}</div>

        {trackingMode === 'time' ? (
          <>
            <div className="flex items-center gap-1 flex-shrink-0">
              <input
                type="number"
                inputMode="decimal"
                placeholder="—"
                value={weight}
                onChange={e => setWeight(e.target.value)}
                onFocus={e => { e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }); e.target.select(); }}
                onBlur={handleTimeBlur}
                className="w-12 text-left text-sm font-medium bg-transparent outline-none min-h-[36px]"
              />
              <span className="text-[10px] text-muted-foreground">{label}</span>
            </div>

            <span className="text-muted-foreground text-xs">×</span>

            <div className="flex items-center gap-1 flex-shrink-0">
              {stopwatchActive ? (
                <span
                  className="w-12 text-left text-sm font-medium tabular-nums text-primary min-h-[36px] flex items-center"
                  aria-label="Stopwatch running"
                >
                  {formatTime(liveSeconds ?? 0)}
                </span>
              ) : (
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="60"
                  value={duration}
                  onChange={e => setDuration(e.target.value)}
                  onFocus={e => { e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }); e.target.select(); }}
                  onBlur={handleTimeBlur}
                  className="w-12 text-left text-sm font-medium bg-transparent outline-none min-h-[36px]"
                />
              )}
              <span className="text-[10px] text-muted-foreground">sec</span>
            </div>

            <button
              type="button"
              onClick={() => {
                const setRowKey = `${workoutExerciseUuid}:${set.uuid}`;
                const replacing = set.duration_seconds && set.duration_seconds > 0
                  ? set.duration_seconds : null;
                onOpenStopwatch(setRowKey, hasSides, replacing);
              }}
              className={
                'flex-shrink-0 w-9 h-9 min-w-[44px] min-h-[44px] -mx-1 rounded-full flex items-center justify-center ' +
                (stopwatchActive
                  ? 'text-primary'
                  : 'text-muted-foreground bg-zinc-800/40 ring-1 ring-zinc-700/60 active:bg-zinc-700/60')
              }
              aria-label={stopwatchActive ? 'Stopwatch running — tap to open' : 'Open stopwatch'}
            >
              <Timer className={'h-4 w-4 ' + (stopwatchActive ? 'animate-pulse motion-reduce:animate-none' : '')} />
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1 flex-shrink-0">
              <input
                type="number"
                inputMode="decimal"
                placeholder="—"
                value={weight}
                onChange={e => setWeight(e.target.value)}
                onFocus={e => { e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }); e.target.select(); }}
                onBlur={handleRepsBlur}
                className="w-12 text-left text-sm font-medium bg-transparent outline-none min-h-[36px]"
              />
              <span className="text-[10px] text-muted-foreground">{label}</span>
            </div>

            <span className="text-muted-foreground text-xs">×</span>

            <div className="flex items-center gap-1 flex-shrink-0">
              <input
                id="m-workout-set-reps"
                type="number"
                inputMode="numeric"
                placeholder={repsPlaceholder}
                value={reps}
                onChange={e => setReps(e.target.value)}
                onFocus={e => { e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }); e.target.select(); }}
                onBlur={handleRepsBlur}
                className="w-12 text-left text-sm font-medium bg-transparent outline-none min-h-[36px]"
              />
              <span className="text-[10px] text-muted-foreground">reps</span>
            </div>
          </>
        )}

        <div className="flex-1 flex items-center justify-end">
          {completed && trackingMode === 'reps' && (
            <RirSlider
              value={set.rir ?? null}
              defaultValue={rirDefault}
              onChange={(n) => onUpdateRir(set.uuid, n)}
            />
          )}
        </div>

        <div className="relative flex-shrink-0">
          <button
            onClick={handleComplete}
            disabled={saving}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              completed
                ? 'bg-green-500 text-white'
                : 'border-2 border-border text-transparent hover:border-primary'
            }`}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          {showPD && (
            <span className="absolute -top-1.5 -right-1.5 text-[8px] font-bold px-0.5 leading-[14px] rounded-full text-amber-400 bg-amber-400/15 border border-amber-400/30 pointer-events-none">
              PR
            </span>
          )}
        </div>
      </div>

      {completed && trackingMode === 'time' && (
        <RpeChipStrip
          value={set.rpe ?? null}
          legacyRirFallback={set.rir ?? null}
          onChange={(rpe) => onUpdateRpe(set.uuid, rpe)}
        />
      )}
    </div>
  );

  return (
    <SwipeToDelete onDelete={() => onDelete(set.uuid)}>
      {inner}
    </SwipeToDelete>
  );
}

interface RoutineExerciseWithSets extends WorkoutRoutineExercise {
  sets: WorkoutRoutineSet[];
}

interface RoutineWithExercises extends WorkoutRoutine {
  exercises: RoutineExerciseWithSets[];
}

interface PlanWithRoutines extends WorkoutPlan {
  routines: RoutineWithExercises[];
}

// ─── Sortable exercise card ─────────────────────────────────────────────────

function SortableExerciseCard({
  we,
  isExpanded,
  onToggle,
  onRemove,
  onAddSet,
  onUpdateSet,
  onUpdateSetDuration,
  onEditSet,
  onEditSetDuration,
  onUpdateSetRir,
  onUpdateSetRpe,
  onDeleteSet,
  onShowInfo,
  onOpenStopwatch,
  stopwatchSetKey,
  stopwatchElapsed,
}: {
  we: LocalWorkoutExerciseEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onAddSet: () => void;
  onUpdateSet: (workoutExerciseUuid: string, setUuid: string, weight: number, reps: number) => Promise<void>;
  onUpdateSetDuration: (workoutExerciseUuid: string, setUuid: string, weight: number, durationSeconds: number) => Promise<void>;
  onEditSet: (workoutExerciseUuid: string, setUuid: string, weight: number, reps: number) => Promise<void>;
  onEditSetDuration: (workoutExerciseUuid: string, setUuid: string, weight: number, durationSeconds: number) => Promise<void>;
  onUpdateSetRir: (setUuid: string, rir: number | null) => Promise<void>;
  onUpdateSetRpe: (setUuid: string, rpe: number | null) => Promise<void>;
  onDeleteSet: (uuid: string) => Promise<void>;
  onShowInfo: () => void;
  onOpenStopwatch: (setRowKey: string, hasSides: boolean, replacingSeconds: number | null) => void;
  stopwatchSetKey: string | null;
  stopwatchElapsed: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: we.uuid });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const completedSets = we.sets.filter(s => s.is_completed).length;
  const totalSets = we.sets.length;
  const allDone = totalSets > 0 && completedSets === totalSets;

  const [allTimeBest1RM, setAllTimeBest1RM] = useState<number>(0);
  useEffect(() => {
    getAllTimeBest1RM(we.exercise_uuid, we.workout_uuid).then(setAllTimeBest1RM);
  }, [we.exercise_uuid, we.workout_uuid]);

  // Goal window pulled from the source routine_exercise. Null if the workout
  // wasn't started from a routine (empty workout) or the exercise isn't on it.
  const [goalWindow, setGoalWindow] = useState<RepWindow | null>(null);
  useEffect(() => {
    let cancelled = false;
    getGoalWindowForWorkoutExercise(we.workout_uuid, we.exercise_uuid).then(w => {
      if (!cancelled) setGoalWindow(w);
    });
    return () => { cancelled = true; };
  }, [we.workout_uuid, we.exercise_uuid]);

  // Last session's sets for this exercise (canonical-key matched). Used both
  // for the progression cue and to seed RIR defaults per set position so the
  // slider opens at the user's previous answer rather than asking from zero.
  const [prevSets, setPrevSets] = useState<LocalWorkoutSet[]>([]);
  useEffect(() => {
    let cancelled = false;
    getLastSessionSetsForExercise(we.exercise_uuid, we.workout_uuid).then(s => {
      if (!cancelled) setPrevSets(s);
    });
    return () => { cancelled = true; };
  }, [we.exercise_uuid, we.workout_uuid]);

  const recommendation = useMemo<ExerciseRecommendation | null>(() => {
    const mode = we.exercise?.tracking_mode ?? 'reps';
    return recommendForExercise(prevSets, mode, goalWindow);
  }, [prevSets, we.exercise?.tracking_mode, goalWindow]);

  const previousRirs = useMemo<(number | null)[]>(
    () => prevSets.map(s => s.rir ?? null),
    [prevSets],
  );

  return (
    <div ref={setNodeRef} style={style} className="ios-section">
      {/* Exercise header — swipe to delete */}
      <SwipeToDelete onDelete={onRemove}>
        <div className="flex items-center w-full min-h-[44px]">
          <div
            className="flex items-center justify-center px-1 py-2.5 touch-none cursor-grab active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4 text-muted-foreground/50" />
          </div>
          <button
            onClick={onToggle}
            className="flex items-center gap-2 px-2 py-2.5 flex-1 text-left"
          >
            {isExpanded
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            }
            <span className="flex-1 min-w-0">
              <span className={`block font-semibold text-sm truncate ${allDone ? 'text-muted-foreground' : ''}`}>
                {we.exercise?.title ?? ''}
              </span>
              {(goalWindow || recommendation || we.comment) && (
                <span className="flex items-center gap-1.5 mt-0.5 min-w-0 flex-wrap">
                  {goalWindow && <WindowPill window={goalWindow} />}
                  {recommendation && !allDone && <RecommendationBadge rec={recommendation} />}
                  {we.comment && (
                    <span className="text-xs text-muted-foreground italic truncate">{we.comment}</span>
                  )}
                </span>
              )}
            </span>
            {allDone ? (
              <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                <Check className="h-3 w-3 text-white" strokeWidth={3} />
              </div>
            ) : (
              <span className="text-xs text-muted-foreground flex-shrink-0 pr-1">
                {completedSets}/{totalSets}
              </span>
            )}
          </button>
          {/* Info button — opens the exercise detail modal as a sibling overlay
              so the underlying workout state (rest timer, scroll, expanded
              sets) is preserved. stopPropagation prevents the chevron toggle
              and swipe-to-delete from firing on the same tap. */}
          <button
            onClick={(e) => { e.stopPropagation(); onShowInfo(); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="px-2 py-2.5 text-muted-foreground hover:text-foreground flex-shrink-0"
            aria-label={`Show details for ${we.exercise?.title ?? 'exercise'}`}
          >
            <Info className="h-4 w-4" />
          </button>
        </div>
      </SwipeToDelete>

      {/* Collapsible sets */}
      {isExpanded && (
        <>
          {/* Column headers — mirrors SetRow layout exactly. Time-mode uses
              the same Weight × ? layout as reps so loaded holds (weighted
              planks, dips, carries) capture both dimensions. */}
          <div className="flex items-center gap-2 px-3 py-1 border-t border-b border-border bg-secondary/30">
            <div className="w-5 text-center text-[10px] font-medium text-muted-foreground">Set</div>
            <div className="text-left text-[10px] font-medium text-muted-foreground flex-shrink-0" style={{ width: '4rem' }}>Weight</div>
            <span className="text-xs invisible">×</span>
            <div className="text-left text-[10px] font-medium text-muted-foreground flex-shrink-0" style={{ width: '4rem' }}>
              {(we.exercise?.tracking_mode ?? 'reps') === 'time' ? 'Time (sec)' : 'Reps'}
            </div>
            <div className="flex-1 text-right text-[10px] font-medium text-muted-foreground pr-1">RIR</div>
            <div className="w-8 flex-shrink-0" />
          </div>

          {/* Sets */}
          {we.sets.map((set, idx) => {
            const setRowKey = `${we.uuid}:${set.uuid}`;
            const stopwatchRunning = stopwatchSetKey === setRowKey;
            return (
              <SetRow
                key={set.uuid}
                setNumber={idx + 1}
                set={set}
                workoutExerciseUuid={we.uuid}
                trackingMode={we.exercise?.tracking_mode ?? 'reps'}
                hasSides={Boolean(we.exercise?.has_sides)}
                onUpdate={onUpdateSet}
                onUpdateDuration={onUpdateSetDuration}
                onEdit={onEditSet}
                onEditDuration={onEditSetDuration}
                onUpdateRir={onUpdateSetRir}
                onUpdateRpe={onUpdateSetRpe}
                onOpenStopwatch={onOpenStopwatch}
                onDelete={onDeleteSet}
                allTimeBest1RM={allTimeBest1RM}
                previousRir={previousRirs[idx] ?? null}
                stopwatchRunning={stopwatchRunning}
                stopwatchElapsed={stopwatchElapsed}
              />
            );
          })}

          {/* Add set */}
          <button
            onClick={onAddSet}
            className="flex items-center gap-2 px-4 py-2.5 text-primary text-sm font-medium w-full min-h-[44px] border-t border-border"
          >
            <Plus className="h-4 w-4" />
            Add Set
          </button>
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function WorkoutPage() {
  const workout = useCurrentWorkoutFull(); // undefined = first-ever load, null = no workout
  // Plans for the "Start from Routine" panel — read from Dexie. Same shape
  // as the legacy /api/plans?full=1 response (plan -> routines -> exercises ->
  // sets) so the rendering JSX below is unchanged. Casts through unknown
  // because LocalPlanWithRoutines and PlanWithRoutines are structurally
  // compatible (extra _synced/_updated_at/_deleted fields on local rows
  // are harmless extras).
  const plansLocal = usePlansFull();
  const plans = plansLocal as unknown as PlanWithRoutines[];
  const [showExercises, setShowExercises] = useState(false);
  const [showRestTimer, setShowRestTimer] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [startingRoutine, setStartingRoutine] = useState<string | null>(null);
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(new Set());
  const [collapsedPlans, setCollapsedPlans] = useState<Set<string>>(new Set());
  // Info modal state — null = closed. Lifted to the page level so the modal
  // mount survives re-renders driven by the rest-timer 500ms tick. The modal
  // itself is React.memo'd so stable props (exercise object, onClose) skip
  // those re-renders entirely.
  //
  // Stored as a UUID, not the exercise object: the latter would freeze a
  // snapshot at click time, so an external edit to the exercise (e.g. via
  // /exercises) wouldn't reflow into the open modal. Deriving from the live
  // workout.exercises[] keeps memo identity stable through 500ms timer ticks
  // (Dexie writes don't fire during rest) but updates immediately when
  // edits actually land.
  const [infoExerciseUuid, setInfoExerciseUuid] = useState<string | null>(null);
  const closeInfoModal = useCallback(() => setInfoExerciseUuid(null), []);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(48);
  const [scheduleTapHighlight, setScheduleTapHighlight] = useState(false);
  const startSectionRef = useRef<HTMLDivElement>(null);

  const restTimer = useRestTimer();
  const elapsed = useElapsed(workout?.start_time ?? null);

  // Derive the live exercise object for the [i] info modal from the current
  // workout. Identity stays stable through 500ms timer-driven re-renders
  // (workout.exercises[].exercise is itself memoized inside useCurrentWorkoutFull),
  // and any Dexie edit reflows immediately because allExercises updates the
  // join in the live query.
  const infoExercise = useMemo<Exercise | null>(() => {
    if (!infoExerciseUuid || !workout) return null;
    const we = workout.exercises.find((e) => e.exercise?.uuid === infoExerciseUuid);
    return (we?.exercise ?? null) as unknown as Exercise | null;
  }, [infoExerciseUuid, workout]);

  // Stopwatch (count-up timer) for time-based exercises. State machine and
  // persistence live in useStopwatch; the sheet renders below as a sibling
  // of RestTimerSheet so both can coexist (separate localStorage namespaces
  // — see stopwatch-utils.STOPWATCH_STATE_KEY vs rest-timer-utils).
  const isSetAttached = useCallback((setRowKey: string) => {
    if (!workout) return false;
    const [weUuid, setUuid] = setRowKey.split(':');
    return workout.exercises.some(we =>
      we.uuid === weUuid && we.sets.some(s => s.uuid === setUuid && !s._deleted)
    );
  }, [workout]);
  const stopwatch = useStopwatch({ isSetAttached });
  const [stopwatchOpen, setStopwatchOpen] = useState(false);
  const [stopwatchReplacing, setStopwatchReplacing] = useState<number | null>(null);

  const handleOpenStopwatch = useCallback(
    (setRowKey: string, hasSides: boolean, replacingSeconds: number | null) => {
      setStopwatchReplacing(replacingSeconds);
      stopwatch.open({ setRowKey, hasSides });
      setStopwatchOpen(true);
    },
    [stopwatch],
  );

  // Re-open the sheet automatically when a stopwatch is restored on mount
  // (e.g. after a page reload mid-workout) AND the user explicitly returns
  // to the workout page. This is opt-in: the sticky pill in the workout
  // header is the recommended re-entry per Phase 2 design auto-decision #6.
  // We don't auto-open; the user taps the running indicator.

  const handleStopwatchCommit = useCallback(async (durationSeconds: number) => {
    const state = stopwatch.state;
    if (!state) return;
    const [weUuid, setUuid] = state.setRowKey.split(':');
    if (!weUuid || !setUuid) return;
    // Preserve any previously-entered weight on the set (loaded planks etc).
    const we = workout?.exercises.find(e => e.uuid === weUuid);
    const set = we?.sets.find(s => s.uuid === setUuid);
    const weightKg = set?.weight ?? 0;
    await mutUpdateSet(setUuid, {
      weight: weightKg,
      duration_seconds: durationSeconds,
      is_completed: true,
    });
    setStopwatchOpen(false);
    setStopwatchReplacing(null);
  }, [stopwatch.state, workout]);

  const stopwatchSetKey = stopwatch.state && (stopwatch.state.phase === 'counting' || stopwatch.state.phase === 'switching')
    ? stopwatch.state.setRowKey : null;

  // Drag-to-reorder sensors
  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 5 } }),
    useSensor(PointerSensor, { activationConstraint: { delay: 300, tolerance: 5 } }),
  );

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !workout) return;

    const exercises = workout.exercises;
    const oldIndex = exercises.findIndex(e => e.uuid === active.id);
    const newIndex = exercises.findIndex(e => e.uuid === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...exercises];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    await reorderExercises(reordered.map(e => e.uuid));
  }, [workout]);

  // Measure fixed header height
  useEffect(() => {
    if (!headerRef.current) return;
    const measure = () => {
      if (headerRef.current) setHeaderHeight(headerRef.current.getBoundingClientRect().height);
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(headerRef.current);
    return () => obs.disconnect();
  }, []);

  // Request notification permission once
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // When the user taps a workout-schedule notification, highlight the start section
  useEffect(() => {
    if (!consumeScheduleTap()) return;
    setScheduleTapHighlight(true);
    // Scroll to start section once plans have loaded (slight delay for render)
    const id = setTimeout(() => {
      startSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
    return () => clearTimeout(id);
  }, []);

  // Auto-expand first incomplete exercise when workout loads
  useEffect(() => {
    if (!workout || workout.exercises.length === 0) return;
    if (expandedExercises.size > 0) return; // Already expanded something
    const first = workout.exercises.find(e => e.sets.some(s => !s.is_completed)) ?? workout.exercises[0];
    if (first) setExpandedExercises(new Set([first.uuid]));
  }, [workout?.uuid]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExercise = useCallback((uuid: string) => {
    setExpandedExercises(prev => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }, []);

  // Collapse all plans except the first one once the local data has loaded.
  // useLiveQuery returns synchronously after first render, so this effect
  // runs once with the full plan list — no network round-trip needed.
  useEffect(() => {
    if (plans.length > 1 && collapsedPlans.size === 0) {
      setCollapsedPlans(new Set(plans.slice(1).map((p: PlanWithRoutines) => p.uuid)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans.length]);

  const togglePlan = useCallback((uuid: string) => {
    setCollapsedPlans(prev => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }, []);

  const startWorkoutFromRoutine = async (_planUuid: string, routineUuid: string) => {
    setStartingRoutine(routineUuid);
    try {
      // Find the routine in our cached plans data
      const routine = (plans ?? []).flatMap(p => p.routines).find(r => r.uuid === routineUuid);
      if (!routine) throw new Error('Routine not found');

      const workoutUuid = genUUID();
      const now = Date.now();
      const syncMeta = { _synced: false, _updated_at: now, _deleted: false as const };
      const exercises = routine.exercises ?? [];

      const exerciseUuids = exercises.map(re => re.exercise_uuid.toLowerCase());
      const lastSetsByExercise = await Promise.all(
        exerciseUuids.map(async (exerciseUuid) => {
          let lastSets: { weight: number | null; repetitions: number | null }[] = [];
          try {
            const res = await fetch(`${apiBase()}/api/exercises/${exerciseUuid}/history`);
            if (res.ok) {
              const data = await res.json();
              const pbPerSet: { orderIndex: number; weight: number; repetitions: number }[] = data.pbPerSet ?? [];
              if (pbPerSet.length > 0) {
                const pbMap = new Map(pbPerSet.map(s => [s.orderIndex, s]));
                const maxIdx = Math.max(...pbPerSet.map(s => s.orderIndex));
                for (let i = 0; i <= maxIdx; i++) {
                  const pb = pbMap.get(i);
                  lastSets.push(pb ? { weight: pb.weight, repetitions: pb.repetitions } : { weight: null, repetitions: null });
                }
              }
            }
          } catch { /* offline */ }

          if (lastSets.length === 0) {
            const prevWEs = await db.workout_exercises
              .where('exercise_uuid')
              .equals(exerciseUuid)
              .filter(e => !e._deleted)
              .toArray();
            if (prevWEs.length > 0) {
              const weWithTime = await Promise.all(
                prevWEs.map(async we => {
                  const w = await db.workouts.get(we.workout_uuid);
                  return { we, time: w?.start_time ?? '' };
                }),
              );
              weWithTime.sort((a, b) => b.time.localeCompare(a.time));
              const mostRecent = weWithTime[0];
              if (mostRecent) {
                const localSets = await db.workout_sets
                  .where('workout_exercise_uuid')
                  .equals(mostRecent.we.uuid)
                  .filter(s => !s._deleted && s.is_completed)
                  .sortBy('order_index');
                lastSets = localSets.map(s => ({ weight: s.weight, repetitions: s.repetitions }));
              }
            }
          }
          return lastSets;
        }),
      );

      const weRows = exercises.map((routineExercise) => ({
        uuid: genUUID(),
        workout_uuid: workoutUuid,
        exercise_uuid: routineExercise.exercise_uuid.toLowerCase(),
        comment: routineExercise.comment ?? null,
        order_index: routineExercise.order_index,
        ...syncMeta,
      }));

      const setRows = exercises.flatMap((routineExercise, idx) => {
        const weUuid = weRows[idx].uuid;
        const lastSets = lastSetsByExercise[idx];
        const sets = routineExercise.sets ?? [];
        const templateSets = sets.length > 0
          ? sets.map(s => ({
              min_target_reps: s.min_repetitions ?? null,
              max_target_reps: s.max_repetitions ?? null,
              tag: s.tag ?? null,
              comment: s.comment ?? null,
              order_index: s.order_index,
            }))
          : [0, 1, 2].map(i => ({
              min_target_reps: null as number | null,
              max_target_reps: null as number | null,
              tag: null as string | null,
              comment: null as string | null,
              order_index: i,
            }));
        return templateSets.map((s, i) => {
          const prev = lastSets[i];
          return {
            uuid: genUUID(),
            workout_exercise_uuid: weUuid,
            weight: prev?.weight ?? null,
            repetitions: prev?.repetitions ?? null,
            min_target_reps: s.min_target_reps,
            max_target_reps: s.max_target_reps,
            rpe: null,
            rir: null,
            tag: s.tag as 'dropSet' | 'failure' | null,
            comment: s.comment,
            is_completed: false,
            is_pr: false,
            excluded_from_pb: false,
            order_index: s.order_index,
            duration_seconds: null,
            ...syncMeta,
          };
        });
      });

      await db.transaction('rw', [db.workouts, db.workout_exercises, db.workout_sets], async () => {
        const current = await db.workouts.filter(w => w.is_current === true).first();
        if (current) {
          await db.workouts.update(current.uuid, {
            is_current: false,
            end_time: new Date().toISOString(),
            _synced: false,
            _updated_at: now,
            _deleted: false,
          });
        }
        await db.workouts.add({
          uuid: workoutUuid,
          start_time: new Date().toISOString(),
          end_time: null,
          title: routine.title,
          comment: null,
          is_current: true,
          workout_routine_uuid: routineUuid,
          ...syncMeta,
        });
        await db.workout_exercises.bulkAdd(weRows);
        await db.workout_sets.bulkAdd(setRows);
      });

      // Push to server in background
      syncEngine.schedulePush();
    } catch (err) {
      console.error('Failed to start workout from routine:', err);
    } finally {
      setStartingRoutine(null);
    }
  };

  const startWorkout = async () => {
    await mutStartWorkout();
  };

  const finishWorkout = async () => {
    if (!workout) return;
    await mutFinishWorkout(workout.uuid);
    setShowFinishModal(false);
    restTimer.cancel();
  };

  const handleAddExercise = async (exercise: Exercise) => {
    if (!workout) return;
    const orderIdx = workout.exercises.length;
    const weUuid = await addExerciseToWorkout(workout.uuid, exercise.uuid, orderIdx);

    // Prefill sets from PB per set position (includes imported data)
    let prevSets: { weight: number; repetitions: number }[] = [];
    try {
      const res = await fetch(`${apiBase()}/api/exercises/${exercise.uuid}/history`);
      if (res.ok) {
        const data = await res.json();
        const pbPerSet: { orderIndex: number; weight: number; repetitions: number }[] = data.pbPerSet ?? [];
        if (pbPerSet.length > 0) {
          const pbMap = new Map(pbPerSet.map(s => [s.orderIndex, s]));
          const maxIdx = Math.max(...pbPerSet.map(s => s.orderIndex));
          for (let i = 0; i <= maxIdx; i++) {
            const pb = pbMap.get(i);
            prevSets.push(pb ? { weight: pb.weight, repetitions: pb.repetitions } : { weight: 0, repetitions: 0 });
          }
        }
      }
    } catch { /* offline — fall through with no prefill */ }

    // Fall back to local IndexedDB if server returned nothing
    if (prevSets.length === 0) {
      const localPrev = await db.workout_exercises
        .where('exercise_uuid')
        .equals(exercise.uuid.toLowerCase())
        .filter(e => !e._deleted && e.workout_uuid !== workout.uuid)
        .toArray();
      if (localPrev.length > 0) {
        const withTime = await Promise.all(
          localPrev.map(async we => {
            const w = await db.workouts.get(we.workout_uuid);
            return { we, time: w?.start_time ?? '' };
          }),
        );
        withTime.sort((a, b) => b.time.localeCompare(a.time));
        const mostRecent = withTime[0];
        if (mostRecent) {
          const sets = await db.workout_sets
            .where('workout_exercise_uuid')
            .equals(mostRecent.we.uuid)
            .filter(s => !s._deleted && s.is_completed)
            .sortBy('order_index');
          prevSets = sets.map(s => ({ weight: s.weight ?? 0, repetitions: s.repetitions ?? 0 }));
        }
      }
    }

    // Create prefilled sets (default to 4 empty sets if no history)
    const setCount = prevSets.length > 0 ? prevSets.length : 4;
    for (let i = 0; i < setCount; i++) {
      const prev = prevSets[i];
      await mutAddSet(weUuid, {
        weight: prev?.weight ?? null,
        repetitions: prev?.repetitions ?? null,
      }, i);
    }

    setShowExercises(false);
  };

  const updateSetRir = async (setUuid: string, rir: number | null) => {
    await mutUpdateSet(setUuid, { rir });
  };

  // Time-mode RPE write. Client only writes `rpe` — the sync push route
  // derives `rir = clamp(10 - rpe, 0, 5)` server-side so the existing
  // RIR-based effective_set_count math stays consistent. See
  // PLAN-exercise-timer.md Phase 3 auto-decision E3.
  const updateSetRpe = async (setUuid: string, rpe: number | null) => {
    await mutUpdateSet(setUuid, { rpe });
  };

  const updateSet = async (workoutExerciseUuid: string, setUuid: string, weight: number, reps: number) => {
    await mutUpdateSet(setUuid, { weight, repetitions: reps, is_completed: true });

    // Auto-start rest timer if enabled in settings
    const { defaultRest, autoStart } = getRestSettings();
    if (autoStart) {
      // Pass exercise name + set number so the Live Activity can show context
      // on the Lock Screen and in the Dynamic Island.
      const we = workout?.exercises.find(e => e.uuid === workoutExerciseUuid);
      const exerciseName = we?.exercise?.title;
      const setNumber = we
        ? we.sets.filter(s => !s._deleted).findIndex(s => s.uuid === setUuid) + 1
        : undefined;
      restTimer.start(defaultRest, { exerciseName, setNumber });
    }
    // Note: PR detection happens server-side after sync; is_pr updates via pull
  };

  // Persist edits to an already-completed set without flipping completion or
  // restarting the rest timer. Fires from input onBlur in SetRow when the user
  // tweaks weight/reps after ticking a set off.
  const editSet = async (_workoutExerciseUuid: string, setUuid: string, weight: number, reps: number) => {
    await mutUpdateSet(setUuid, { weight, repetitions: reps });
  };

  // Time-mode counterpart. Writes weight + duration_seconds (weight stays
  // captured for loaded holds like weighted planks/dips). Same auto-rest-timer
  // behavior as rep mode so the workflow is consistent.
  const updateSetDuration = async (workoutExerciseUuid: string, setUuid: string, weight: number, durationSeconds: number) => {
    await mutUpdateSet(setUuid, { weight, duration_seconds: durationSeconds, is_completed: true });

    const { defaultRest, autoStart } = getRestSettings();
    if (autoStart) {
      const we = workout?.exercises.find(e => e.uuid === workoutExerciseUuid);
      const exerciseName = we?.exercise?.title;
      const setNumber = we
        ? we.sets.filter(s => !s._deleted).findIndex(s => s.uuid === setUuid) + 1
        : undefined;
      restTimer.start(defaultRest, { exerciseName, setNumber });
    }
  };

  const editSetDuration = async (_workoutExerciseUuid: string, setUuid: string, weight: number, durationSeconds: number) => {
    await mutUpdateSet(setUuid, { weight, duration_seconds: durationSeconds });
  };

  const handleAddSet = async (we: LocalWorkoutExerciseEntry) => {
    const orderIdx = we.sets.length;
    const prefill = await getAutoFillValues(we.exercise_uuid, we.sets);
    await mutAddSet(we.uuid, {
      ...(prefill.weight != null && { weight: prefill.weight }),
      ...(prefill.repetitions != null && { repetitions: prefill.repetitions }),
    }, orderIdx);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleDeleteSet = async (setUuid: string) => {
    await mutDeleteSet(setUuid);
  };

  const handleRemoveExercise = async (workoutExerciseUuid: string) => {
    await removeExerciseFromWorkout(workoutExerciseUuid);
  };

  // ── Loading ──
  if (workout === undefined) {
    return (
      <main className="tab-content bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </main>
    );
  }

  // ── No active workout ──
  if (!workout) {
    // usePlansFull returns [] synchronously after first render, so plans
    // is always a real array here. The "Loading routines…" line below is
    // only shown for the brief sub-tick before useLiveQuery resolves.
    const plansLoaded = true;
    const routinesExist = plans.some(p => p.routines.length > 0);
    return (
      <main className="tab-content bg-background overflow-y-auto">
        <div className="px-4 pt-safe pb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Workout</h1>
          <div className="flex items-center gap-1">
            <Link
              href="/history"
              className="flex items-center justify-center text-muted-foreground min-h-[44px] min-w-[44px]"
              aria-label="History"
            >
              <Clock className="h-5 w-5" strokeWidth={1.75} />
            </Link>
            <Link
              href="/exercises"
              className="flex items-center justify-center text-muted-foreground min-h-[44px] min-w-[44px]"
              aria-label="Exercises"
            >
              <Dumbbell className="h-5 w-5" strokeWidth={1.75} />
            </Link>
            <Link
              href="/plans"
              className="flex items-center justify-center text-muted-foreground min-h-[44px] min-w-[44px]"
              aria-label="Manage routines"
            >
              <ClipboardList className="h-5 w-5" strokeWidth={1.75} />
            </Link>
          </div>
        </div>
        <div className="px-4 space-y-4">
          <div
            ref={startSectionRef}
            className={`ios-section transition-all ${scheduleTapHighlight ? 'ring-2 ring-primary ring-offset-2 ring-offset-background rounded-xl' : ''}`}
          >
            <button
              onClick={startWorkout}
              className="w-full py-3.5 text-center text-primary font-semibold text-base min-h-[44px]"
            >
              Start Empty Workout
            </button>
          </div>

          {routinesExist && (
            <div>
              <div className="mb-1 px-1">
                <p className="text-xs font-semibold text-primary uppercase tracking-wide">Start from Routine</p>
              </div>
              <div className="space-y-2">
                {plans.filter(p => p.routines.length > 0).map((plan) => {
                  const isCollapsed = collapsedPlans.has(plan.uuid);
                  const routineCount = plan.routines.length;
                  return (
                    <div key={plan.uuid} className="ios-section">
                      <button
                        onClick={() => togglePlan(plan.uuid)}
                        className={`flex items-center gap-3 px-4 py-4 w-full text-left ${isCollapsed ? '' : 'border-b border-border'}`}
                      >
                        {isCollapsed
                          ? <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        }
                        <span className="flex-1 min-w-0">
                          <span className="block text-base font-semibold truncate">
                            {plan.title ?? 'Untitled Plan'}
                          </span>
                          <span className="block text-xs text-muted-foreground mt-0.5">
                            {routineCount} {routineCount === 1 ? 'routine' : 'routines'}
                          </span>
                        </span>
                      </button>
                      {!isCollapsed && plan.routines.map(routine => {
                        const exerciseCount = routine.exercises.length;
                        const setCount = routine.exercises.reduce((sum, e) => sum + e.sets.length, 0);
                        return (
                          <button
                            key={routine.uuid}
                            onClick={() => startWorkoutFromRoutine(plan.uuid, routine.uuid)}
                            disabled={startingRoutine === routine.uuid}
                            className="w-full text-left flex items-center gap-3 px-4 py-3.5 min-h-[60px] border-b border-border last:border-0 disabled:opacity-50"
                          >
                            <span className="flex-1 min-w-0">
                              <span className="block font-medium text-sm truncate">
                                {routine.title ?? 'Untitled Routine'}
                              </span>
                              {exerciseCount > 0 && (
                                <span className="block text-xs text-muted-foreground mt-0.5">
                                  {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}
                                  {setCount > 0 && ` · ${setCount} ${setCount === 1 ? 'set' : 'sets'}`}
                                </span>
                              )}
                            </span>
                            {startingRoutine === routine.uuid ? (
                              <span className="text-xs text-muted-foreground">Starting…</span>
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!plansLoaded && (
            <p className="text-center text-muted-foreground text-sm py-4">Loading routines…</p>
          )}
          {plansLoaded && !routinesExist && (
            <p className="text-center text-muted-foreground text-sm">
              <Link href="/plans" className="text-primary">Create a routine</Link> to start a pre-planned session.
            </p>
          )}

          <HealthSection />
        </div>
        {showExercises && (
          <AddExerciseSheet onAdd={handleAddExercise} onClose={() => setShowExercises(false)} />
        )}
      </main>
    );
  }

  // ── Active workout ──

  return (
    <>
      {/* Fixed summary bar only */}
      <div ref={headerRef} className="fixed top-0 left-0 right-0 z-20 bg-background pt-safe">
        <WorkoutSummaryBar
          elapsed={elapsed}
          exercises={workout.exercises}
          restTimer={restTimer}
          onOpenRestTimer={() => setShowRestTimer(true)}
        />
      </div>

      <main className="tab-content bg-background overflow-x-hidden">
        {/* Spacer for fixed bar */}
        <div style={{ height: headerHeight }} />

        {/* Title + finish */}
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold truncate flex-1">
            {workout.title || workout.exercises.map(e => e.exercise?.title).filter(Boolean).slice(0, 2).join(', ') || 'Workout'}
          </h1>
          <button
            onClick={() => setShowFinishModal(true)}
            className="ml-4 text-primary font-semibold text-sm min-h-[44px] flex items-center"
          >
            Finish
          </button>
        </div>

        <div className="px-4 space-y-3 pb-safe-or-4">
          {/* Exercises */}
          {workout.exercises.length > 0 && (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={workout.exercises.map(e => e.uuid)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {workout.exercises.map((we) => (
                    <SortableExerciseCard
                      key={we.uuid}
                      we={we}
                      isExpanded={expandedExercises.has(we.uuid)}
                      onToggle={() => toggleExercise(we.uuid)}
                      onRemove={() => handleRemoveExercise(we.uuid)}
                      onAddSet={() => handleAddSet(we)}
                      onUpdateSet={updateSet}
                      onUpdateSetDuration={updateSetDuration}
                      onEditSet={editSet}
                      onEditSetDuration={editSetDuration}
                      onUpdateSetRir={updateSetRir}
                      onUpdateSetRpe={updateSetRpe}
                      onDeleteSet={mutDeleteSet}
                      onShowInfo={() => setInfoExerciseUuid(we.exercise.uuid)}
                      onOpenStopwatch={handleOpenStopwatch}
                      stopwatchSetKey={stopwatchSetKey}
                      stopwatchElapsed={stopwatch.elapsed}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {/* Add exercises button */}
          <div className="ios-section">
            <button
              onClick={() => setShowExercises(true)}
              className="flex items-center gap-2 px-4 py-3.5 text-primary text-sm font-medium w-full min-h-[44px]"
            >
              <Plus className="h-4 w-4" />
              Add Exercises
            </button>
          </div>

          {/* Finish / Cancel buttons */}
          <div className="ios-section">
            <button
              onClick={() => setShowFinishModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-3.5 text-primary text-sm font-semibold w-full min-h-[44px] border-b border-border"
            >
              <Check className="h-4 w-4" />
              Finish Workout
            </button>
            <button
              onClick={() => setShowCancelModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-3.5 text-destructive text-sm font-medium w-full min-h-[44px]"
            >
              Cancel Workout
            </button>
          </div>
        </div>
      </main>

      {showExercises && (
        <AddExerciseSheet onAdd={handleAddExercise} onClose={() => setShowExercises(false)} />
      )}
      {showRestTimer && (
        <RestTimerSheet
          selected={restTimer.selected}
          remaining={restTimer.remaining}
          overtime={restTimer.overtime}
          isOvertime={restTimer.isOvertime}
          running={restTimer.running}
          progress={restTimer.progress}
          onStart={restTimer.start}
          onCancel={restTimer.cancel}
          onAdjust={restTimer.adjust}
          onClose={() => setShowRestTimer(false)}
        />
      )}
      {stopwatchOpen && stopwatch.state && (
        <StopwatchSheet
          api={stopwatch}
          onCommit={handleStopwatchCommit}
          onClose={() => setStopwatchOpen(false)}
          replacingSeconds={stopwatchReplacing}
          exerciseName={(() => {
            const [weUuid] = stopwatch.state.setRowKey.split(':');
            return workout.exercises.find(e => e.uuid === weUuid)?.exercise?.title ?? undefined;
          })()}
        />
      )}
      {/* Sticky resume bar — when a stopwatch is running but its sheet is
          closed, show a tappable bar so the user can re-enter without
          digging through SetRows. Per Phase 2 design auto-decision #6. */}
      {!stopwatchOpen && stopwatch.state && (stopwatch.state.phase === 'counting' || stopwatch.state.phase === 'switching' || stopwatch.state.phase === 'switch_expired_paused') && (
        <button
          onClick={() => setStopwatchOpen(true)}
          className="fixed bottom-safe-or-4 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-lg flex items-center gap-2"
          aria-label="Resume stopwatch"
        >
          <Timer className="h-4 w-4" />
          {stopwatch.state.hasSides ? (stopwatch.state.side === 1 ? 'First side' : 'Second side') + ' — ' : ''}
          {stopwatch.state.phase === 'switching'
            ? `${stopwatch.switchRemaining}s switch`
            : stopwatch.state.phase === 'switch_expired_paused'
              ? 'Paused'
              : formatTime(stopwatch.elapsed)}
        </button>
      )}
      {showFinishModal && (
        <FinishWorkoutModal
          elapsed={elapsed}
          exercises={workout.exercises}
          onConfirm={finishWorkout}
          onCancel={() => setShowFinishModal(false)}
        />
      )}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold text-center">Cancel Workout?</h2>
            <p className="text-sm text-muted-foreground text-center">
              All progress for this workout will be permanently deleted.
            </p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  if (workout) {
                    mutDeleteWorkout(workout.uuid);
                    restTimer.cancel();
                  }
                  setShowCancelModal(false);
                }}
                className="w-full py-3 rounded-xl bg-destructive text-destructive-foreground font-semibold text-sm"
              >
                Delete Workout
              </button>
              <button
                onClick={() => setShowCancelModal(false)}
                className="w-full py-3 rounded-xl bg-secondary text-foreground font-medium text-sm"
              >
                Keep Going
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Per-exercise info modal — sibling overlay, doesn't unmount workout
          state when opened. Memoized so 500ms rest-timer ticks in this parent
          don't re-render the chart-heavy modal subtree. */}
      <ExerciseDetailModal exercise={infoExercise} onClose={closeInfoModal} />
    </>
  );
}
