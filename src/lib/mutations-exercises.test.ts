import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/db/local';
import { createCustomExercise, DuplicateCustomTitleError } from './mutations-exercises';

vi.mock('@/lib/sync', () => ({
  syncEngine: { schedulePush: vi.fn() },
}));

describe('createCustomExercise — duplicate-title pre-flight', () => {
  beforeEach(async () => {
    await db.exercises.clear();
  });

  it('creates a new custom exercise on the happy path', async () => {
    const ex = await createCustomExercise({
      title: 'Cable Hip Abduction',
      primary_muscles: ['hip_abductors'],
    });
    const stored = await db.exercises.get(ex.uuid);
    expect(stored).toBeDefined();
    expect(stored!.is_custom).toBe(true);
    expect(stored!.title).toBe('Cable Hip Abduction');
  });

  it('rejects a second create with the exact same title', async () => {
    await createCustomExercise({ title: 'Cable Hip Abduction', primary_muscles: ['hip_abductors'] });
    await expect(
      createCustomExercise({ title: 'Cable Hip Abduction', primary_muscles: ['hip_abductors'] }),
    ).rejects.toBeInstanceOf(DuplicateCustomTitleError);
  });

  it('rejects a case-only title typo (the original Warm-Up vs Warm-up cluster)', async () => {
    await createCustomExercise({ title: 'Banded Glute Bridge (Warm-Up)', primary_muscles: ['glutes'] });
    await expect(
      createCustomExercise({ title: 'Banded Glute Bridge (Warm-up)', primary_muscles: ['glutes'] }),
    ).rejects.toBeInstanceOf(DuplicateCustomTitleError);
  });

  it('rejects a title that differs only in surrounding whitespace', async () => {
    await createCustomExercise({ title: 'Cable Kickback', primary_muscles: ['glutes'] });
    await expect(
      createCustomExercise({ title: '  Cable Kickback  ', primary_muscles: ['glutes'] }),
    ).rejects.toBeInstanceOf(DuplicateCustomTitleError);
  });

  it('allows re-creating a name that was soft-deleted', async () => {
    const first = await createCustomExercise({ title: 'Cable Kickback', primary_muscles: ['glutes'] });
    await db.exercises.update(first.uuid, { _deleted: true } as never);

    const second = await createCustomExercise({ title: 'Cable Kickback', primary_muscles: ['glutes'] });
    expect(second.uuid).not.toBe(first.uuid);
  });

  it('allows a custom exercise to share a title with a stock catalog row', async () => {
    // Seed a stock-catalog row directly (is_custom=false).
    await db.exercises.put({
      uuid: 'stock-uuid',
      everkinetic_id: 112,
      title: 'Cable Kickback',
      alias: [],
      description: 'stock entry',
      primary_muscles: ['glutes'],
      secondary_muscles: ['hamstrings'],
      equipment: ['cable'],
      steps: [],
      tips: [],
      is_custom: false,
      is_hidden: false,
      movement_pattern: null,
      tracking_mode: 'reps',
      image_count: 0,
      youtube_url: null,
      image_urls: null,
    } as never);

    // Custom create with the same title is intentionally allowed — the partial
    // UNIQUE in migration 034 is scoped to is_custom=true rows. Migration 035
    // is what cleans up cross-type collisions, not this guard.
    const ex = await createCustomExercise({ title: 'Cable Kickback', primary_muscles: ['glutes'] });
    expect(ex.is_custom).toBe(true);
  });

  it('exposes the existing row on the thrown error so the UI can route to it', async () => {
    const first = await createCustomExercise({ title: 'Frog Pump (Warm-Up)', primary_muscles: ['glutes'] });
    try {
      await createCustomExercise({ title: 'frog pump (warm-up)', primary_muscles: ['glutes'] });
      throw new Error('expected DuplicateCustomTitleError');
    } catch (err) {
      expect(err).toBeInstanceOf(DuplicateCustomTitleError);
      expect((err as DuplicateCustomTitleError).existing.uuid).toBe(first.uuid);
      expect((err as DuplicateCustomTitleError).existing.title).toBe('Frog Pump (Warm-Up)');
    }
  });
});
