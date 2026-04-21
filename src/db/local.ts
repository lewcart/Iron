import Dexie, { type Table } from 'dexie';

// ─── Local table types ─────────────────────────────────────────────────────────

export interface LocalExercise {
  uuid: string;
  everkinetic_id: number;
  title: string;
  alias: string[];
  description: string | null;
  primary_muscles: string[];
  secondary_muscles: string[];
  equipment: string[];
  steps: string[];
  tips: string[];
  is_custom: boolean;
  is_hidden: boolean;
  movement_pattern: string | null;
}

export interface LocalWorkout {
  uuid: string;
  start_time: string;
  end_time: string | null;
  title: string | null;
  comment: string | null;
  is_current: boolean;
  workout_routine_uuid: string | null;
  // Sync metadata
  _synced: boolean;
  _updated_at: number; // epoch ms
  _deleted: boolean;
}

export interface LocalWorkoutExercise {
  uuid: string;
  workout_uuid: string;
  exercise_uuid: string;
  comment: string | null;
  order_index: number;
  // Sync metadata
  _synced: boolean;
  _updated_at: number;
  _deleted: boolean;
}

export interface LocalWorkoutSet {
  uuid: string;
  workout_exercise_uuid: string;
  weight: number | null;
  repetitions: number | null;
  min_target_reps: number | null;
  max_target_reps: number | null;
  rpe: number | null;
  tag: 'dropSet' | 'failure' | null;
  comment: string | null;
  is_completed: boolean;
  is_pr: boolean;
  order_index: number;
  // Sync metadata
  _synced: boolean;
  _updated_at: number;
  _deleted: boolean;
}

export interface LocalBodyweightLog {
  uuid: string;
  weight_kg: number;
  logged_at: string;
  note: string | null;
  // Sync metadata
  _synced: boolean;
  _updated_at: number;
  _deleted: boolean;
}

export interface LocalMeta {
  key: string;
  value: string | number;
}

// ─── Dexie database ────────────────────────────────────────────────────────────

/** A captured inspo burst photo stored locally before (or independent of) upload. */
export interface LocalInspoPhoto {
  uuid: string;
  burst_group_id: string;
  taken_at: string;
  /** Raw JPEG Blob from canvas.toBlob */
  blob: Blob;
  /** Remote Vercel Blob URL once uploaded; null when still local-only. */
  blob_url: string | null;
  /** '1' when successfully uploaded + registered server-side, '0' otherwise. */
  uploaded: '0' | '1';
  created_at: string;
}

export class IronDB extends Dexie {
  exercises!: Table<LocalExercise, string>;
  workouts!: Table<LocalWorkout, string>;
  workout_exercises!: Table<LocalWorkoutExercise, string>;
  workout_sets!: Table<LocalWorkoutSet, string>;
  bodyweight_logs!: Table<LocalBodyweightLog, string>;
  inspo_photos!: Table<LocalInspoPhoto, string>;
  _meta!: Table<LocalMeta, string>;

  constructor() {
    super('iron-db');

    const stores = {
      exercises: 'uuid, title, is_custom, is_hidden',
      workouts: 'uuid, start_time, is_current, _synced, _updated_at',
      workout_exercises: 'uuid, workout_uuid, exercise_uuid, _synced, _updated_at',
      workout_sets: 'uuid, workout_exercise_uuid, _synced, _updated_at',
      bodyweight_logs: 'uuid, logged_at, _synced, _updated_at',
      _meta: 'key',
    };

    this.version(1).stores(stores);

    // v2: re-hydrate exercises with lowercase UUIDs
    this.version(2).stores(stores).upgrade(async tx => {
      await tx.table('exercises').clear();
      await tx.table('_meta').delete('exercises_hydrated_at');
    });

    // v3: local inspo photos — burst captures persist locally so they survive
    // upload failures. Indexed by taken_at DESC for gallery, uploaded for sync
    // queries, burst_group_id for grouping.
    this.version(3).stores({
      ...stores,
      inspo_photos: 'uuid, burst_group_id, taken_at, uploaded',
    });
  }
}

export const db = new IronDB();

// ─── Meta helpers ──────────────────────────────────────────────────────────────

export async function getMeta(key: string): Promise<string | number | undefined> {
  const row = await db._meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string | number): Promise<void> {
  await db._meta.put({ key, value });
}

// ─── Exercise bootstrap (first-install only) ───────────────────────────────────
//
// The exercise catalog is owned by sync pull (see src/lib/sync.ts and
// src/app/api/sync/pull/route.ts). This function only seeds the bundled
// JSON catalog on a completely empty Dexie so a brand-new install can render
// something before the first network sync completes. After that, sync is
// authoritative — catalog updates (new custom exercises, admin additions,
// cross-device creations) arrive in the same envelope as the workout_exercises
// that reference them, so the two can never drift.

type HydrationListener = (ready: boolean) => void;
const hydrationListeners = new Set<HydrationListener>();
let _exercisesReady = false;

export function isExercisesReady() { return _exercisesReady; }
export function subscribeExercisesReady(fn: HydrationListener) {
  hydrationListeners.add(fn);
  return () => { hydrationListeners.delete(fn); };
}

function setExercisesReady(ready: boolean) {
  _exercisesReady = ready;
  hydrationListeners.forEach(fn => fn(ready));
}

export async function hydrateExercises(): Promise<void> {
  try {
    const count = await db.exercises.count();
    if (count > 0) {
      setExercisesReady(true);
      return;
    }

    // Empty Dexie — seed from bundled catalog so the UI has something to render
    // while the first sync pull completes. Sync will overwrite these with fresh
    // server data on its first successful run.
    const bundledRes = await fetch('/exercises-catalog.json');
    if (!bundledRes.ok) {
      console.warn('[hydrate] bundled catalog fetch failed:', bundledRes.status);
      return;
    }
    const bundled: LocalExercise[] = await bundledRes.json();
    await db.transaction('rw', db.exercises, async () => {
      for (const ex of bundled) await db.exercises.put(ex);
    });
    setExercisesReady(true);
  } catch (e) {
    console.warn('[hydrate] error:', e);
    const count = await db.exercises.count();
    if (count > 0) setExercisesReady(true);
  }
}
