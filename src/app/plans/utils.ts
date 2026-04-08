import type { WorkoutRoutineSet } from '@/types';

export function formatSetsReps(sets: WorkoutRoutineSet[]): string | null {
  if (!sets || sets.length === 0) return null;
  const count = sets.length;
  const mins = sets.map((s) => s.min_repetitions).filter((v): v is number => v != null);
  const maxs = sets.map((s) => s.max_repetitions).filter((v): v is number => v != null);
  const allReps = [...mins, ...maxs];
  if (allReps.length === 0) return `${count} set${count !== 1 ? 's' : ''}`;
  const lo = Math.min(...allReps);
  const hi = Math.max(...allReps);
  const reps = lo === hi ? `${lo}` : `${lo}–${hi}`;
  return `${count} × ${reps}`;
}
