'use client';

import { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Plus, Search, Trash2, X } from 'lucide-react';
import type { WorkoutPlan, WorkoutRoutine, WorkoutRoutineExercise, Exercise } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanWithRoutines extends WorkoutPlan {
  routines: WorkoutRoutine[];
}

interface RoutineWithExercises extends WorkoutRoutine {
  exercises: (WorkoutRoutineExercise & { exercise: Exercise })[];
  loaded: boolean;
}

// ─── Exercise selector sheet ──────────────────────────────────────────────────

function ExerciseSelectorSheet({
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

  const grouped: Record<string, Exercise[]> = {};
  for (const ex of exercises) {
    const muscle = ex.primary_muscles[0] ?? 'Other';
    if (!grouped[muscle]) grouped[muscle] = [];
    grouped[muscle].push(ex);
  }
  const groups = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950">
      <div className="flex items-center justify-between px-4 pt-14 pb-3 border-b border-zinc-800">
        <button onClick={onClose} className="text-blue-400 font-medium text-base">Cancel</button>
        <h2 className="font-semibold text-zinc-100">Add Exercise</h2>
        <div className="w-14" />
      </div>
      <div className="px-4 py-2 border-b border-zinc-800">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            autoFocus
            type="text"
            placeholder="Search exercises"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-zinc-800 rounded-lg text-sm outline-none text-zinc-100 placeholder:text-zinc-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="h-4 w-4 text-zinc-400" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
        {loading ? (
          <p className="text-center py-8 text-zinc-400 text-sm">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="text-center py-8 text-zinc-400 text-sm">No exercises found</p>
        ) : (
          groups.map(([muscle, exs]) => (
            <div key={muscle}>
              <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-1 capitalize px-1">{muscle}</p>
              <div className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 divide-y divide-zinc-800">
                {exs.map((ex) => (
                  <button
                    key={ex.uuid}
                    onClick={() => onAdd(ex)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-zinc-800 transition-colors"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-sm text-zinc-100">{ex.title}</p>
                      <p className="text-xs text-zinc-400 capitalize">{ex.primary_muscles.join(', ')}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-zinc-500" />
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

// ─── Routine card ─────────────────────────────────────────────────────────────

function RoutineCard({
  planUuid,
  routine: initialRoutine,
  onDelete,
  onStartWorkout,
}: {
  planUuid: string;
  routine: WorkoutRoutine;
  onDelete: () => void;
  onStartWorkout: () => void;
}) {
  const [routine, setRoutine] = useState<RoutineWithExercises>({
    ...initialRoutine,
    exercises: [],
    loaded: false,
  });
  const [expanded, setExpanded] = useState(false);
  const [showExerciseSelector, setShowExerciseSelector] = useState(false);
  const [starting, setStarting] = useState(false);

  const loadExercises = useCallback(async () => {
    const res = await fetch(`/api/plans/${planUuid}/routines/${initialRoutine.uuid}/exercises`);
    const routineExercises = await res.json();

    const withDetails = await Promise.all(
      routineExercises.map(async (re: WorkoutRoutineExercise) => {
        const exRes = await fetch(`/api/exercises?search=${re.exercise_uuid}`);
        const exData = await exRes.json();
        const exercise = exData.find((e: Exercise) => e.uuid === re.exercise_uuid);
        return { ...re, exercise };
      })
    );

    setRoutine(prev => ({ ...prev, exercises: withDetails, loaded: true }));
  }, [planUuid, initialRoutine.uuid]);

  const handleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !routine.loaded) {
      await loadExercises();
    }
  };

  const handleAddExercise = async (exercise: Exercise) => {
    await fetch(`/api/plans/${planUuid}/routines/${initialRoutine.uuid}/exercises`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exerciseUuid: exercise.uuid }),
    });
    setShowExerciseSelector(false);
    await loadExercises();
  };

  const handleRemoveExercise = async (exerciseUuid: string) => {
    if (!confirm('Remove this exercise from the routine?')) return;
    await fetch(`/api/plans/${planUuid}/routines/${initialRoutine.uuid}/exercises/${exerciseUuid}`, {
      method: 'DELETE',
    });
    await loadExercises();
  };

  const handleStartWorkout = async () => {
    setStarting(true);
    const res = await fetch(`/api/plans/${planUuid}/routines/${initialRoutine.uuid}/start`, {
      method: 'POST',
    });
    await res.json();
    setStarting(false);
    onStartWorkout();
  };

  return (
    <>
      <div className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
        {/* Routine header */}
        <div className="flex items-center px-4 py-3">
          <button
            onClick={handleExpand}
            className="flex-1 flex items-center gap-2 text-left"
          >
            {expanded
              ? <ChevronDown className="h-4 w-4 text-zinc-400 flex-shrink-0" />
              : <ChevronRight className="h-4 w-4 text-zinc-400 flex-shrink-0" />
            }
            <span className="font-medium text-sm text-zinc-100">
              {initialRoutine.title ?? 'Untitled Routine'}
            </span>
            {routine.loaded && (
              <span className="text-xs text-zinc-400 ml-1">
                ({routine.exercises.length} exercise{routine.exercises.length !== 1 ? 's' : ''})
              </span>
            )}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleStartWorkout}
              disabled={starting}
              className="text-xs font-semibold text-blue-400 bg-blue-600/20 px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {starting ? 'Starting…' : 'Start'}
            </button>
            <button
              onClick={() => { if (confirm('Delete this routine?')) onDelete(); }}
              className="text-zinc-500 hover:text-red-400 transition-colors p-1"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Expanded exercises */}
        {expanded && (
          <div className="border-t border-zinc-800">
            {!routine.loaded ? (
              <p className="px-4 py-3 text-sm text-zinc-400">Loading…</p>
            ) : routine.exercises.length === 0 ? (
              <p className="px-4 py-3 text-sm text-zinc-400">No exercises yet</p>
            ) : (
              <div className="divide-y divide-zinc-800">
                {routine.exercises.map((re) => (
                  <div key={re.uuid} className="flex items-center px-4 py-2.5 gap-3">
                    <div className="flex-1">
                      <p className="text-sm text-zinc-100">{re.exercise?.title ?? 'Unknown'}</p>
                      {re.exercise && (
                        <p className="text-xs text-zinc-400 capitalize">
                          {re.exercise.primary_muscles.join(', ')}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveExercise(re.exercise_uuid)}
                      className="text-zinc-500 hover:text-red-400 transition-colors p-1"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowExerciseSelector(true)}
              className="flex items-center gap-2 px-4 py-3 text-blue-400 text-sm font-medium w-full border-t border-zinc-800"
            >
              <Plus className="h-4 w-4" />
              Add Exercise
            </button>
          </div>
        )}
      </div>

      {showExerciseSelector && (
        <ExerciseSelectorSheet
          onAdd={handleAddExercise}
          onClose={() => setShowExerciseSelector(false)}
        />
      )}
    </>
  );
}

// ─── Plan card ────────────────────────────────────────────────────────────────

function PlanCard({
  plan: initialPlan,
  onDelete,
  onStartWorkout,
}: {
  plan: PlanWithRoutines;
  onDelete: () => void;
  onStartWorkout: () => void;
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [expanded, setExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(initialPlan.title ?? '');
  const [addingRoutine, setAddingRoutine] = useState(false);
  const [newRoutineTitle, setNewRoutineTitle] = useState('');

  const saveTitle = async () => {
    if (!titleValue.trim()) { setEditingTitle(false); return; }
    const res = await fetch(`/api/plans/${plan.uuid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: titleValue.trim() }),
    });
    const updated = await res.json();
    setPlan(prev => ({ ...prev, title: updated.title }));
    setEditingTitle(false);
  };

  const refreshPlan = async () => {
    const res = await fetch(`/api/plans/${plan.uuid}`);
    const data = await res.json();
    setPlan(data);
  };

  const handleAddRoutine = async () => {
    if (!newRoutineTitle.trim()) return;
    await fetch(`/api/plans/${plan.uuid}/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newRoutineTitle.trim() }),
    });
    setNewRoutineTitle('');
    setAddingRoutine(false);
    await refreshPlan();
  };

  const handleDeleteRoutine = async (routineUuid: string) => {
    await fetch(`/api/plans/${plan.uuid}/routines/${routineUuid}`, { method: 'DELETE' });
    await refreshPlan();
  };

  return (
    <div className="rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
      {/* Plan header */}
      <div className="flex items-center px-4 py-4 gap-3">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex-1 flex items-center gap-2 text-left"
        >
          {expanded
            ? <ChevronDown className="h-5 w-5 text-zinc-400 flex-shrink-0" />
            : <ChevronRight className="h-5 w-5 text-zinc-400 flex-shrink-0" />
          }
          {editingTitle ? (
            <input
              autoFocus
              value={titleValue}
              onChange={e => setTitleValue(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
              onClick={e => e.stopPropagation()}
              className="flex-1 bg-transparent text-zinc-100 font-semibold text-base outline-none border-b border-blue-500"
            />
          ) : (
            <span
              className="font-semibold text-base text-zinc-100"
              onDoubleClick={e => { e.stopPropagation(); setEditingTitle(true); }}
            >
              {plan.title ?? 'Untitled Plan'}
            </span>
          )}
        </button>
        <span className="text-xs text-zinc-400">
          {plan.routines.length} routine{plan.routines.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => { if (confirm(`Delete "${plan.title ?? 'this plan'}"?`)) onDelete(); }}
          className="text-zinc-500 hover:text-red-400 transition-colors p-1"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Expanded routines */}
      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-3 space-y-3">
          {plan.routines.length === 0 && !addingRoutine && (
            <p className="text-sm text-zinc-400 text-center py-2">No routines yet</p>
          )}

          {plan.routines.map(routine => (
            <RoutineCard
              key={routine.uuid}
              planUuid={plan.uuid}
              routine={routine}
              onDelete={() => handleDeleteRoutine(routine.uuid)}
              onStartWorkout={onStartWorkout}
            />
          ))}

          {addingRoutine ? (
            <div className="flex gap-2">
              <input
                autoFocus
                type="text"
                placeholder="Routine name (e.g. Push Day)"
                value={newRoutineTitle}
                onChange={e => setNewRoutineTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddRoutine(); if (e.key === 'Escape') setAddingRoutine(false); }}
                className="flex-1 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500 rounded-lg px-3 py-2 text-sm outline-none border border-zinc-700 focus:border-blue-500"
              />
              <button
                onClick={handleAddRoutine}
                className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium"
              >
                Add
              </button>
              <button
                onClick={() => { setAddingRoutine(false); setNewRoutineTitle(''); }}
                className="text-zinc-400 px-2 py-2"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddingRoutine(true)}
              className="flex items-center gap-2 text-blue-400 text-sm font-medium py-1"
            >
              <Plus className="h-4 w-4" />
              Add Routine
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PlansPage() {
  const [plans, setPlans] = useState<PlanWithRoutines[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [newPlanTitle, setNewPlanTitle] = useState('');

  const fetchPlans = useCallback(async () => {
    const res = await fetch('/api/plans');
    const data = await res.json();
    setPlans(data.plans);
    setLoading(false);
  }, []);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const handleCreatePlan = async () => {
    if (!newPlanTitle.trim()) return;
    await fetch('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newPlanTitle.trim() }),
    });
    setNewPlanTitle('');
    setCreatingPlan(false);
    await fetchPlans();
  };

  const handleDeletePlan = async (uuid: string) => {
    await fetch(`/api/plans/${uuid}`, { method: 'DELETE' });
    await fetchPlans();
  };

  const handleStartWorkout = () => {
    // Navigate to workout page (workout is now current)
    window.location.href = `/workout`;
  };

  return (
    <main className="tab-content bg-zinc-950">
      <div className="px-4 pt-14 pb-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-zinc-100">Plans</h1>
          <button
            onClick={() => setCreatingPlan(true)}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-xl text-sm font-semibold"
          >
            <Plus className="h-4 w-4" />
            New Plan
          </button>
        </div>

        {creatingPlan && (
          <div className="flex gap-2 mb-4">
            <input
              autoFocus
              type="text"
              placeholder="Plan name (e.g. 5-Day Split)"
              value={newPlanTitle}
              onChange={e => setNewPlanTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreatePlan(); if (e.key === 'Escape') setCreatingPlan(false); }}
              className="flex-1 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500 rounded-xl px-4 py-2.5 text-sm outline-none border border-zinc-700 focus:border-blue-500"
            />
            <button
              onClick={handleCreatePlan}
              className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold"
            >
              Create
            </button>
            <button
              onClick={() => { setCreatingPlan(false); setNewPlanTitle(''); }}
              className="text-zinc-400 px-2"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {loading ? (
          <p className="text-center py-12 text-zinc-400 text-sm">Loading…</p>
        ) : plans.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-zinc-400 text-sm mb-4">No plans yet</p>
            <p className="text-zinc-500 text-xs">Create a plan to organise your workout routines</p>
          </div>
        ) : (
          <div className="space-y-3">
            {plans.map(plan => (
              <PlanCard
                key={plan.uuid}
                plan={plan}
                onDelete={() => handleDeletePlan(plan.uuid)}
                onStartWorkout={handleStartWorkout}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
