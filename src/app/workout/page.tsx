'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, Plus, Search, X } from 'lucide-react';
import type { Workout, WorkoutExercise, WorkoutSet, Exercise, WorkoutPlan, WorkoutRoutine } from '@/types';
import { formatTime, calcCompletedSets, calcTotalVolume } from './workout-utils';
import type { WorkoutExerciseEntry } from './workout-utils';

interface WorkoutWithExercises extends Workout {
  exercises: WorkoutExerciseEntry[];
}

// ─── Settings (localStorage-backed) ──────────────────────────────────────────
function getRestSettings() {
  if (typeof window === 'undefined') return { defaultRest: 90, autoStart: true };
  return {
    defaultRest: parseInt(localStorage.getItem('iron-rest-default') ?? '90', 10),
    autoStart: localStorage.getItem('iron-rest-auto-start') !== 'false',
  };
}

// ─── Rest timer hook ──────────────────────────────────────────────────────────
function useRestTimer() {
  const [selected, setSelected] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const notify = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('Rest complete!', { body: 'Time to get back to work!' });
    }
  }, []);

  const start = useCallback((seconds: number) => {
    clearInterval(intervalRef.current!);
    setSelected(seconds);
    setRemaining(seconds);
    setRunning(true);
  }, []);

  const cancel = useCallback(() => {
    clearInterval(intervalRef.current!);
    setRunning(false);
    setSelected(null);
    setRemaining(0);
  }, []);

  const adjust = useCallback((delta: number) => {
    setRemaining(r => Math.max(0, r + delta));
  }, []);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) {
          clearInterval(intervalRef.current!);
          setRunning(false);
          setTimeout(notify, 0);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current!);
  }, [running, notify]);

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
function WorkoutSummaryBar({
  elapsed,
  exercises,
}: {
  elapsed: number;
  exercises: WorkoutWithExercises['exercises'];
}) {
  const completedSets = calcCompletedSets(exercises);
  const totalVolume = calcTotalVolume(exercises);
  const exerciseCount = exercises.length;

  return (
    <div className="sticky top-0 z-10 mx-4 mb-3 rounded-xl bg-zinc-900 border border-zinc-800 shadow-lg">
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex flex-col items-center">
          <span className="text-xs text-zinc-400 font-medium">Time</span>
          <span className="text-sm font-mono font-semibold text-zinc-100 tabular-nums">
            {formatTime(elapsed)}
          </span>
        </div>
        <div className="w-px h-8 bg-zinc-800" />
        <div className="flex flex-col items-center">
          <span className="text-xs text-zinc-400 font-medium">Exercises</span>
          <span className="text-sm font-semibold text-zinc-100">{exerciseCount}</span>
        </div>
        <div className="w-px h-8 bg-zinc-800" />
        <div className="flex flex-col items-center">
          <span className="text-xs text-zinc-400 font-medium">Sets Done</span>
          <span className="text-sm font-semibold text-zinc-100">{completedSets}</span>
        </div>
        <div className="w-px h-8 bg-zinc-800" />
        <div className="flex flex-col items-center">
          <span className="text-xs text-zinc-400 font-medium">Volume</span>
          <span className="text-sm font-semibold text-zinc-100">
            {totalVolume >= 1000
              ? `${(totalVolume / 1000).toFixed(1)}t`
              : `${totalVolume.toFixed(0)}kg`}
          </span>
        </div>
      </div>
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
  exercises: WorkoutWithExercises['exercises'];
  onConfirm: () => void;
  onCancel: () => void;
}) {
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
              {totalVolume >= 1000
                ? `${(totalVolume / 1000).toFixed(1)}t`
                : `${totalVolume.toFixed(0)} kg`}
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
      <div className="flex items-center justify-between px-4 pt-14 pb-3 border-b border-border">
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

// ─── Exercise selector sheet ─────────────────────────────────────────────────
function AddExerciseSheet({
  onAdd,
  onClose,
}: {
  onAdd: (exercise: Exercise) => void;
  onClose: () => void;
}) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (selectedMuscle) params.set('muscleGroup', selectedMuscle);
    fetch(`/api/exercises?${params}`)
      .then(r => r.json())
      .then(data => { setExercises(data); setLoading(false); });
  }, [search, selectedMuscle]);

  // Group by primary muscle (only when no muscle filter active)
  const grouped: Record<string, Exercise[]> = {};
  for (const ex of exercises) {
    const muscle = ex.primary_muscles[0] ?? 'Other';
    if (!grouped[muscle]) grouped[muscle] = [];
    grouped[muscle].push(ex);
  }
  const groups = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-14 pb-3 border-b border-border">
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
        {loading ? (
          <p className="text-center py-8 text-muted-foreground text-sm">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground text-sm">No exercises found</p>
        ) : (
          groups.map(([muscle, exs]) => (
            <div key={muscle}>
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 capitalize px-1">{muscle}</p>
              <div className="ios-section">
                {exs.map((ex) => (
                  <button
                    key={ex.uuid}
                    onClick={() => onAdd(ex)}
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
}: {
  setNumber: number;
  set: WorkoutSet;
  workoutExerciseUuid: string;
  onUpdate: (weUuid: string, setUuid: string, weight: number, reps: number) => Promise<void>;
}) {
  const [weight, setWeight] = useState(set.weight?.toString() ?? '');
  const [reps, setReps] = useState(set.repetitions?.toString() ?? '');
  const [saving, setSaving] = useState(false);

  const handleComplete = async () => {
    setSaving(true);
    await onUpdate(workoutExerciseUuid, set.uuid, parseFloat(weight) || 0, parseInt(reps) || 0);
    setSaving(false);
  };

  const completed = set.is_completed;

  return (
    <div className={`flex items-center gap-3 py-2.5 px-4 border-b border-border last:border-0 ${completed ? 'opacity-60' : ''}`}>
      {/* Set number */}
      <div className="w-6 text-center text-sm font-semibold text-muted-foreground">{setNumber}</div>

      {/* Weight */}
      <div className="flex-1 flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          placeholder="—"
          value={weight}
          onChange={e => setWeight(e.target.value)}
          onFocus={e => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          className="w-full text-right text-sm font-medium bg-transparent outline-none min-h-[44px]"
        />
        <span className="text-xs text-muted-foreground">kg</span>
      </div>

      <span className="text-muted-foreground text-sm">×</span>

      {/* Reps */}
      <div className="flex-1 flex items-center gap-1">
        <input
          type="number"
          inputMode="numeric"
          placeholder="—"
          value={reps}
          onChange={e => setReps(e.target.value)}
          onFocus={e => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          className="w-full text-right text-sm font-medium bg-transparent outline-none min-h-[44px]"
        />
        <span className="text-xs text-muted-foreground">reps</span>
      </div>

      {/* Complete button — 44×44 touch target */}
      <button
        onClick={handleComplete}
        disabled={saving}
        className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
          completed
            ? 'bg-green-500 text-white'
            : 'border-2 border-border text-transparent hover:border-primary'
        }`}
      >
        <Check className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Add set button (within exercise) ────────────────────────────────────────
async function addSet(workoutExerciseUuid: string) {
  await fetch(`/api/workout-exercises/${workoutExerciseUuid}/sets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weight: null, repetitions: null }),
  });
}

interface PlanWithRoutines extends WorkoutPlan {
  routines: WorkoutRoutine[];
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function WorkoutPage() {
  const [workout, setWorkout] = useState<WorkoutWithExercises | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExercises, setShowExercises] = useState(false);
  const [showRestTimer, setShowRestTimer] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [plans, setPlans] = useState<PlanWithRoutines[]>([]);
  const [startingRoutine, setStartingRoutine] = useState<string | null>(null);

  const restTimer = useRestTimer();
  const elapsed = useElapsed(workout?.start_time ?? null);

  // Request notification permission once
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const fetchCurrentWorkout = useCallback(async () => {
    const res = await fetch('/api/workouts?current=true');
    const data = await res.json();

    if (data) {
      const detailRes = await fetch(`/api/workouts/${data.uuid}`);
      const detailData = await detailRes.json();

      const exercisesWithDetails = await Promise.all(
        detailData.exercises.map(async (we: WorkoutExercise) => {
          const [exerciseRes, setsRes] = await Promise.all([
            fetch(`/api/exercises?search=${we.exercise_uuid}`),
            fetch(`/api/workout-exercises/${we.uuid}/sets`),
          ]);
          const [exerciseData, setsData] = await Promise.all([
            exerciseRes.json(),
            setsRes.json(),
          ]);
          return {
            ...we,
            exercise: exerciseData.find((e: Exercise) => e.uuid === we.exercise_uuid),
            sets: setsData,
          };
        })
      );

      setWorkout({ ...detailData, exercises: exercisesWithDetails });
    } else {
      setWorkout(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchCurrentWorkout(); }, [fetchCurrentWorkout]);

  useEffect(() => {
    fetch('/api/plans')
      .then(r => r.json())
      .then(data => setPlans(data.plans ?? []));
  }, []);

  const startWorkoutFromRoutine = async (planUuid: string, routineUuid: string) => {
    setStartingRoutine(routineUuid);
    await fetch(`/api/plans/${planUuid}/routines/${routineUuid}/start`, { method: 'POST' });
    await fetchCurrentWorkout();
    setStartingRoutine(null);
  };

  const startWorkout = async () => {
    await fetch('/api/workouts', { method: 'POST' });
    await fetchCurrentWorkout();
  };

  const finishWorkout = async () => {
    if (!workout) return;
    await fetch(`/api/workouts/${workout.uuid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'finish' }),
    });
    setShowFinishModal(false);
    setWorkout(null);
    restTimer.cancel();
  };

  const handleAddExercise = async (exercise: Exercise) => {
    if (!workout) return;
    await fetch(`/api/workouts/${workout.uuid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add-exercise', exerciseUuid: exercise.uuid }),
    });
    setShowExercises(false);
    await fetchCurrentWorkout();
  };

  const updateSet = async (workoutExerciseUuid: string, setUuid: string, weight: number, reps: number) => {
    await fetch(`/api/workout-exercises/${workoutExerciseUuid}/sets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setUuid, weight, repetitions: reps, isCompleted: true }),
    });
    await fetchCurrentWorkout();

    // Auto-start rest timer if enabled in settings
    const { defaultRest, autoStart } = getRestSettings();
    if (autoStart) {
      restTimer.start(defaultRest);
    }
  };

  const handleAddSet = async (workoutExerciseUuid: string) => {
    await addSet(workoutExerciseUuid);
    await fetchCurrentWorkout();
  };

  // ── Loading ──
  if (loading) {
    return (
      <main className="tab-content bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </main>
    );
  }

  // ── No active workout ──
  if (!workout) {
    const routinesExist = plans.some(p => p.routines.length > 0);
    return (
      <main className="tab-content bg-background overflow-y-auto">
        <div className="px-4 pt-14 pb-4">
          <h1 className="text-2xl font-bold">Workout</h1>
        </div>
        <div className="px-4 space-y-4">
          <div className="ios-section">
            <button
              onClick={startWorkout}
              className="w-full py-3.5 text-center text-primary font-semibold text-base min-h-[44px]"
            >
              Start Empty Workout
            </button>
          </div>

          {routinesExist && (
            <div>
              <div className="flex items-center justify-between mb-1 px-1">
                <p className="text-xs font-semibold text-primary uppercase tracking-wide">Start from Routine</p>
                <Link href="/plans" className="text-xs text-primary font-medium">Manage</Link>
              </div>
              <div className="space-y-2">
                {plans.filter(p => p.routines.length > 0).map(plan => (
                  <div key={plan.uuid} className="ios-section">
                    <p className="px-4 pt-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {plan.title ?? 'Untitled Plan'}
                    </p>
                    {plan.routines.map(routine => (
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
                ))}
              </div>
            </div>
          )}

          {!routinesExist && (
            <p className="text-center text-muted-foreground text-sm">
              <Link href="/plans" className="text-primary">Create a routine</Link> to start a pre-planned session.
            </p>
          )}
        </div>
        {showExercises && (
          <AddExerciseSheet onAdd={handleAddExercise} onClose={() => setShowExercises(false)} />
        )}
      </main>
    );
  }

  // ── Active workout ──
  const timerActive = restTimer.running || (restTimer.selected !== null && restTimer.remaining === 0);

  return (
    <>
      <main className="tab-content bg-background overflow-x-hidden">
        {/* Nav bar */}
        <div className="flex items-center justify-between px-4 pt-14 pb-3">
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

        {/* Running summary panel */}
        <WorkoutSummaryBar elapsed={elapsed} exercises={workout.exercises} />

        {/* Rest timer bar */}
        <div className="mx-4 mb-3 rounded-xl bg-secondary/60 flex items-center justify-between px-4 py-2.5">
          {timerActive ? (
            <span className={`text-sm font-mono font-semibold tabular-nums ${
              restTimer.remaining === 0 ? 'text-red-500' : 'text-primary'
            }`}>
              {restTimer.remaining === 0 ? 'Rest over!' : formatTime(restTimer.remaining)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Rest Timer</span>
          )}
          <button
            onClick={() => setShowRestTimer(true)}
            className="flex items-center gap-2 text-sm font-medium text-primary min-h-[44px]"
          >
            <span>⏲</span>
            {timerActive ? 'Open' : 'Start'}
          </button>
        </div>

        <div className="px-4 space-y-4 pb-safe-or-4">
          {/* Title / comment fields */}
          <div className="ios-section">
            <input
              type="text"
              placeholder="Title"
              defaultValue={workout.title ?? ''}
              className="ios-row w-full text-sm font-medium bg-transparent outline-none min-h-[44px]"
            />
            <input
              type="text"
              placeholder="Comment"
              defaultValue={workout.comment ?? ''}
              className="ios-row w-full text-sm text-muted-foreground bg-transparent outline-none min-h-[44px]"
            />
          </div>

          {/* Exercises */}
          {workout.exercises.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Exercises</p>
              <div className="space-y-3">
                {workout.exercises.map((we) => {
                  const completedSets = we.sets.filter(s => s.is_completed).length;
                  const totalSets = we.sets.length;
                  const allDone = totalSets > 0 && completedSets === totalSets;

                  return (
                    <div key={we.uuid} className="ios-section">
                      {/* Exercise header */}
                      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                        <div className="flex-1 min-w-0">
                          <p className={`font-semibold text-sm ${allDone ? 'text-muted-foreground' : ''}`}>
                            {we.exercise?.title ?? 'Unknown Exercise'}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-xs text-muted-foreground">
                              {completedSets} / {totalSets} sets
                            </p>
                            {we.exercise?.primary_muscles?.slice(0, 1).map(m => (
                              <span
                                key={m}
                                className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold border capitalize ${getMuscleChipClass(m)}`}
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </div>
                        {allDone && (
                          <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                            <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                          </div>
                        )}
                      </div>

                      {/* Column headers */}
                      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border bg-secondary/30">
                        <div className="w-6 text-center text-[11px] font-medium text-muted-foreground">Set</div>
                        <div className="flex-1 text-right text-[11px] font-medium text-muted-foreground">Weight</div>
                        <div className="w-4" />
                        <div className="flex-1 text-right text-[11px] font-medium text-muted-foreground">Reps</div>
                        <div className="w-11" />
                      </div>

                      {/* Sets */}
                      {we.sets.map((set, idx) => (
                        <SetRow
                          key={set.uuid}
                          setNumber={idx + 1}
                          set={set}
                          workoutExerciseUuid={we.uuid}
                          onUpdate={updateSet}
                        />
                      ))}

                      {/* Add set */}
                      <button
                        onClick={() => handleAddSet(we.uuid)}
                        className="flex items-center gap-2 px-4 py-3 text-primary text-sm font-medium w-full min-h-[44px]"
                      >
                        <Plus className="h-4 w-4" />
                        Add Set
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
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

          {/* Finish button */}
          <div className="ios-section">
            <button
              onClick={() => setShowFinishModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-3.5 text-primary text-sm font-semibold w-full min-h-[44px]"
            >
              <Check className="h-4 w-4" />
              Finish Workout
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
    </>
  );
}
