'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { Workout, WorkoutExercise, WorkoutSet, Exercise } from '@/types';
import { getMuscleColor } from '@/lib/muscle-colors';

interface WorkoutWithExercises extends Workout {
  exercises: (WorkoutExercise & {
    exercise: Exercise;
    sets: WorkoutSet[];
  })[];
}

function formatDuration(start: string, end: string | null) {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function totalSets(exercises: WorkoutWithExercises['exercises']) {
  return exercises.reduce((sum, e) => sum + e.sets.filter(s => s.is_completed).length, 0);
}

function totalWeight(exercises: WorkoutWithExercises['exercises']) {
  return exercises.reduce((sum, e) =>
    sum + e.sets.filter(s => s.is_completed).reduce((s2, set) =>
      s2 + (set.weight ?? 0) * (set.repetitions ?? 0), 0), 0);
}

export default function WorkoutDetail({ workout, onBack }: { workout: Workout; onBack: () => void }) {
  const [detail, setDetail] = useState<WorkoutWithExercises | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const detailRes = await fetch(`/api/workouts/${workout.uuid}`);
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

      setDetail({ ...detailData, exercises: exercisesWithDetails });
      setLoading(false);
    };
    load();
  }, [workout.uuid]);

  const allMuscles = detail?.exercises.flatMap(e => e.exercise?.primary_muscles ?? []) ?? [];
  const accentColor = getMuscleColor(allMuscles);

  return (
    <main className="tab-content bg-background">
      {/* Nav bar */}
      <div className="flex items-center gap-3 px-4 pt-14 pb-3">
        <button onClick={onBack} className="flex items-center gap-1 text-primary font-medium text-base">
          <ChevronLeft className="h-5 w-5" />
          History
        </button>
      </div>

      {loading ? (
        <p className="text-center py-12 text-muted-foreground text-sm">Loading…</p>
      ) : detail ? (
        <div className="px-4 space-y-4">
          {/* Colored stats banner */}
          <div
            className="rounded-xl p-4 text-white"
            style={{ backgroundColor: accentColor }}
          >
            <div className="grid grid-cols-3 text-center">
              <div>
                <p className="text-2xl font-bold">{formatDuration(detail.start_time, detail.end_time)}</p>
                <p className="text-xs mt-0.5 opacity-80">Duration</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{totalSets(detail.exercises)}</p>
                <p className="text-xs mt-0.5 opacity-80">Sets</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{totalWeight(detail.exercises).toLocaleString()}</p>
                <p className="text-xs mt-0.5 opacity-80">Total kg</p>
              </div>
            </div>
          </div>

          {/* Title / comment */}
          <div className="ios-section">
            <div className="ios-row">
              <p className="font-medium text-sm">
                {detail.title || new Date(detail.start_time).toLocaleDateString('en-US', {
                  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
                })}
              </p>
            </div>
            {detail.comment && (
              <div className="ios-row">
                <p className="text-sm text-muted-foreground italic">{detail.comment}</p>
              </div>
            )}
          </div>

          {/* Exercises */}
          {detail.exercises.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Exercises</p>
              <div className="space-y-3">
                {detail.exercises.map((we) => {
                  const completedSets = we.sets.filter(s => s.is_completed);
                  return (
                    <div key={we.uuid} className="ios-section">
                      <div className="px-4 py-3 border-b border-border">
                        <p className="font-semibold text-sm">{we.exercise?.title ?? 'Unknown Exercise'}</p>
                        {we.comment && (
                          <p className="text-xs text-muted-foreground italic mt-0.5">{we.comment}</p>
                        )}
                      </div>
                      {completedSets.map((set, i) => (
                        <div key={set.uuid} className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0">
                          <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-[10px] font-bold">{i + 1}</span>
                          </div>
                          <p className="text-sm font-mono text-muted-foreground">
                            {set.weight != null ? `${set.weight} kg` : '—'} × {set.repetitions ?? '—'}
                          </p>
                        </div>
                      ))}
                      {completedSets.length === 0 && (
                        <div className="px-4 py-3">
                          <p className="text-sm text-muted-foreground">No completed sets</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-center py-12 text-muted-foreground text-sm">Workout not found</p>
      )}
    </main>
  );
}
