'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Check, ChevronRight, Plus, Search, X } from 'lucide-react';
import type { Workout, WorkoutExercise, WorkoutSet, Exercise } from '@/types';

interface WorkoutWithExercises extends Workout {
  exercises: (WorkoutExercise & {
    exercise: Exercise;
    sets: WorkoutSet[];
  })[];
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

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Rest timer ──────────────────────────────────────────────────────────────
const REST_PRESETS = [60, 90, 120, 150, 180];

function RestTimerSheet({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = (seconds: number) => {
    setSelected(seconds);
    setRemaining(seconds);
    setRunning(true);
  };

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) {
          clearInterval(intervalRef.current!);
          setRunning(false);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current!);
  }, [running]);

  const cancel = () => {
    clearInterval(intervalRef.current!);
    setRunning(false);
    setSelected(null);
    setRemaining(0);
  };

  const progress = selected ? (remaining / selected) : 0;
  const circumference = 2 * Math.PI * 100;
  const dashOffset = circumference * (1 - progress);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-14 pb-3 border-b border-border">
        <button onClick={onClose} className="text-primary font-medium text-base">Close</button>
        <h2 className="font-semibold">Rest Timer</h2>
        <div className="w-14" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-8 p-8">
        {!running ? (
          <>
            <p className="text-muted-foreground text-sm">Select a rest duration</p>
            <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
              {REST_PRESETS.map(s => (
                <button
                  key={s}
                  onClick={() => start(s)}
                  className="aspect-square rounded-full bg-secondary flex items-center justify-center text-base font-semibold"
                >
                  {formatTime(s)}
                </button>
              ))}
              <button
                onClick={() => start(30)}
                className="aspect-square rounded-full bg-secondary flex items-center justify-center text-base font-semibold"
              >
                0:30
              </button>
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
                  stroke={remaining === 0 ? '#ef4444' : 'hsl(var(--primary))'}
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  style={{ transition: 'stroke-dashoffset 1s linear' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-5xl font-light tabular-nums ${remaining === 0 ? 'text-red-500' : ''}`}>
                  {formatTime(remaining)}
                </span>
                <span className="text-sm text-muted-foreground mt-1">{formatTime(selected ?? 0)}</span>
              </div>
            </div>

            {/* Controls */}
            <div className="flex gap-4">
              <button
                onClick={() => setRemaining(r => Math.max(0, r - 10))}
                className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center font-semibold text-sm"
              >
                −10s
              </button>
              <button
                onClick={() => setRemaining(r => r + 10)}
                className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center font-semibold text-sm"
              >
                +10s
              </button>
              <button
                onClick={cancel}
                className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center font-semibold text-sm"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

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

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    fetch(`/api/exercises?${params}`)
      .then(r => r.json())
      .then(data => { setExercises(data); setLoading(false); });
  }, [search]);

  // Group by primary muscle
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
        <button onClick={onClose} className="text-primary font-medium text-base">Cancel</button>
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
            className="w-full pl-9 pr-4 py-2 bg-secondary rounded-lg text-sm outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
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
                    className="ios-row w-full text-left"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-sm">{ex.title}</p>
                      <p className="text-xs text-muted-foreground capitalize">{ex.primary_muscles.join(', ')}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
          className="w-full text-right text-sm font-medium bg-transparent outline-none"
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
          className="w-full text-right text-sm font-medium bg-transparent outline-none"
        />
        <span className="text-xs text-muted-foreground">reps</span>
      </div>

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

// ─── Main page ────────────────────────────────────────────────────────────────
export default function WorkoutPage() {
  const [workout, setWorkout] = useState<WorkoutWithExercises | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExercises, setShowExercises] = useState(false);
  const [showRestTimer, setShowRestTimer] = useState(false);

  const elapsed = useElapsed(workout?.start_time ?? null);

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

  const startWorkout = async () => {
    await fetch('/api/workouts', { method: 'POST' });
    await fetchCurrentWorkout();
  };

  const finishWorkout = async () => {
    if (!workout) return;
    if (!confirm('Finish this workout?')) return;
    await fetch(`/api/workouts/${workout.uuid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'finish' }),
    });
    setWorkout(null);
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
    return (
      <main className="tab-content bg-background">
        <div className="px-4 pt-14 pb-4">
          <h1 className="text-2xl font-bold">Workout</h1>
        </div>
        <div className="px-4">
          <div className="ios-section">
            <button
              onClick={startWorkout}
              className="w-full py-3.5 text-center text-primary font-semibold text-base"
            >
              Start Workout
            </button>
          </div>
          <p className="text-center text-muted-foreground text-sm mt-8">
            Start a workout to begin tracking your session.
          </p>
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
      <main className="tab-content bg-background">
        {/* Nav bar */}
        <div className="flex items-center justify-between px-4 pt-14 pb-3">
          <h1 className="text-lg font-semibold truncate flex-1">
            {workout.title || workout.exercises.map(e => e.exercise?.title).filter(Boolean).slice(0, 2).join(', ') || 'Workout'}
          </h1>
          <button
            onClick={finishWorkout}
            className="ml-4 text-primary font-semibold text-sm"
          >
            Finish
          </button>
        </div>

        {/* Timer banner */}
        <div className="mx-4 mb-3 rounded-xl bg-secondary/60 flex items-center justify-between px-4 py-2.5">
          <button className="flex items-center gap-2 text-sm font-mono font-medium">
            <span className="text-muted-foreground">⏱</span>
            {formatTime(elapsed)}
          </button>
          <button
            onClick={() => setShowRestTimer(true)}
            className="flex items-center gap-2 text-sm font-medium text-primary"
          >
            <span>⏲</span>
            Rest
          </button>
        </div>

        <div className="px-4 space-y-4 pb-4">
          {/* Title / comment fields */}
          <div className="ios-section">
            <input
              type="text"
              placeholder="Title"
              defaultValue={workout.title ?? ''}
              className="ios-row w-full text-sm font-medium bg-transparent outline-none"
            />
            <input
              type="text"
              placeholder="Comment"
              defaultValue={workout.comment ?? ''}
              className="ios-row w-full text-sm text-muted-foreground bg-transparent outline-none"
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
                        <div className="flex-1">
                          <p className={`font-semibold text-sm ${allDone ? 'text-muted-foreground' : ''}`}>
                            {we.exercise?.title ?? 'Unknown Exercise'}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {completedSets} / {totalSets} sets
                          </p>
                        </div>
                        {allDone && (
                          <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
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
                        <div className="w-8" />
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
                        className="flex items-center gap-2 px-4 py-3 text-primary text-sm font-medium w-full"
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
              className="flex items-center gap-2 px-4 py-3.5 text-primary text-sm font-medium w-full"
            >
              <Plus className="h-4 w-4" />
              Add Exercises
            </button>
          </div>

          {/* Finish button */}
          <div className="ios-section">
            <button
              onClick={finishWorkout}
              className="flex items-center justify-center gap-2 px-4 py-3.5 text-primary text-sm font-semibold w-full"
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
        <RestTimerSheet onClose={() => setShowRestTimer(false)} />
      )}
    </>
  );
}
