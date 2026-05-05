import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/db/local';
import { startWorkout, addExerciseToWorkout } from './mutations';

vi.mock('@/lib/sync', () => ({
  syncEngine: { schedulePush: vi.fn() },
}));

describe('startWorkout — abandoned-workout cleanup', () => {
  beforeEach(async () => {
    await db.workouts.clear();
    await db.workout_exercises.clear();
    await db.workout_sets.clear();
  });

  it('soft-deletes the previous current workout when it has no exercises', async () => {
    // Tap Start, change your mind, tap Start again — without adding anything.
    const ghostUuid = await startWorkout({ title: 'Lower A' });
    const realUuid = await startWorkout({ title: 'Upper A' });

    expect(realUuid).not.toBe(ghostUuid);

    const ghost = await db.workouts.get(ghostUuid);
    expect(ghost?._deleted).toBe(true);

    const real = await db.workouts.get(realUuid);
    expect(real?._deleted).toBe(false);
    expect(real?.is_current).toBe(true);
  });

  it('preserves the previous current workout when exercises were added (auto-end as before)', async () => {
    const firstUuid = await startWorkout({ title: 'Lower A' });
    await addExerciseToWorkout(firstUuid, 'exercise-uuid-1', 0);

    const secondUuid = await startWorkout({ title: 'Upper A' });

    const first = await db.workouts.get(firstUuid);
    expect(first?._deleted).toBe(false);
    expect(first?.is_current).toBe(false);
    expect(first?.end_time).not.toBeNull();

    const second = await db.workouts.get(secondUuid);
    expect(second?.is_current).toBe(true);
  });

  it('skips already-deleted exercises when counting (a delete-then-restart cycle still cleans up)', async () => {
    // Edge case: if the only exercise on the prior workout was soft-deleted,
    // the workout still counts as empty and should be cleaned up.
    const firstUuid = await startWorkout({ title: 'Lower A' });
    const exUuid = await addExerciseToWorkout(firstUuid, 'exercise-uuid-1', 0);
    await db.workout_exercises.update(exUuid, {
      _deleted: true,
      _synced: false,
      _updated_at: Date.now(),
    });

    await startWorkout({ title: 'Upper A' });

    const first = await db.workouts.get(firstUuid);
    expect(first?._deleted).toBe(true);
  });
});
