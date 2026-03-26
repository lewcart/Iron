'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import { useExercises } from '@/lib/useLocalDB';
import type { LocalExercise } from '@/db/local';
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

const EQUIPMENT_FILTERS = [
  { key: 'barbell', label: 'Barbell' },
  { key: 'dumbbell', label: 'Dumbbell' },
  { key: 'cable', label: 'Cable' },
  { key: 'machine', label: 'Machine' },
  { key: 'bodyweight', label: 'Bodyweight' },
  { key: 'kettlebell', label: 'Kettlebell' },
  { key: 'resistance band', label: 'Bands' },
  { key: 'pull-up bar', label: 'Pull-up Bar' },
];

export default function ExercisesPage() {
  const [search, setSearch] = useState('');
  const [selectedExercise, setSelectedExercise] = useState<LocalExercise | null>(null);
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<string | null>(null);

  // All exercises from local DB (reactive)
  const allExercises = useExercises();
  const searchedExercises = useExercises({ search: search || undefined });

  // Derived drill-down lists (computed from allExercises in memory — fast)
  const muscleExercises = useMemo(() => {
    if (!selectedMuscle) return [];
    if (selectedMuscle === 'all') return allExercises;
    if (selectedMuscle === 'Custom') return allExercises.filter(e => e.is_custom);
    return allExercises.filter(e => e.primary_muscles.includes(selectedMuscle));
  }, [allExercises, selectedMuscle]);

  const equipmentExercises = useMemo(() => {
    if (!selectedEquipment) return [];
    return allExercises.filter(e => e.equipment.includes(selectedEquipment));
  }, [allExercises, selectedEquipment]);

  const countForMuscle = (muscle: string) =>
    allExercises.filter(e => e.primary_muscles.some(m => m.toLowerCase().includes(muscle))).length;

  const countForEquipment = (equipment: string) =>
    allExercises.filter(e => e.equipment.some(eq => eq.toLowerCase().includes(equipment))).length;

  // ── Exercise detail ──
  if (selectedExercise) {
    return (
      <ExerciseDetail
        exercise={selectedExercise}
        onBack={() => setSelectedExercise(null)}
      />
    );
  }

  // ── Equipment drill-down ──
  if (selectedEquipment) {
    const equipLabel = EQUIPMENT_FILTERS.find(e => e.key === selectedEquipment)?.label ?? selectedEquipment;
    return (
      <main className="tab-content bg-background">
        <div className="flex items-center gap-3 px-4 pt-14 pb-3">
          <button
            onClick={() => setSelectedEquipment(null)}
            className="flex items-center gap-1 text-primary font-medium text-base"
          >
            <span className="text-lg">‹</span>
            Exercises
          </button>
          <h1 className="text-lg font-semibold capitalize">{equipLabel}</h1>
        </div>
        <div className="px-4">
          <div className="ios-section">
            {equipmentExercises.map((ex) => (
              <button
                key={ex.uuid}
                onClick={() => setSelectedExercise(ex)}
                className="ios-row w-full text-left"
              >
                <span className="flex-1 text-sm font-medium">{ex.title}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
            {equipmentExercises.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No exercises found</div>
            )}
          </div>
        </div>
      </main>
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
            {searchedExercises.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-sm">No results for &ldquo;{search}&rdquo;</p>
            ) : (
              <div className="ios-section">
                {searchedExercises.map((ex) => (
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
                onClick={() => setSelectedMuscle('all')}
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
                  onClick={() => setSelectedMuscle(key)}
                  className="ios-row w-full text-left"
                >
                  <span className="flex-1 font-medium text-sm capitalize">{label}</span>
                  <span className="text-sm text-muted-foreground mr-2">({countForMuscle(key)})</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-2">By Equipment</p>
              <div className="flex flex-wrap gap-2">
                {EQUIPMENT_FILTERS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setSelectedEquipment(key)}
                    className="px-3 py-1.5 rounded-full bg-secondary text-sm font-medium hover:bg-secondary/80 transition-colors"
                  >
                    {label}
                    <span className="ml-1.5 text-xs text-muted-foreground">({countForEquipment(key)})</span>
                  </button>
                ))}
              </div>
            </div>

            {allExercises.some(e => e.is_custom) && (
              <div className="ios-section">
                <button
                  onClick={() => setSelectedMuscle('Custom')}
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
