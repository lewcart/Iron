'use client';

import { useState, useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ChevronUp, Plus, Search, Trash2, X } from 'lucide-react';
import type { WorkoutPlan, WorkoutRoutine, WorkoutRoutineExercise, Exercise } from '@/types';
import { formatSetsReps } from './utils';
import { queryKeys } from '@/lib/api/query-keys';
import { fetchPlansWithRoutines, type PlanWithRoutines } from '@/lib/api/plans';
import { fetchExerciseCatalog } from '@/lib/api/exercises';
import { fetchJson } from '@/lib/api/client';
import { apiBase } from '@/lib/api/client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoutineWithExercises extends WorkoutRoutine {
  exercises: WorkoutRoutineExercise[];
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
  const [search, setSearch] = useState('');
  const { data: exercises = [], isPending: loading } = useQuery({
    queryKey: queryKeys.exercises.catalog(),
    queryFn: fetchExerciseCatalog,
    staleTime: 15 * 60 * 1000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return exercises;
    const q = search.trim().toLowerCase();
    return exercises.filter(
      (ex) =>
        ex.title.toLowerCase().includes(q) ||
        ex.alias.some((a) => a.toLowerCase().includes(q))
    );
  }, [exercises, search]);

  const grouped: Record<string, Exercise[]> = {};
  for (const ex of filtered) {
    const muscle = ex.primary_muscles[0] ?? 'Other';
    if (!grouped[muscle]) grouped[muscle] = [];
    grouped[muscle].push(ex);
  }
  const groups = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between px-4 pt-safe pb-3 border-b border-border">
        <button onClick={onClose} className="text-primary font-medium text-base">Cancel</button>
        <h2 className="font-semibold text-foreground">Add Exercise</h2>
        <div className="w-14" />
      </div>
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
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
        {loading ? (
          <p className="text-center py-8 text-muted-foreground text-sm">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground text-sm">No exercises found</p>
        ) : (
          groups.map(([muscle, exs]) => (
            <div key={muscle}>
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 capitalize px-1">{muscle}</p>
              <div className="ios-section border border-border">
                {exs.map((ex) => (
                  <button
                    key={ex.uuid}
                    onClick={() => onAdd(ex)}
                    className="ios-row w-full text-left gap-3 hover:bg-muted transition-colors"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-sm text-foreground">{ex.title}</p>
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

// ─── Routine card ─────────────────────────────────────────────────────────────

function RoutineCard({
  planUuid,
  routine: initialRoutine,
  onDelete,
  onStartWorkout,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  planUuid: string;
  routine: WorkoutRoutine;
  onDelete: () => void;
  onStartWorkout: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const queryClient = useQueryClient();
  const invalidatePlans = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.plans() });

  const [routine, setRoutine] = useState<RoutineWithExercises>({
    ...initialRoutine,
    exercises: [],
    loaded: false,
  });
  const [expanded, setExpanded] = useState(false);
  const [showExerciseSelector, setShowExerciseSelector] = useState(false);
  const [starting, setStarting] = useState(false);

  const loadExercises = useCallback(async () => {
    const res = await fetch(`${apiBase()}/api/plans/${planUuid}/routines/${initialRoutine.uuid}/exercises`);
    const routineExercises = await res.json();

    setRoutine(prev => ({ ...prev, exercises: routineExercises, loaded: true }));
  }, [planUuid, initialRoutine.uuid]);

  const handleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !routine.loaded) {
      await loadExercises();
    }
  };

  const handleAddExercise = async (exercise: Exercise) => {
    await fetch(`${apiBase()}/api/plans/${planUuid}/routines/${initialRoutine.uuid}/exercises`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exerciseUuid: exercise.uuid }),
    });
    setShowExerciseSelector(false);
    await loadExercises();
    invalidatePlans();
  };

  const handleRemoveExercise = async (exerciseUuid: string) => {
    if (!confirm('Remove this exercise from the routine?')) return;
    await fetch(`${apiBase()}/api/plans/${planUuid}/routines/${initialRoutine.uuid}/exercises/${exerciseUuid}`, {
      method: 'DELETE',
    });
    await loadExercises();
    invalidatePlans();
  };

  const handleStartWorkout = async () => {
    setStarting(true);
    const res = await fetch(`${apiBase()}/api/plans/${planUuid}/routines/${initialRoutine.uuid}/start`, {
      method: 'POST',
    });
    await res.json();
    setStarting(false);
    invalidatePlans();
    onStartWorkout();
  };

  return (
    <>
      <div className="ios-section border border-border">
        {/* Routine header */}
        <div className="flex items-center px-4 py-3">
          <button
            onClick={handleExpand}
            className="flex-1 flex items-center gap-2 text-left"
          >
            {expanded
              ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            }
            <span className="font-medium text-sm text-foreground">
              {initialRoutine.title ?? 'Untitled Routine'}
            </span>
            {routine.loaded && (
              <span className="text-xs text-muted-foreground ml-1">
                ({routine.exercises.length} exercise{routine.exercises.length !== 1 ? 's' : ''})
              </span>
            )}
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onMoveUp?.(); }}
              disabled={isFirst}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 disabled:opacity-20"
              aria-label="Move up"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onMoveDown?.(); }}
              disabled={isLast}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 disabled:opacity-20"
              aria-label="Move down"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            <button
              onClick={handleStartWorkout}
              disabled={starting}
              className="text-xs font-semibold text-primary bg-primary/20 px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {starting ? 'Starting…' : 'Start'}
            </button>
            <button
              onClick={() => { if (confirm('Delete this routine?')) onDelete(); }}
              className="text-muted-foreground hover:text-destructive transition-colors p-1"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Expanded exercises */}
        {expanded && (
          <div className="border-t border-border">
            {!routine.loaded ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>
            ) : routine.exercises.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">No exercises yet</p>
            ) : (
              <div className="divide-y divide-border">
                {routine.exercises.map((re) => {
                  const setsReps = formatSetsReps(re.sets ?? []);
                  return (
                    <div key={re.uuid} className="flex items-center px-4 py-2.5 gap-3">
                      <div className="flex-1">
                        <p className="text-sm text-foreground">{re.exercise_title ?? 'Unknown'}</p>
                        {setsReps && (
                          <p className="text-xs text-muted-foreground mt-0.5">{setsReps}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemoveExercise(re.exercise_uuid)}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              onClick={() => setShowExerciseSelector(true)}
              className="flex items-center gap-2 px-4 py-3 text-primary text-sm font-medium w-full border-t border-border"
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
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  plan: PlanWithRoutines;
  onDelete: () => void;
  onStartWorkout: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const queryClient = useQueryClient();
  const invalidatePlans = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.plans() });

  const [plan, setPlan] = useState(initialPlan);
  const [expanded, setExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(initialPlan.title ?? '');
  const [addingRoutine, setAddingRoutine] = useState(false);
  const [newRoutineTitle, setNewRoutineTitle] = useState('');

  const saveTitle = async () => {
    if (!titleValue.trim()) { setEditingTitle(false); return; }
    const res = await fetch(`${apiBase()}/api/plans/${plan.uuid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: titleValue.trim() }),
    });
    const updated = await res.json();
    setPlan(prev => ({ ...prev, title: updated.title }));
    setEditingTitle(false);
    invalidatePlans();
  };

  const refreshPlan = async () => {
    const res = await fetch(`${apiBase()}/api/plans/${plan.uuid}`);
    const data = await res.json();
    setPlan(data);
  };

  const handleAddRoutine = async () => {
    if (!newRoutineTitle.trim()) return;
    await fetch(`${apiBase()}/api/plans/${plan.uuid}/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newRoutineTitle.trim() }),
    });
    setNewRoutineTitle('');
    setAddingRoutine(false);
    await refreshPlan();
    invalidatePlans();
  };

  const handleDeleteRoutine = async (routineUuid: string) => {
    await fetch(`${apiBase()}/api/plans/${plan.uuid}/routines/${routineUuid}`, { method: 'DELETE' });
    await refreshPlan();
    invalidatePlans();
  };

  const handleMoveRoutine = async (index: number, direction: 'up' | 'down') => {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= plan.routines.length) return;
    const a = plan.routines[index];
    const b = plan.routines[swapIndex];
    // Swap order_index values
    await Promise.all([
      fetch(`${apiBase()}/api/plans/${plan.uuid}/routines/${a.uuid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIndex: b.order_index }),
      }),
      fetch(`${apiBase()}/api/plans/${plan.uuid}/routines/${b.uuid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIndex: a.order_index }),
      }),
    ]);
    await refreshPlan();
    invalidatePlans();
  };

  return (
    <div className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
      {/* Plan header */}
      <div className="flex items-center px-4 py-4 gap-3">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex-1 flex items-center gap-2 text-left"
        >
          {expanded
            ? <ChevronDown className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            : <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          }
          {editingTitle ? (
            <input
              autoFocus
              value={titleValue}
              onChange={e => setTitleValue(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
              onClick={e => e.stopPropagation()}
              className="flex-1 bg-transparent text-foreground font-semibold text-base outline-none border-b border-primary"
            />
          ) : (
            <span
              className="font-semibold text-base text-foreground"
              onDoubleClick={e => { e.stopPropagation(); setEditingTitle(true); }}
            >
              {plan.title ?? 'Untitled Plan'}
            </span>
          )}
        </button>
        <span className="text-xs text-muted-foreground">
          {plan.routines.length} routine{plan.routines.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onMoveUp?.(); }}
          disabled={isFirst}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 disabled:opacity-20"
          aria-label="Move plan up"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onMoveDown?.(); }}
          disabled={isLast}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 disabled:opacity-20"
          aria-label="Move plan down"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
        <button
          onClick={() => { if (confirm(`Delete "${plan.title ?? 'this plan'}"?`)) onDelete(); }}
          className="text-muted-foreground hover:text-destructive transition-colors p-1"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Expanded routines */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {plan.routines.length === 0 && !addingRoutine && (
            <p className="text-sm text-muted-foreground text-center py-2">No routines yet</p>
          )}

          {plan.routines.map((routine, i) => (
            <RoutineCard
              key={routine.uuid}
              planUuid={plan.uuid}
              routine={routine}
              onDelete={() => handleDeleteRoutine(routine.uuid)}
              onStartWorkout={onStartWorkout}
              onMoveUp={() => handleMoveRoutine(i, 'up')}
              onMoveDown={() => handleMoveRoutine(i, 'down')}
              isFirst={i === 0}
              isLast={i === plan.routines.length - 1}
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
                className="flex-1 bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-input focus-visible:border-primary"
              />
              <button
                onClick={handleAddRoutine}
                className="bg-primary text-primary-foreground px-3 py-2 rounded-lg text-sm font-medium"
              >
                Add
              </button>
              <button
                onClick={() => { setAddingRoutine(false); setNewRoutineTitle(''); }}
                className="text-muted-foreground px-2 py-2"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddingRoutine(true)}
              className="flex items-center gap-2 text-primary text-sm font-medium py-1"
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

function PlansListSkeleton() {
  return (
    <div className="space-y-3 animate-pulse px-4" aria-hidden>
      <div className="h-32 rounded-2xl bg-muted/60 border border-border" />
      <div className="h-32 rounded-2xl bg-muted/60 border border-border" />
    </div>
  );
}

export default function PlansPage() {
  const queryClient = useQueryClient();
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [newPlanTitle, setNewPlanTitle] = useState('');

  const { data: plans = [], isPending, isPlaceholderData } = useQuery({
    queryKey: queryKeys.plans(),
    queryFn: fetchPlansWithRoutines,
    staleTime: 120_000,
    placeholderData: (p) => p,
  });

  const createPlanMut = useMutation({
    mutationFn: (title: string) =>
      fetchJson<WorkoutPlan>('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      }),
    onMutate: async (title) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.plans() });
      const prev = queryClient.getQueryData<PlanWithRoutines[]>(queryKeys.plans());
      const optimistic: PlanWithRoutines = {
        uuid: `optimistic-${Date.now()}`,
        title: title.trim(),
        order_index: (prev?.length ?? 0),
        routines: [],
      };
      queryClient.setQueryData<PlanWithRoutines[]>(queryKeys.plans(), (old) => [
        ...(old ?? []),
        optimistic,
      ]);
      return { prev };
    },
    onError: (_err, _title, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.plans(), ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plans() });
    },
  });

  const deletePlanMut = useMutation({
    mutationFn: (uuid: string) => fetch(`${apiBase()}/api/plans/${uuid}`, { method: 'DELETE' }).then((r) => {
      if (!r.ok) throw new Error('Delete failed');
    }),
    onMutate: async (uuid) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.plans() });
      const prev = queryClient.getQueryData<PlanWithRoutines[]>(queryKeys.plans());
      queryClient.setQueryData<PlanWithRoutines[]>(
        queryKeys.plans(),
        (old) => (old ?? []).filter((p) => p.uuid !== uuid)
      );
      return { prev };
    },
    onError: (_err, _uuid, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.plans(), ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plans() });
    },
  });

  const handleCreatePlan = () => {
    if (!newPlanTitle.trim()) return;
    createPlanMut.mutate(newPlanTitle.trim(), {
      onSuccess: () => {
        setNewPlanTitle('');
        setCreatingPlan(false);
      },
    });
  };

  const handleDeletePlan = (uuid: string) => {
    deletePlanMut.mutate(uuid);
  };

  const loading = isPending && plans.length === 0;

  const handleMovePlan = async (index: number, direction: 'up' | 'down') => {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= plans.length) return;
    const a = plans[index];
    const b = plans[swapIndex];
    await Promise.all([
      fetch(`${apiBase()}/api/plans/${a.uuid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIndex: b.order_index }),
      }),
      fetch(`${apiBase()}/api/plans/${b.uuid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIndex: a.order_index }),
      }),
    ]);
    await queryClient.invalidateQueries({ queryKey: queryKeys.plans() });
  };

  const handleStartWorkout = () => {
    window.location.href = `/workout`;
  };

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-safe pb-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Plans</h1>
          <button
            onClick={() => setCreatingPlan(true)}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded-xl text-sm font-semibold"
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
              className="flex-1 bg-secondary rounded-xl px-4 py-2.5 text-sm outline-none border border-input focus-visible:border-primary"
            />
            <button
              onClick={handleCreatePlan}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold"
            >
              Create
            </button>
            <button
              onClick={() => { setCreatingPlan(false); setNewPlanTitle(''); }}
              className="text-muted-foreground px-2"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {loading ? (
          <PlansListSkeleton />
        ) : plans.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-sm mb-4">No plans yet</p>
            <p className="text-muted-foreground text-xs">Create a plan to organise your workout routines</p>
          </div>
        ) : (
          <div className="space-y-3">
            {plans.map((plan, i) => (
              <PlanCard
                key={plan.uuid}
                plan={plan}
                onDelete={() => handleDeletePlan(plan.uuid)}
                onStartWorkout={handleStartWorkout}
                onMoveUp={() => handleMovePlan(i, 'up')}
                onMoveDown={() => handleMovePlan(i, 'down')}
                isFirst={i === 0}
                isLast={i === plans.length - 1}
              />
            ))}
          </div>
        )}
        {isPlaceholderData && plans.length > 0 ? (
          <p className="text-center text-[11px] text-muted-foreground mt-2">Cached plans · refreshing</p>
        ) : null}
      </div>
    </main>
  );
}
