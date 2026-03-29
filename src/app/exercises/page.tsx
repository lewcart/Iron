'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Search, X } from 'lucide-react';
import type { Exercise } from '@/types';
import { exerciseMatchesMuscleGroup } from '@/lib/muscle-groups';
import { queryKeys } from '@/lib/api/query-keys';
import { fetchExerciseCatalog } from '@/lib/api/exercises';
import ExerciseDetail from './ExerciseDetail';

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

function exerciseMatchesSearch(e: Exercise, q: string): boolean {
  const lower = q.toLowerCase();
  if (e.title.toLowerCase().includes(lower)) return true;
  return e.alias.some((a) => a.toLowerCase().includes(lower));
}

function ExercisesIndexSkeleton() {
  return (
    <div className="px-4 space-y-4 pb-4 animate-pulse" aria-hidden>
      <div className="h-10 bg-muted/70 rounded-lg" />
      <div className="ios-section h-14 bg-muted/50 rounded-xl" />
      <div className="ios-section space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 bg-muted/40 rounded-lg mx-2" />
        ))}
      </div>
    </div>
  );
}

export default function ExercisesPage() {
  const { data: allExercises = [], isPending, isPlaceholderData } = useQuery({
    queryKey: queryKeys.exercises.catalog(),
    queryFn: fetchExerciseCatalog,
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    placeholderData: (previousData) => previousData,
  });

  const [search, setSearch] = useState('');
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  const [muscleExercises, setMuscleExercises] = useState<Exercise[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState<string | null>(null);
  const [equipmentExercises, setEquipmentExercises] = useState<Exercise[]>([]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim();
    return allExercises.filter((e) => exerciseMatchesSearch(e, q));
  }, [allExercises, search]);

  const handleMuscleSelect = (muscle: string) => {
    setSelectedMuscle(muscle);
    setMuscleExercises(
      muscle === 'all'
        ? allExercises
        : allExercises.filter((e) =>
            exerciseMatchesMuscleGroup(e.primary_muscles, e.secondary_muscles, muscle)
          )
    );
  };

  const handleEquipmentSelect = (equipment: string) => {
    setSelectedEquipment(equipment);
    setEquipmentExercises(
      allExercises.filter((e) =>
        e.equipment.some((eq) => eq.toLowerCase().includes(equipment))
      )
    );
  };

  const countForMuscle = (muscle: string) =>
    allExercises.filter((e) =>
      exerciseMatchesMuscleGroup(e.primary_muscles, e.secondary_muscles, muscle)
    ).length;

  const countForEquipment = (equipment: string) =>
    allExercises.filter((e) =>
      e.equipment.some((eq) => eq.toLowerCase().includes(equipment))
    ).length;

  const loading = isPending && allExercises.length === 0;

  if (selectedExercise) {
    return (
      <ExerciseDetail
        exercise={selectedExercise}
        onBack={() => setSelectedExercise(null)}
      />
    );
  }

  if (selectedEquipment) {
    const equipLabel = EQUIPMENT_FILTERS.find((e) => e.key === selectedEquipment)?.label ?? selectedEquipment;
    return (
      <main className="tab-content bg-background">
        <div className="flex items-center gap-3 px-4 pt-safe pb-3">
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

  if (selectedMuscle) {
    const groupLabel = MUSCLE_GROUPS.find((g) => g.key === selectedMuscle)?.label ?? selectedMuscle;
    return (
      <main className="tab-content bg-background">
        <div className="flex items-center gap-3 px-4 pt-safe pb-3">
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
      <div className="px-4 pt-safe pb-3">
        <h1 className="text-2xl font-bold mb-3">Exercises</h1>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search exercises"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
        {loading ? (
          <ExercisesIndexSkeleton />
        ) : (
          <>
            {isPlaceholderData && allExercises.length > 0 ? (
              <p className="text-[11px] text-muted-foreground text-center -mt-1">Cached list · refreshing in background</p>
            ) : null}
            {search ? (
              <>
                {searchResults.length === 0 ? (
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
              <>
                <div className="ios-section">
                  <button
                    onClick={() => handleMuscleSelect('all')}
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

                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-2">By Equipment</p>
                  <div className="flex flex-wrap gap-2">
                    {EQUIPMENT_FILTERS.map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => handleEquipmentSelect(key)}
                        className="px-3 py-1.5 rounded-full bg-secondary text-sm font-medium hover:bg-secondary/80 transition-colors"
                      >
                        {label}
                        <span className="ml-1.5 text-xs text-muted-foreground">({countForEquipment(key)})</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="ios-section">
                  <button
                    onClick={() => {
                      const custom = allExercises.filter((e) => e.is_custom);
                      setSelectedMuscle('Custom');
                      setMuscleExercises(custom);
                    }}
                    className="ios-row w-full text-left"
                  >
                    <span className="flex-1 font-medium text-sm">Custom</span>
                    <span className="text-sm text-muted-foreground mr-2">
                      {allExercises.filter((e) => e.is_custom).length}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
