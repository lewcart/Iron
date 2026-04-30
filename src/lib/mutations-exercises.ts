'use client';

import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import { uuid as genUUID } from '@/lib/uuid';
import type { LocalExercise } from '@/db/local';

// Mutations for the exercises catalog. The catalog is mostly read-only
// (770+ everkinetic exercises ship in the bundled JSON) but the user can
// create custom exercises and hide stock ones.
//
// NB: Unlike other domains, exercises don't have SyncMeta on the local
// type — the catalog isn't soft-deletable from the client. Custom-created
// exercises propagate through sync via the existing exercises_change_log
// trigger; pushed via /api/sync/push's pushExercise handler.

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
  };
  // Push needs to know this is dirty. exercises don't have SyncMeta on the
  // type but the sync engine reads `_synced` field via the `as unknown` path.
  await db.exercises.put({ ...ex, _synced: false, _updated_at: now(), _deleted: false } as unknown as LocalExercise);
  syncEngine.schedulePush();
  return ex;
}

export async function updateCustomExercise(
  uuid: string,
  patch: Partial<Omit<LocalExercise, 'uuid'>>,
): Promise<void> {
  await db.exercises.update(uuid.toLowerCase(),
    { ...patch, _synced: false, _updated_at: now(), _deleted: false } as never,
  );
  syncEngine.schedulePush();
}

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
