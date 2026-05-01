'use client';

import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import { uuid as genUUID } from '@/lib/uuid';
import type { LocalExercise } from '@/db/local';

// Mutations for the exercises catalog. The user can create custom exercises,
// hide stock ones, AND edit text fields on any exercise (catalog or custom)
// — description / steps / tips edits all flow through updateExercise into
// the CDC sync layer via /api/sync/push's pushExercise handler.
//
// Note on sync: exercises ARE in the change_log CDC layer (mig 018+019), so
// edits round-trip through Postgres on push. Single-user practice means
// no contention — Lewis is the only writer.

function now() { return Date.now(); }

export async function createCustomExercise(opts: {
  title: string;
  primary_muscles?: string[];
  secondary_muscles?: string[];
  equipment?: string[];
  description?: string | null;
  steps?: string[];
  tips?: string[];
  movement_pattern?: string | null;
  tracking_mode?: 'reps' | 'time';
  youtube_url?: string | null;
}): Promise<LocalExercise> {
  const ex: LocalExercise = {
    uuid: genUUID().toLowerCase(),
    everkinetic_id: 0, // 0 = custom, never collides with everkinetic catalog
    title: opts.title.trim(),
    alias: [],
    description: opts.description?.trim() || null,
    primary_muscles: opts.primary_muscles ?? [],
    secondary_muscles: opts.secondary_muscles ?? [],
    equipment: opts.equipment ?? [],
    steps: opts.steps ?? [],
    tips: opts.tips ?? [],
    is_custom: true,
    is_hidden: false,
    movement_pattern: opts.movement_pattern ?? null,
    tracking_mode: opts.tracking_mode ?? 'reps',
    image_count: 0,
    youtube_url: opts.youtube_url ?? null,
    image_urls: null,
  };
  // Push needs the dirty flag. exercises rows technically don't extend
  // SyncMeta on the type but the sync engine reads _synced/_updated_at
  // through the cast.
  await db.exercises.put({ ...ex, _synced: false, _updated_at: now(), _deleted: false } as unknown as LocalExercise);
  syncEngine.schedulePush();
  return ex;
}

/** Edit any exercise row (catalog or custom). Pushes through the CDC sync
 *  layer; server validates youtube_url shape and rejects garbage. */
export async function updateExercise(
  uuid: string,
  patch: Partial<Omit<LocalExercise, 'uuid'>>,
): Promise<void> {
  await db.exercises.update(uuid.toLowerCase(),
    { ...patch, _synced: false, _updated_at: now(), _deleted: false } as never,
  );
  syncEngine.schedulePush();
}

/** @deprecated Use updateExercise. Kept as an alias for downstream callers. */
export const updateCustomExercise = updateExercise;

export async function hideExercise(uuid: string): Promise<void> {
  // Sets is_hidden=true rather than soft-deleting, so workout history that
  // references the hidden exercise still resolves the exercise name.
  await db.exercises.update(uuid.toLowerCase(),
    { is_hidden: true, _synced: false, _updated_at: now() } as never,
  );
  syncEngine.schedulePush();
}

export async function unhideExercise(uuid: string): Promise<void> {
  await db.exercises.update(uuid.toLowerCase(),
    { is_hidden: false, _synced: false, _updated_at: now() } as never,
  );
  syncEngine.schedulePush();
}

export async function deleteCustomExercise(uuid: string): Promise<void> {
  // Only allow deletion of custom exercises (is_custom=true). Stock catalog
  // entries get hidden instead. Caller is responsible for the check.
  await db.exercises.update(uuid.toLowerCase(),
    { _deleted: true, _synced: false, _updated_at: now() } as never,
  );
  syncEngine.schedulePush();
}
