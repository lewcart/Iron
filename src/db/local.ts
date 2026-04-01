import Dexie, { type Table } from 'dexie';
import { apiBase } from '@/lib/api/client';

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

export class IronDB extends Dexie {
  exercises!: Table<LocalExercise, string>;
  workouts!: Table<LocalWorkout, string>;
  workout_exercises!: Table<LocalWorkoutExercise, string>;
  workout_sets!: Table<LocalWorkoutSet, string>;
  bodyweight_logs!: Table<LocalBodyweightLog, string>;
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

// ─── Exercise hydration ────────────────────────────────────────────────────────

const HYDRATE_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

    // If empty, seed from bundled catalog immediately (no network needed)
    if (count === 0) {
      try {
        const bundledRes = await fetch('/exercises-catalog.json');
        if (bundledRes.ok) {
          const bundled: LocalExercise[] = await bundledRes.json();
          await db.exercises.bulkPut(bundled);
          await setMeta('exercises_hydrated_at', Date.now());
        }
      } catch { /* bundled file unavailable */ }
    }

    const freshCount = await db.exercises.count();
    if (freshCount > 0) {
      setExercisesReady(true);
    }

    const lastHydrated = await getMeta('exercises_hydrated_at');
    if (lastHydrated && Date.now() - Number(lastHydrated) < HYDRATE_STALE_MS) {
      return; // Fresh enough
    }

    // Try API for latest data (may include new custom exercises)
    const res = await fetch(`${apiBase()}/api/exercises?limit=10000`);
    if (!res.ok) return;

    const exercises: LocalExercise[] = await res.json();
    await db.exercises.bulkPut(exercises);
    await setMeta('exercises_hydrated_at', Date.now());
    setExercisesReady(true);
  } catch {
    // Network unavailable — mark ready if we have cached data
    const count = await db.exercises.count();
    if (count > 0) setExercisesReady(true);
  }
}
