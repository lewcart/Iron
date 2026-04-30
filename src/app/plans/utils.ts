import type { WorkoutRoutineSet } from '@/types';

/** Format the target line for a routine exercise. Defaults to rep-mode
 *  (weight × reps); pass trackingMode='time' to render held-duration ranges
 *  in MM:SS format instead. */
export function formatSetsReps(
  sets: WorkoutRoutineSet[],
  trackingMode: 'reps' | 'time' = 'reps',
): string | null {
  if (!sets || sets.length === 0) return null;
  const count = sets.length;

  if (trackingMode === 'time') {
    const durations = sets
      .map(s => s.target_duration_seconds)
      .filter((v): v is number => v != null && v > 0);
    if (durations.length === 0) return `${count} set${count !== 1 ? 's' : ''}`;
    const lo = Math.min(...durations);
    const hi = Math.max(...durations);
    const fmt = (s: number) => s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    return lo === hi ? `${count} × ${fmt(lo)}` : `${count} × ${fmt(lo)}–${fmt(hi)}`;
  }

  const mins = sets.map((s) => s.min_repetitions).filter((v): v is number => v != null);
  const maxs = sets.map((s) => s.max_repetitions).filter((v): v is number => v != null);
  const allReps = [...mins, ...maxs];
  if (allReps.length === 0) return `${count} set${count !== 1 ? 's' : ''}`;
  const lo = Math.min(...allReps);
  const hi = Math.max(...allReps);
  const reps = lo === hi ? `${lo}` : `${lo}–${hi}`;
  return `${count} × ${reps}`;
}
