'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Check, Plus, Search, Star, Trash2, X } from 'lucide-react';
import type { Exercise } from '@/types';
import { apiBase } from '@/lib/api/client';
import { useExercises } from '@/lib/useLocalDB';
import {
  usePlansFull,
  type LocalPlanWithRoutines,
  type LocalRoutineWithExercises,
  type LocalRoutineExerciseEntry,
} from '@/lib/useLocalDB-plans';
import {
  createPlan,
  updatePlanTitle,
  deletePlan,
  activatePlan,
  reorderPlans,
  createRoutine,
  deleteRoutine,
  reorderRoutines,
  addRoutineExercise,
  removeRoutineExercise,
  updateRoutineExerciseComment,
  setRoutineExerciseGoalWindow,
  addRoutineSet,
  updateRoutineSet,
  deleteRoutineSet,
} from '@/lib/mutations-plans';
import type { LocalWorkoutRoutineSet } from '@/db/local';
import { REP_WINDOWS, REP_WINDOW_ORDER, type RepWindow } from '@/lib/rep-windows';
import { RoutineVolumeFit } from '@/components/RoutineVolumeFit';

// Trans-mapped colors for active window pills in the picker. Mirrors the
// visual language on the workout exercise card so the editor and the in-
// session card use the same palette.
const WINDOW_ACTIVE_STYLE: Record<RepWindow, string> = {
  strength:  'bg-sky-400 text-white',
  power:     'bg-sky-500/30 text-sky-200 ring-1 ring-sky-400/50',
  build:     'bg-purple-500/30 text-purple-200 ring-1 ring-purple-400/50',
  pump:      'bg-pink-500/30 text-pink-200 ring-1 ring-pink-400/50',
  endurance: 'bg-pink-400 text-white',
};

// Local-first /plans. Reads come from useLiveQuery (Dexie); writes go through
// mutations-plans.ts which writes to Dexie + scheduleSync. The page renders
// instantly on mount because Dexie is already populated by the sync engine
// in the background.
//
// Compared to the previous version (PR #14 and earlier):
// - No useQuery/useMutation, no queryClient invalidation cascades
// - No `loaded` flags or per-routine fetch — everything is in usePlansFull
// - Optimistic updates are free (mutations-plans writes Dexie immediately,
//   useLiveQuery picks up the change on the next tick)

// ─── Exercise selector sheet ──────────────────────────────────────────────────

