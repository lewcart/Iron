'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { App } from '@capacitor/app';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import {
  persistTimer as _persistTimer,
  clearPersistedTimer as _clearPersistedTimer,
  readPersistedTimer as _readPersistedTimer,
  computeRemaining,
} from './rest-timer-utils';
import {
  requestNotificationPermission,
  scheduleRestNotification,
  cancelRestNotification,
} from '@/lib/rest-notifications';
import { consumeScheduleTap } from '@/lib/workout-schedule';
import { HealthSection } from '@/components/HealthSection';
import Link from 'next/link';
import { Check, ChevronDown, ChevronRight, GripVertical, Plus, Search, Settings, X } from 'lucide-react';
import type { WorkoutPlan, WorkoutRoutine, WorkoutRoutineExercise, WorkoutRoutineSet, Exercise } from '@/types';
import { formatTime, calcCompletedSets, calcTotalVolume } from './workout-utils';
import { uuid as genUUID } from '@/lib/uuid';
import { useUnit } from '@/context/UnitContext';
import { useCurrentWorkoutFull, useExercises, getAutoFillValues, getAllTimeBest1RM } from '@/lib/useLocalDB';
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
    defaultRest: parseInt(localStorage.getItem('iron-rest-default') ?? '90', 10),
    autoStart: localStorage.getItem('iron-rest-auto-start') !== 'false',
  };
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
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Absolute epoch ms when the timer expires — the source of truth
  const endTimeRef = useRef<number | null>(null);

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
      const rem = computeRemaining(endTimeRef.current, Date.now());
      if (rem <= 0) {
        stopInterval();
        endTimeRef.current = null;
        clearPersistedTimer();
        setRunning(false);
        setRemaining(0);
        setTimeout(notify, 0);
      } else {
        setRemaining(rem);
      }
    }, 500); // 500ms poll so display never lags more than half a second
  }, [notify, stopInterval]);

  const start = useCallback((seconds: number) => {
    const endTime = Date.now() + seconds * 1000;
    endTimeRef.current = endTime;
    persistTimer(endTime, seconds);
    scheduleRestNotification(endTime);
    setSelected(seconds);
    setRemaining(seconds);
    setRunning(true);
  }, []);

  const cancel = useCallback(() => {
    stopInterval();
    endTimeRef.current = null;
    clearPersistedTimer();
    cancelRestNotification();
    setRunning(false);
    setSelected(null);
    setRemaining(0);
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
      const rem = computeRemaining(endTimeRef.current, Date.now());
      if (rem <= 0) {
        // Timer expired while backgrounded — native notification already fired;
        // cancel it in case it's still pending, then play in-app alert.
        endTimeRef.current = null;
        clearPersistedTimer();
        cancelRestNotification();
        setRunning(false);
        setRemaining(0);
        notify();
      } else {
        setRemaining(rem);
      }
    }).then(handle => {
      cleanup = () => handle.remove();
    });
    return () => cleanup?.();
  }, [notify]);

  const progress = selected ? remaining / selected : 0;
  return { selected, remaining, running, progress, start, cancel, adjust };
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
  const expired = restTimer.selected !== null && restTimer.remaining === 0 && !restTimer.running;

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
          expired ? 'text-red-500' : timerActive ? 'text-primary' : 'text-muted-foreground'
        }`}>
          Rest
        </span>
        <span className={`text-sm font-mono font-semibold tabular-nums ${
          expired ? 'text-red-500' : timerActive ? 'text-primary' : 'text-muted-foreground'
        }`}>
          {timerActive ? formatTime(restTimer.remaining) : '—'}
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
  running,
  progress,
  onStart,
  onCancel,
  onAdjust,
  onClose,
}: {
  selected: number | null;
  remaining: number;
  running: boolean;
  progress: number;
  onStart: (seconds: number) => void;
  onCancel: () => void;
  onAdjust: (delta: number) => void;
  onClose: () => void;
}) {
  const circumference = 2 * Math.PI * 100;
  const dashOffset = circumference * (1 - progress);
  const expired = selected !== null && remaining === 0 && !running;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-safe-plus pb-3 border-b border-border">
        <button onClick={onClose} className="text-primary font-medium text-base">Close</button>
        <h2 className="font-semibold">Rest Timer</h2>
        <div className="w-14" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-8 p-8">
        {!running && !expired ? (
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
                  stroke={expired ? '#ef4444' : 'hsl(var(--primary))'}
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  style={{ transition: running ? 'stroke-dashoffset 1s linear' : 'none' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-5xl font-light tabular-nums ${expired ? 'text-red-500' : ''}`}>
                  {formatTime(remaining)}
                </span>
                <span className="text-sm text-muted-foreground mt-1">{formatTime(selected ?? 0)}</span>
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
function SetRow({
  setNumber,
  set,
  workoutExerciseUuid,
  onUpdate,
  onDelete,
  allTimeBest1RM,
}: {
  setNumber: number;
  set: LocalWorkoutSet;
  workoutExerciseUuid: string;
  onUpdate: (weUuid: string, setUuid: string, weight: number, reps: number) => Promise<void>;
  onDelete: (setUuid: string) => Promise<void>;
  allTimeBest1RM?: number | null;
}) {
  const { toDisplay, fromInput, label } = useUnit();
  const [weight, setWeight] = useState(
    set.weight != null ? toDisplay(set.weight).toString() : ''
  );
  const [reps, setReps] = useState(set.repetitions?.toString() ?? '');
  const [saving, setSaving] = useState(false);

  // Live PD detection — compare current estimated 1RM against all-time best.
  // No is_completed guard: badge persists naturally after completion since
  // weight/reps values don't change once the set is ticked off.
  const currentWeightKg = fromInput(parseFloat(weight) || 0);
  const currentReps = parseInt(reps) || 0;
  const isLivePD = allTimeBest1RM != null && isNewEstimated1RM(currentWeightKg, currentReps, allTimeBest1RM);

  const handleComplete = async () => {
    setSaving(true);
    // Convert display unit value back to kg for storage
    const weightKg = fromInput(parseFloat(weight) || 0);
    await onUpdate(workoutExerciseUuid, set.uuid, weightKg, parseInt(reps) || 0);
    setSaving(false);
  };

  const completed = set.is_completed;
  const isPR = set.is_pr;
  const showPD = isPR || isLivePD;

  const inner = (
    <div className={`flex items-center gap-2 py-1.5 px-3 border-b border-border last:border-0 ${completed ? 'opacity-60' : ''}`}>
      {/* Set number */}
      <div className="w-5 text-center text-xs font-semibold text-muted-foreground">{setNumber}</div>

      {/* Weight */}
      <div className="flex-1 flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          placeholder="—"
          value={weight}
          onChange={e => setWeight(e.target.value)}
          onFocus={e => { e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }); e.target.select(); }}
          className="w-full text-right text-sm font-medium bg-transparent outline-none min-h-[36px]"
        />
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>

      <span className="text-muted-foreground text-xs">×</span>

      {/* Reps */}
      <div className="flex-1 flex items-center gap-1">
        <input
          type="number"
          inputMode="numeric"
          placeholder="—"
          value={reps}
          onChange={e => setReps(e.target.value)}
          onFocus={e => { e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }); e.target.select(); }}
          className="w-full text-right text-sm font-medium bg-transparent outline-none min-h-[36px]"
        />
        <span className="text-[10px] text-muted-foreground">reps</span>
      </div>

      {/* PD badge — subtle indicator, no row layout changes */}
      {showPD && (
        <span className="text-[9px] font-bold px-1 py-0.5 rounded-full flex-shrink-0 text-amber-400 bg-amber-400/15 border border-amber-400/30">
          PR
        </span>
      )}

      {/* Complete button */}
      <button
        onClick={handleComplete}
        disabled={saving}
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
          completed
            ? 'bg-green-500 text-white'
            : 'border-2 border-border text-transparent hover:border-primary'
        }`}
      >
        <Check className="h-3.5 w-3.5" />
      </button>
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
  onDeleteSet,
}: {
  we: LocalWorkoutExerciseEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onAddSet: () => void;
  onUpdateSet: (workoutExerciseUuid: string, setUuid: string, weight: number, reps: number) => Promise<void>;
  onDeleteSet: (uuid: string) => Promise<void>;
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
            <span className={`flex-1 font-semibold text-sm truncate ${allDone ? 'text-muted-foreground' : ''}`}>
              {we.exercise?.title ?? 'Unknown Exercise'}
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
        </div>
      </SwipeToDelete>

      {/* Collapsible sets */}
      {isExpanded && (
        <>
          {/* Column headers */}
          <div className="flex items-center gap-2 px-3 py-1 border-t border-b border-border bg-secondary/30">
            <div className="w-5 text-center text-[10px] font-medium text-muted-foreground">Set</div>
            <div className="flex-1 text-right text-[10px] font-medium text-muted-foreground">Weight</div>
            <div className="w-3" />
            <div className="flex-1 text-right text-[10px] font-medium text-muted-foreground">Reps</div>
          </div>

          {/* Sets */}
          {we.sets.map((set, idx) => (
            <SetRow
              key={set.uuid}
              setNumber={idx + 1}
              set={set}
              workoutExerciseUuid={we.uuid}
              onUpdate={onUpdateSet}
              onDelete={onDeleteSet}
              allTimeBest1RM={allTimeBest1RM}
            />
          ))}

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
  const workout = useCurrentWorkoutFull(); // undefined = loading, null = no workout
  const [showExercises, setShowExercises] = useState(false);
  const [showRestTimer, setShowRestTimer] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [plans, setPlans] = useState<PlanWithRoutines[] | null>(null);
  const [startingRoutine, setStartingRoutine] = useState<string | null>(null);
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(new Set());
  const [collapsedPlans, setCollapsedPlans] = useState<Set<string>>(new Set());
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(48);
  const [scheduleTapHighlight, setScheduleTapHighlight] = useState(false);
  const startSectionRef = useRef<HTMLDivElement>(null);

  const restTimer = useRestTimer();
  const elapsed = useElapsed(workout?.start_time ?? null);

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

  // Load plans with full routine details on mount (for instant local workout creation)
  useEffect(() => {
    fetch(`${apiBase()}/api/plans?full=1`)
      .then(r => r.json())
      .then(data => {
        const loaded = data.plans ?? [];
        setPlans(loaded);
        // Collapse all plans except the first one
        if (loaded.length > 1) {
          setCollapsedPlans(new Set(loaded.slice(1).map((p: PlanWithRoutines) => p.uuid)));
        }
      })
      .catch(() => setPlans([])); // Resolve to empty on failure
  }, []);

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

      // End any locally active workout
      const current = await db.workouts.filter(w => w.is_current === true).first();
      if (current) {
        await db.workouts.update(current.uuid, {
          is_current: false,
          end_time: new Date().toISOString(),
          _synced: false,
          _updated_at: Date.now(),
          _deleted: false,
        });
      }

      // Create workout entirely in local DB — instant
      const workoutUuid = genUUID();
      const now = Date.now();
      const syncMeta = { _synced: false, _updated_at: now, _deleted: false as const };

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

      const exercises = routine.exercises ?? [];
      for (const routineExercise of exercises) {
        const weUuid = genUUID();
        const exerciseUuid = routineExercise.exercise_uuid.toLowerCase();
        await db.workout_exercises.add({
          uuid: weUuid,
          workout_uuid: workoutUuid,
          exercise_uuid: exerciseUuid,
          comment: null,
          order_index: routineExercise.order_index,
          ...syncMeta,
        });

        // Look up PB per set position for this exercise to prefill weights
        // Try server first (includes imported history), fall back to local IndexedDB
        let lastSets: { weight: number | null; repetitions: number | null }[] = [];
        try {
          const res = await fetch(`${apiBase()}/api/exercises/${exerciseUuid}/history`);
          if (res.ok) {
            const data = await res.json();
            const pbPerSet: { orderIndex: number; weight: number; repetitions: number }[] = data.pbPerSet ?? [];
            if (pbPerSet.length > 0) {
              // Build array indexed by set position
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
            .filter(e => !e._deleted && e.workout_uuid !== workoutUuid)
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

        await db.workout_sets.bulkAdd(
          templateSets.map((s, i) => {
            const prev = lastSets[i];
            return {
              uuid: genUUID(),
              workout_exercise_uuid: weUuid,
              weight: prev?.weight ?? null,
              repetitions: prev?.repetitions ?? null,
              min_target_reps: s.min_target_reps,
              max_target_reps: s.max_target_reps,
              rpe: null,
              tag: s.tag as 'dropSet' | 'failure' | null,
              comment: s.comment,
              is_completed: false,
              is_pr: false,
              order_index: s.order_index,
              ...syncMeta,
            };
          }),
        );
      }

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

  const updateSet = async (workoutExerciseUuid: string, setUuid: string, weight: number, reps: number) => {
    await mutUpdateSet(setUuid, { weight, repetitions: reps, is_completed: true });

    // Auto-start rest timer if enabled in settings
    const { defaultRest, autoStart } = getRestSettings();
    if (autoStart) {
      restTimer.start(defaultRest);
    }
    // Note: PR detection happens server-side after sync; is_pr updates via pull
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
    const plansLoaded = plans !== null;
    const routinesExist = plansLoaded && plans.some(p => p.routines.length > 0);
    return (
      <main className="tab-content bg-background overflow-y-auto">
        <div className="px-4 pt-safe pb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Workout</h1>
          <Link
            href="/plans"
            className="flex items-center gap-1.5 text-sm text-primary font-medium"
          >
            <Settings className="h-4 w-4" />
            Manage
          </Link>
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
                  return (
                    <div key={plan.uuid} className="ios-section">
                      <button
                        onClick={() => togglePlan(plan.uuid)}
                        className="flex items-center gap-2 px-4 pt-3 pb-1 w-full text-left"
                      >
                        {isCollapsed
                          ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        }
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          {plan.title ?? 'Untitled Plan'}
                        </span>
                      </button>
                      {!isCollapsed && plan.routines.map(routine => (
                        <button
                          key={routine.uuid}
                          onClick={() => startWorkoutFromRoutine(plan.uuid, routine.uuid)}
                          disabled={startingRoutine === routine.uuid}
                          className="ios-row w-full text-left min-h-[52px] disabled:opacity-50"
                        >
                          <span className="flex-1 font-medium text-sm">
                            {routine.title ?? 'Untitled Routine'}
                          </span>
                          {startingRoutine === routine.uuid ? (
                            <span className="text-xs text-muted-foreground">Starting…</span>
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      ))}
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
                      onDeleteSet={mutDeleteSet}
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
          running={restTimer.running}
          progress={restTimer.progress}
          onStart={restTimer.start}
          onCancel={restTimer.cancel}
          onAdjust={restTimer.adjust}
          onClose={() => setShowRestTimer(false)}
        />
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
    </>
  );
}
