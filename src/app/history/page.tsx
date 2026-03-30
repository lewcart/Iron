'use client';

import { useState } from 'react';
import { ChevronRight, X, Search, Download } from 'lucide-react';
import type { LocalExercise } from '@/db/local';
import type { LocalWorkoutSummary } from '@/lib/useLocalDB';
import { useWorkoutSummaries, useExercises } from '@/lib/useLocalDB';
import WorkoutDetail from './WorkoutDetail';
import {
  formatDuration,
  formatDate,
  groupWorkouts,
  type GroupMode,
} from './utils';

function HistoryListSkeleton() {
  return (
    <div className="px-4 space-y-4 animate-pulse" aria-hidden>
      <div className="h-4 w-24 bg-muted/60 rounded mb-2" />
      <div className="ios-section space-y-0">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 border-b border-border last:border-0 mx-3 my-2 bg-muted/40 rounded" />
        ))}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const [selected, setSelected] = useState<LocalWorkoutSummary | null>(null);

  const [groupMode, setGroupMode] = useState<GroupMode>('week');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [selectedExercise, setSelectedExercise] = useState<LocalExercise | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const workouts = useWorkoutSummaries({
    limit: 200,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    exerciseUuid: selectedExercise?.uuid,
  });

  const allExercises = useExercises({ search: exerciseSearch.length >= 2 ? exerciseSearch : undefined });
  const exerciseSuggestions = allExercises.slice(0, 6);

  const clearFilters = () => {
    setFromDate('');
    setToDate('');
    setExerciseSearch('');
    setSelectedExercise(null);
    setShowSuggestions(false);
  };

  const hasFilters = fromDate || toDate || selectedExercise;

  const grouped = groupWorkouts(workouts, groupMode);

  // workouts is [] on first render (Dexie default), no async pending state needed
  const loading = false;

  if (selected) {
    return <WorkoutDetail workout={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-safe pb-3 flex justify-between items-baseline">
        <h1 className="text-2xl font-bold">History</h1>

        <div className="flex items-center gap-2">
          <a
            href="/api/export?format=json"
            download
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1"
            title="Export JSON"
          >
            <Download className="h-3 w-3" />
            JSON
          </a>
          <a
            href="/api/export?format=csv"
            download
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1"
            title="Export CSV"
          >
            <Download className="h-3 w-3" />
            CSV
          </a>

          <div className="flex rounded-lg overflow-hidden border border-border text-xs font-medium">
            <button
              onClick={() => setGroupMode('week')}
              className={`px-3 py-1.5 transition-colors ${groupMode === 'week' ? 'bg-blue-500 text-white' : 'text-muted-foreground'}`}
            >
              Week
            </button>
            <button
              onClick={() => setGroupMode('month')}
              className={`px-3 py-1.5 transition-colors ${groupMode === 'month' ? 'bg-blue-500 text-white' : 'text-muted-foreground'}`}
            >
              Month
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 pb-3 space-y-2">
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <div className="relative">
          <label className="text-xs text-muted-foreground mb-1 block">Filter by exercise</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={selectedExercise ? selectedExercise.title : exerciseSearch}
              placeholder="Search exercises…"
              readOnly={!!selectedExercise}
              onChange={(e) => {
                setExerciseSearch(e.target.value);
                setSelectedExercise(null);
              }}
              onFocus={() => {
                if (exerciseSuggestions.length > 0) setShowSuggestions(true);
              }}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              className="w-full h-9 rounded-md border border-input bg-background pl-8 pr-8 py-1 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {selectedExercise && (
              <button
                onClick={() => {
                  setSelectedExercise(null);
                  setExerciseSearch('');
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {showSuggestions && exerciseSuggestions.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-zinc-900 shadow-lg">
              {exerciseSuggestions.map((ex) => (
                <button
                  key={ex.uuid}
                  onMouseDown={() => {
                    setSelectedExercise(ex);
                    setExerciseSearch('');
                    setShowSuggestions(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-800 first:rounded-t-md last:rounded-b-md"
                >
                  {ex.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300"
          >
            <X className="h-3 w-3" />
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <HistoryListSkeleton />
      ) : workouts.length === 0 ? (
        <div className="px-4">
          <div className="ios-section">
            <p className="text-center py-12 text-muted-foreground text-sm">
              {hasFilters ? 'No workouts match these filters.' : 'Your finished workouts will appear here.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="px-4 space-y-4">
          {grouped.map((group) => (
            <div key={group.label}>
              <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-1 px-1">{group.label}</p>
              <div className="ios-section">
                {group.workouts.map((w, i) => (
                  <button
                    key={w.uuid}
                    onClick={() => setSelected(w)}
                    className={`ios-row w-full text-left ${i === group.workouts.length - 1 ? 'border-0' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{w.title || formatDate(w.start_time)}</p>
                      {!w.title && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(w.start_time).toLocaleDateString('en-US', { weekday: 'long' })}
                          {', '}
                          {new Date(w.start_time).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                      )}
                      {w.title && (
                        <p className="text-xs text-muted-foreground mt-0.5">{formatDate(w.start_time)}</p>
                      )}
                      {w.comment && (
                        <p className="text-xs text-muted-foreground italic mt-0.5 truncate">
                          &ldquo;{w.comment}&rdquo;
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">
                          {w.exercise_count} {w.exercise_count === 1 ? 'exercise' : 'exercises'}
                        </span>
                        {w.total_volume > 0 && (
                          <>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-muted-foreground">
                              {w.total_volume.toLocaleString()} kg
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                      <span className="text-xs border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                        {formatDuration(w.start_time, w.end_time)}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