function ExerciseSelectorSheet({
  onAdd,
  onClose,
}: {
  onAdd: (exercise: Exercise) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  // useExercises reads from Dexie — no spinner needed beyond the brief
  // first-render tick where useLiveQuery returns its default [].
  const exercises = useExercises({ search: search.trim().length >= 2 ? search.trim() : undefined });

  const filtered = useMemo(() => {
    if (!search.trim()) return exercises;
    return exercises;
  }, [exercises, search]);

  const grouped: Record<string, typeof filtered> = {};
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
        {groups.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground text-sm">No exercises found</p>
        ) : (
          groups.map(([muscle, exs]) => (
            <div key={muscle}>
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 capitalize px-1">{muscle}</p>
              <div className="ios-section border border-border">
                {exs.map((ex) => (
                  <button
                    key={ex.uuid}
                    onClick={() => onAdd(ex as unknown as Exercise)}
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

function formatSet(s: LocalWorkoutRoutineSet, trackingMode: 'reps' | 'time' = 'reps'): string {
  if (trackingMode === 'time') {
    const d = s.target_duration_seconds;
    if (d == null || d <= 0) return '—';
    if (d < 60) return `${d}s`;
    return `${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}`;
  }
  if (s.min_repetitions != null && s.max_repetitions != null) {
    return s.min_repetitions === s.max_repetitions
      ? `${s.min_repetitions}`
      : `${s.min_repetitions}–${s.max_repetitions}`;
  }
  if (s.min_repetitions != null) return `${s.min_repetitions}`;
  if (s.max_repetitions != null) return `${s.max_repetitions}`;
  return '—';
}

function RoutineCard({
  planUuid,
  routine,
  onStartWorkout,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  planUuid: string;
  routine: LocalRoutineWithExercises;
  onStartWorkout: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showExerciseSelector, setShowExerciseSelector] = useState(false);
  const [starting, setStarting] = useState(false);
  // editingSet drives the inline-edit UI for a routine set. `mode` is
  // captured at edit-start time from the parent exercise so a mid-edit
  // mode flip (vanishingly unlikely in single-user) doesn't strand a stale
  // input shape. min/max are used for reps mode; durationSeconds for time mode.
  const [editingSet, setEditingSet] = useState<{
    uuid: string;
    mode: 'reps' | 'time';
    min: string;
    max: string;
    durationSeconds: string;
  } | null>(null);
  const [editingNotes, setEditingNotes] = useState<{ exerciseUuid: string; value: string } | null>(null);

  const handleAddExercise = async (exercise: Exercise) => {
    await addRoutineExercise({
      workout_routine_uuid: routine.uuid,
      exercise_uuid: exercise.uuid,
    });
    setShowExerciseSelector(false);
    // useLiveQuery picks up the new row automatically — no refetch needed.
  };

  const handleRemoveExercise = async (routineExerciseUuid: string) => {
    if (!confirm('Remove this exercise from the routine?')) return;
    await removeRoutineExercise(routineExerciseUuid);
  };

  const handleAddSet = async (routineExerciseUuid: string, mode: 'reps' | 'time') => {
    const setUuid = await addRoutineSet({ workout_routine_exercise_uuid: routineExerciseUuid });
    setEditingSet({ uuid: setUuid, mode, min: '', max: '', durationSeconds: '' });
  };

  const handleSaveSet = async () => {
    if (!editingSet) return;
    if (editingSet.mode === 'time') {
      const dRaw = editingSet.durationSeconds.trim();
      const dVal = dRaw === '' ? null : Number(dRaw);
      await updateRoutineSet(editingSet.uuid, {
        target_duration_seconds: Number.isFinite(dVal) && dVal !== null && dVal > 0 ? dVal : null,
        // Defensively null reps fields so a mode flip doesn't leave stale rep
        // numbers visible alongside the new duration target.
        min_repetitions: null,
        max_repetitions: null,
      });
    } else {
      const minVal = editingSet.min.trim() === '' ? null : Number(editingSet.min);
      const maxVal = editingSet.max.trim() === '' ? null : Number(editingSet.max);
      await updateRoutineSet(editingSet.uuid, {
        min_repetitions: Number.isFinite(minVal) ? minVal : null,
        max_repetitions: Number.isFinite(maxVal) ? maxVal : null,
        target_duration_seconds: null,
      });
    }
    setEditingSet(null);
  };

  const handleDeleteSet = async (setUuid: string) => {
    await deleteRoutineSet(setUuid);
    if (editingSet?.uuid === setUuid) setEditingSet(null);
  };

  const handleSaveNotes = async () => {
    if (!editingNotes) return;
    const { exerciseUuid, value } = editingNotes;
    await updateRoutineExerciseComment(exerciseUuid, value.trim() || null);
    setEditingNotes(null);
  };

  // Start-from-routine still goes through the API for now — that route
  // creates the workout + exercises + sets server-side and runs PB lookup.
  // Local-first port deferred to a follow-up since it duplicates the
  // existing logic in workout/page.tsx startWorkoutFromRoutine.
  const handleStartWorkout = async () => {
    setStarting(true);
    try {
      const res = await fetch(`${apiBase()}/api/plans/${planUuid}/routines/${routine.uuid}/start`, {
        method: 'POST',
      });
      await res.json();
    } finally {
      setStarting(false);
    }
    onStartWorkout();
  };

  return (
    <>
      <div className="ios-section border border-border">
        {/* Routine header */}
        <div className="flex items-center px-4 py-3">
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex-1 flex items-center gap-2 text-left"
          >
            {expanded
              ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            }
            <span className="font-medium text-sm text-foreground">
              {routine.title ?? 'Untitled Routine'}
            </span>
            <span className="text-xs text-muted-foreground ml-1">
              ({routine.exercises.length} exercise{routine.exercises.length !== 1 ? 's' : ''})
            </span>
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
              onClick={() => {
                if (confirm('Delete this routine?')) deleteRoutine(routine.uuid);
              }}
              className="text-muted-foreground hover:text-destructive transition-colors p-1"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Expanded exercises */}
        {expanded && (
          <div className="border-t border-border">
            {routine.exercises.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">No exercises yet</p>
            ) : (
              <div className="divide-y divide-border">
                {routine.exercises.map((re: LocalRoutineExerciseEntry) => (
                  <div key={re.uuid}>
                    {/* Exercise row */}
                    <div className="flex items-start px-4 py-2.5 gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{re.exercise?.title ?? ''}</p>
                        {editingNotes?.exerciseUuid === re.uuid ? (
                          <div className="flex items-center gap-1.5 mt-1">
                            <input
                              autoFocus
                              type="text"
                              placeholder="Add note (e.g. pause at bottom)"
                              value={editingNotes.value}
                              onChange={e => setEditingNotes(prev => prev ? { ...prev, value: e.target.value } : prev)}
                              onKeyDown={e => { if (e.key === 'Enter') handleSaveNotes(); if (e.key === 'Escape') setEditingNotes(null); }}
                              className="flex-1 bg-background border border-input rounded px-2 py-0.5 text-xs outline-none focus:border-primary"
                            />
                            <button onClick={handleSaveNotes} className="text-primary p-0.5" aria-label="Save notes">
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => setEditingNotes(null)} className="text-muted-foreground p-0.5" aria-label="Cancel">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditingNotes({ exerciseUuid: re.uuid, value: re.comment ?? '' })}
                            className="mt-0.5 text-left"
                          >
                            {re.comment
                              ? <span className="text-xs text-muted-foreground italic">{re.comment}</span>
                              : <span className="text-xs text-muted-foreground/50">Add note…</span>
                            }
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemoveExercise(re.uuid)}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1 flex-shrink-0"
                        aria-label="Remove exercise"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {/* Goal-window picker — only meaningful for reps-mode
                        exercises. Tap an active window to clear; tap an
                        inactive window to assign. */}
                    {(re.exercise?.tracking_mode ?? 'reps') === 'reps' && (
                      <div className="flex gap-1 px-4 pb-2">
                        {REP_WINDOW_ORDER.filter(k => k !== 'endurance').map(key => {
                          const w = REP_WINDOWS[key];
                          const isActive = re.goal_window === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setRoutineExerciseGoalWindow(re.uuid, isActive ? null : key)}
                              className={
                                'flex-1 px-1 py-1 rounded text-[10px] font-medium transition-colors leading-tight '
                                + (isActive
                                  ? WINDOW_ACTIVE_STYLE[key]
                                  : 'bg-muted/40 text-muted-foreground hover:bg-muted/60')
                              }
                              aria-pressed={isActive}
                              aria-label={`${w.label} ${w.min}–${w.max} reps${isActive ? ' (selected — tap to clear)' : ''}`}
                            >
                              <span className="block">{w.label}</span>
                              <span className="block text-[8px] opacity-70 tabular-nums">{w.min}–{w.max}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {/* Set rows. Branches by exercise.tracking_mode: time-mode
                        renders a single seconds input; reps stay min/max. */}
                    {(() => {
                      const exerciseMode = (re.exercise?.tracking_mode ?? 'reps') as 'reps' | 'time';
                      return (<>
                      {re.sets.map((set, si) => (
                      <div key={set.uuid} className="flex items-center pl-8 pr-3 py-1.5 gap-2 bg-muted/30">
                        <span className="text-xs text-muted-foreground w-10 flex-shrink-0">Set {si + 1}</span>
                        {editingSet?.uuid === set.uuid ? (
                          editingSet.mode === 'time' ? (
                            <>
                              <input
                                autoFocus
                                type="number"
                                min={1}
                                placeholder="seconds"
                                value={editingSet.durationSeconds}
                                onChange={e => setEditingSet(prev => prev ? { ...prev, durationSeconds: e.target.value } : prev)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSaveSet(); if (e.key === 'Escape') setEditingSet(null); }}
                                className="w-20 bg-background border border-input rounded px-2 py-0.5 text-sm text-center outline-none focus:border-primary"
                              />
                              <span className="text-xs text-muted-foreground flex-1">sec</span>
                              <button onClick={handleSaveSet} className="text-primary p-1" aria-label="Save">
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => setEditingSet(null)} className="text-muted-foreground p-1" aria-label="Cancel">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : (
                            <>
                              <input
                                autoFocus
                                type="number"
                                min={1}
                                placeholder="min"
                                value={editingSet.min}
                                onChange={e => setEditingSet(prev => prev ? { ...prev, min: e.target.value } : prev)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSaveSet(); if (e.key === 'Escape') setEditingSet(null); }}
                                className="w-14 bg-background border border-input rounded px-2 py-0.5 text-sm text-center outline-none focus:border-primary"
                              />
                              <span className="text-xs text-muted-foreground">–</span>
                              <input
                                type="number"
                                min={1}
                                placeholder="max"
                                value={editingSet.max}
                                onChange={e => setEditingSet(prev => prev ? { ...prev, max: e.target.value } : prev)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSaveSet(); if (e.key === 'Escape') setEditingSet(null); }}
                                className="w-14 bg-background border border-input rounded px-2 py-0.5 text-sm text-center outline-none focus:border-primary"
                              />
                              <span className="text-xs text-muted-foreground flex-1">reps</span>
                              <button onClick={handleSaveSet} className="text-primary p-1" aria-label="Save">
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => setEditingSet(null)} className="text-muted-foreground p-1" aria-label="Cancel">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )
                        ) : (
                          <>
                            <button
                              onClick={() => setEditingSet({
                                uuid: set.uuid,
                                mode: exerciseMode,
                                min: set.min_repetitions != null ? String(set.min_repetitions) : '',
                                max: set.max_repetitions != null ? String(set.max_repetitions) : '',
                                durationSeconds: set.target_duration_seconds != null ? String(set.target_duration_seconds) : '',
                              })}
                              className="flex-1 text-left text-sm text-foreground"
                            >
                              {exerciseMode === 'time'
                                ? `${formatSet(set, 'time')}${formatSet(set, 'time') === '—' ? '' : ' hold'}`
                                : `${formatSet(set)} reps`}
                            </button>
                            <button
                              onClick={() => handleDeleteSet(set.uuid)}
                              className="text-muted-foreground hover:text-destructive transition-colors p-1"
                              aria-label="Delete set"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                    {/* Add set */}
                    <button
                      onClick={() => handleAddSet(re.uuid, exerciseMode)}
                      className="flex items-center gap-1.5 pl-8 pr-4 py-1.5 text-primary text-xs font-medium w-full bg-muted/30"
                    >
                      <Plus className="h-3 w-3" />
                      Add set
                    </button>
                      </>);
                    })()}
                  </div>
                ))}
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
  plan,
  onStartWorkout,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  plan: LocalPlanWithRoutines;
  onStartWorkout: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(plan.title ?? '');
  const [addingRoutine, setAddingRoutine] = useState(false);
  const [newRoutineTitle, setNewRoutineTitle] = useState('');

  const saveTitle = async () => {
    if (!titleValue.trim()) { setEditingTitle(false); return; }
    await updatePlanTitle(plan.uuid, titleValue.trim());
    setEditingTitle(false);
  };

  const handleAddRoutine = async () => {
    if (!newRoutineTitle.trim()) return;
    await createRoutine({ workout_plan_uuid: plan.uuid, title: newRoutineTitle.trim() });
    setNewRoutineTitle('');
    setAddingRoutine(false);
  };

  const handleMoveRoutine = async (index: number, direction: 'up' | 'down') => {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= plan.routines.length) return;
    const reordered = [...plan.routines];
    [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];
    await reorderRoutines(plan.uuid, reordered.map(r => r.uuid));
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
              className="flex items-center gap-2 font-semibold text-base text-foreground"
              onDoubleClick={e => { e.stopPropagation(); setEditingTitle(true); }}
            >
              {plan.title ?? 'Untitled Plan'}
              {plan.is_active && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/15 text-primary">
                  <Star className="h-2.5 w-2.5 fill-current" />
                  Active
                </span>
              )}
            </span>
          )}
        </button>
        <span className="text-xs text-muted-foreground">
          {plan.routines.length} routine{plan.routines.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); if (!plan.is_active) activatePlan(plan.uuid); }}
          disabled={plan.is_active}
          className="text-muted-foreground hover:text-primary transition-colors p-1 disabled:opacity-30 disabled:hover:text-muted-foreground"
          aria-label={plan.is_active ? 'Active plan' : 'Make active plan'}
          title={plan.is_active ? 'Active plan' : 'Make active plan'}
        >
          <Star className={`h-4 w-4 ${plan.is_active ? 'fill-primary text-primary' : ''}`} />
        </button>
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
          onClick={() => { if (confirm(`Delete "${plan.title ?? 'this plan'}"?`)) deletePlan(plan.uuid); }}
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

          {/* Volume Fit tile — at top of plan card so Lou sees the verdict
              before scrolling exercise lists. */}
          {plan.routines.length > 0 && (
            <RoutineVolumeFit plan={plan} isActive={plan.is_active} />
          )}

          {plan.routines.map((routine, i) => (
            <RoutineCard
              key={routine.uuid}
              planUuid={plan.uuid}
              routine={routine}
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

export default function PlansPage() {
  const plans = usePlansFull();
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [newPlanTitle, setNewPlanTitle] = useState('');

  const handleCreatePlan = async () => {
    if (!newPlanTitle.trim()) return;
    await createPlan({ title: newPlanTitle.trim() });
    setNewPlanTitle('');
    setCreatingPlan(false);
  };

  const handleMovePlan = async (index: number, direction: 'up' | 'down') => {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= plans.length) return;
    const reordered = [...plans];
    [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];
    await reorderPlans(reordered.map(p => p.uuid));
  };

  const handleStartWorkout = () => {
    window.location.href = '/workout';
  };

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-safe pb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Link href="/workout" className="text-primary p-1 -ml-1">
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-bold">Plans</h1>
          </div>
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

        {plans.length === 0 ? (
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
                onStartWorkout={handleStartWorkout}
                onMoveUp={() => handleMovePlan(i, 'up')}
                onMoveDown={() => handleMovePlan(i, 'down')}
                isFirst={i === 0}
                isLast={i === plans.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
