'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import type { Exercise } from '@/types';
import ExerciseDetail from './ExerciseDetail';

// Known muscle groups with display info
const MUSCLE_GROUPS = [
  { key: 'chest', label: 'Chest', emoji: '💪' },
  { key: 'back', label: 'Back', emoji: '🔙' },
  { key: 'shoulders', label: 'Shoulders', emoji: '🤷' },
  { key: 'arms', label: 'Arms', emoji: '💪' },
  { key: 'legs', label: 'Legs', emoji: '🦵' },
  { key: 'abdominals', label: 'Abdominals', emoji: '⭕' },
];

export default function ExercisesPage() {
  const [allExercises, setAllExercises] = useState<Exercise[]>([]);
  const [searchResults, setSearchResults] = useState<Exercise[]>([]);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  const [muscleExercises, setMuscleExercises] = useState<Exercise[]>([]);

  // Load all exercises once for counts
  useEffect(() => {
    fetch('/api/exercises')
      .then(r => r.json())
      .then(data => { setAllExercises(data); setLoading(false); });
  }, []);

  // Search
  useEffect(() => {
    if (!search) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    const params = new URLSearchParams({ search });
    fetch(`/api/exercises?${params}`)
      .then(r => r.json())
      .then(data => { setSearchResults(data); setSearching(false); });
  }, [search]);

  // Muscle group filter
  const handleMuscleSelect = async (muscle: string) => {
    setSelectedMuscle(muscle);
    const params = new URLSearchParams({ muscleGroup: muscle });
    const data = await fetch(`/api/exercises?${params}`).then(r => r.json());
    setMuscleExercises(data);
  };

  const countForMuscle = (muscle: string) =>
    allExercises.filter(e => e.primary_muscles.some(m => m.toLowerCase().includes(muscle))).length;

  // ── Exercise detail ──
  if (selectedExercise) {
    return (
      <ExerciseDetail
        exercise={selectedExercise}
        onBack={() => setSelectedExercise(null)}
      />
    );
  }

  // ── Muscle group drill-down ──
  if (selectedMuscle) {
    const groupLabel = MUSCLE_GROUPS.find(g => g.key === selectedMuscle)?.label ?? selectedMuscle;
    return (
      <main className="tab-content bg-background">
        <div className="flex items-center gap-3 px-4 pt-14 pb-3">
          <button
            onClick={() => setSelectedMuscle(null)}
            className="flex items-center gap-1 text-primary font-medium text-base"
          >
            <span className="text-lg">‹</span>
            Exercises
          </button>
          <h1 className="text-lg font-semibold capitalize">{groupLabel}</h1>
        </div>
        <div className="px-4">
          <div className="ios-section">
            {muscleExercises.map((ex) => (
              <button
                key={ex.uuid}
                onClick={() => setSelectedExercise(ex)}
                className="ios-row w-full text-left"
              >
                <span className="flex-1 text-sm font-medium">{ex.title}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
            {muscleExercises.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No exercises found</div>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="tab-content bg-background">
      <div className="px-4 pt-14 pb-3">
        <h1 className="text-2xl font-bold mb-3">Exercises</h1>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search exercises"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-secondary rounded-lg text-sm outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      <div className="px-4 space-y-4 pb-4">
        {search ? (
          /* Search results */
          <>
            {searching ? (
              <p className="text-center py-8 text-muted-foreground text-sm">Searching…</p>
            ) : searchResults.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-sm">No results for &ldquo;{search}&rdquo;</p>
            ) : (
              <div className="ios-section">
                {searchResults.map((ex) => (
                  <button
                    key={ex.uuid}
                    onClick={() => setSelectedExercise(ex)}
                    className="ios-row w-full text-left"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium">{ex.title}</p>
                      <p className="text-xs text-muted-foreground capitalize">{ex.primary_muscles.join(', ')}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          /* Default: All + muscle group list */
          <>
            <div className="ios-section">
              <button
                onClick={() => { setSelectedMuscle('all'); setMuscleExercises(allExercises); }}
                className="ios-row w-full text-left"
              >
                <span className="flex-1 font-medium text-sm">All</span>
                <span className="text-sm text-muted-foreground mr-2">{allExercises.length}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            <div className="ios-section">
              {MUSCLE_GROUPS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => handleMuscleSelect(key)}
                  className="ios-row w-full text-left"
                >
                  <span className="flex-1 font-medium text-sm capitalize">{label}</span>
                  <span className="text-sm text-muted-foreground mr-2">({countForMuscle(key)})</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>

            {!loading && (
              <div className="ios-section">
                <button
                  onClick={() => {
                    const custom = allExercises.filter(e => e.is_custom);
                    setSelectedMuscle('Custom');
                    setMuscleExercises(custom);
                  }}
                  className="ios-row w-full text-left"
                >
                  <span className="flex-1 font-medium text-sm">Custom</span>
                  <span className="text-sm text-muted-foreground mr-2">{allExercises.filter(e => e.is_custom).length}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
