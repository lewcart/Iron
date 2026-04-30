import Dexie, { type Table } from 'dexie';

// ─── Sync metadata (shared by every synced table) ─────────────────────────────

export interface SyncMeta {
  /** True once the row has been pushed to server. False = dirty, push pending. */
  _synced: boolean;
  /** Epoch ms of last local mutation. */
  _updated_at: number;
  /** Soft-delete flag — row is hidden in queries, gets pushed as DELETE then purged. */
  _deleted: boolean;
}

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

export interface LocalWorkout extends SyncMeta {
  uuid: string;
  start_time: string;
  end_time: string | null;
  title: string | null;
  comment: string | null;
  is_current: boolean;
  workout_routine_uuid: string | null;
}

export interface LocalWorkoutExercise extends SyncMeta {
  uuid: string;
  workout_uuid: string;
  exercise_uuid: string;
  comment: string | null;
  order_index: number;
}

export interface LocalWorkoutSet extends SyncMeta {
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
}

export interface LocalBodyweightLog extends SyncMeta {
  uuid: string;
  weight_kg: number;
  logged_at: string;
  note: string | null;
}

// ─── Plans / routines ─────────────────────────────────────────────────────────

export interface LocalWorkoutPlan extends SyncMeta {
  uuid: string;
  title: string | null;
  order_index: number;
  is_active: boolean;
}

export interface LocalWorkoutRoutine extends SyncMeta {
  uuid: string;
  workout_plan_uuid: string;
  title: string | null;
  comment: string | null;
  order_index: number;
}

export interface LocalWorkoutRoutineExercise extends SyncMeta {
  uuid: string;
  workout_routine_uuid: string;
  exercise_uuid: string;
  comment: string | null;
  order_index: number;
}

export interface LocalWorkoutRoutineSet extends SyncMeta {
  uuid: string;
  workout_routine_exercise_uuid: string;
  min_repetitions: number | null;
  max_repetitions: number | null;
  tag: 'dropSet' | null;
  comment: string | null;
  order_index: number;
}

// ─── Body spec / measurements / inbody / goals ───────────────────────────────

export interface LocalBodySpecLog extends SyncMeta {
  uuid: string;
  height_cm: number | null;
  weight_kg: number | null;
  body_fat_pct: number | null;
  lean_mass_kg: number | null;
  notes: string | null;
  measured_at: string;
}

export interface LocalMeasurementLog extends SyncMeta {
  uuid: string;
  site: string;
  value_cm: number;
  notes: string | null;
  measured_at: string;
  source: string | null;
  source_ref: string | null;
}

/** InBody scan — wide schema, mirrors server inbody_scans columns 1:1. */
export interface LocalInbodyScan extends SyncMeta {
  uuid: string;
  scanned_at: string;
  device: string;
  venue: string | null;
  age_at_scan: number | null;
  height_cm: number | null;

  weight_kg: number | null;
  total_body_water_l: number | null;
  intracellular_water_l: number | null;
  extracellular_water_l: number | null;
  protein_kg: number | null;
  minerals_kg: number | null;
  bone_mineral_kg: number | null;
  body_fat_mass_kg: number | null;
  smm_kg: number | null;

  bmi: number | null;
  pbf_pct: number | null;
  whr: number | null;
  inbody_score: number | null;
  visceral_fat_level: number | null;
  bmr_kcal: number | null;
  body_cell_mass_kg: number | null;
  ecw_ratio: number | null;

  seg_lean_right_arm_kg: number | null; seg_lean_right_arm_pct: number | null;
  seg_lean_left_arm_kg: number | null;  seg_lean_left_arm_pct: number | null;
  seg_lean_trunk_kg: number | null;     seg_lean_trunk_pct: number | null;
  seg_lean_right_leg_kg: number | null; seg_lean_right_leg_pct: number | null;
  seg_lean_left_leg_kg: number | null;  seg_lean_left_leg_pct: number | null;

  seg_fat_right_arm_kg: number | null;  seg_fat_right_arm_pct: number | null;
  seg_fat_left_arm_kg: number | null;   seg_fat_left_arm_pct: number | null;
  seg_fat_trunk_kg: number | null;      seg_fat_trunk_pct: number | null;
  seg_fat_right_leg_kg: number | null;  seg_fat_right_leg_pct: number | null;
  seg_fat_left_leg_kg: number | null;   seg_fat_left_leg_pct: number | null;

  circ_neck_cm: number | null;
  circ_chest_cm: number | null;
  circ_abdomen_cm: number | null;
  circ_hip_cm: number | null;
  circ_right_arm_cm: number | null;
  circ_left_arm_cm: number | null;
  circ_right_thigh_cm: number | null;
  circ_left_thigh_cm: number | null;
  arm_muscle_circumference_cm: number | null;

  soft_lean_mass_kg: number | null;
  fat_free_mass_kg: number | null;

  target_weight_kg: number | null;
  weight_control_kg: number | null;
  fat_control_kg: number | null;
  muscle_control_kg: number | null;

  balance_upper: 'balanced' | 'under' | 'over' | 'slightly_under' | 'slightly_over' | null;
  balance_lower: 'balanced' | 'under' | 'over' | 'slightly_under' | 'slightly_over' | null;
  balance_upper_lower: 'balanced' | 'under' | 'over' | 'slightly_under' | 'slightly_over' | null;

  impedance: Record<string, Record<string, number>>;
  notes: string | null;
  raw_json: Record<string, unknown>;
}

/** Body goal — keyed by metric_key, not uuid. */
export interface LocalBodyGoal extends SyncMeta {
  metric_key: string;
  target_value: number;
  unit: string;
  direction: 'higher' | 'lower' | 'match';
  notes: string | null;
}

// ─── Nutrition ────────────────────────────────────────────────────────────────

export interface LocalNutritionLog extends SyncMeta {
  uuid: string;
  logged_at: string;
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other' | null;
  meal_name: string | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  notes: string | null;
  template_meal_id: string | null;
  status: 'planned' | 'deviation' | 'added' | null;
}

export interface LocalNutritionWeekMeal extends SyncMeta {
  uuid: string;
  day_of_week: number;
  meal_slot: string;
  meal_name: string;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  calories: number | null;
  quality_rating: number | null;
  sort_order: number;
}

export interface LocalNutritionDayNote extends SyncMeta {
  uuid: string;
  date: string;
  hydration_ml: number | null;
  notes: string | null;
  approved_status: 'pending' | 'approved';
  approved_at: string | null;
}

export interface MacroBand {
  low: number;
  high: number | null;
}

export interface MacroBands {
  cal?: MacroBand;
  pro?: MacroBand;
  carb?: MacroBand;
  fat?: MacroBand;
}

/** Singleton — keyed by id=1 in Dexie too. */
export interface LocalNutritionTarget extends SyncMeta {
  id: number;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  bands: MacroBands | null;
}

// ─── HRT ──────────────────────────────────────────────────────────────────────

export interface LocalHrtProtocol extends SyncMeta {
  uuid: string;
  medication: string;
  dose_description: string;
  form: 'gel' | 'patch' | 'injection' | 'oral' | 'other';
  started_at: string;
  ended_at: string | null;
  includes_blocker: boolean;
  blocker_name: string | null;
  notes: string | null;
}

export interface LocalHrtLog extends SyncMeta {
  uuid: string;
  logged_at: string;
  medication: string;
  dose_mg: number | null;
  route: 'injection' | 'topical' | 'oral' | 'patch' | 'other' | null;
  notes: string | null;
  taken: boolean;
  hrt_protocol_uuid: string | null;
}

// ─── Wellbeing / dysphoria / clothes ──────────────────────────────────────────

export interface LocalWellbeingLog extends SyncMeta {
  uuid: string;
  logged_at: string;
  mood: number | null;
  energy: number | null;
  sleep_hours: number | null;
  sleep_quality: number | null;
  stress: number | null;
  notes: string | null;
}

export interface LocalDysphoriaLog extends SyncMeta {
  uuid: string;
  logged_at: string;
  scale: number;
  note: string | null;
}

export interface LocalClothesTestLog extends SyncMeta {
  uuid: string;
  logged_at: string;
  outfit_description: string;
  photo_url: string | null;
  comfort_rating: number | null;
  euphoria_rating: number | null;
  notes: string | null;
}

// ─── Photos ──────────────────────────────────────────────────────────────────

/** A captured inspo burst photo — preserves Blob locally before upload. */
export interface LocalInspoPhoto extends Partial<SyncMeta> {
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
  notes: string | null;
}

/** Progress photo metadata — JPEG fetched lazily from blob_url. */
export interface LocalProgressPhoto extends SyncMeta {
  uuid: string;
  blob_url: string;
  pose: 'front' | 'side' | 'back';
  notes: string | null;
  taken_at: string;
}

// ─── Meta ────────────────────────────────────────────────────────────────────

export interface LocalMeta {
  key: string;
  value: string | number;
}

// ─── Dexie database ──────────────────────────────────────────────────────────

export class IronDB extends Dexie {
  exercises!: Table<LocalExercise, string>;
  workouts!: Table<LocalWorkout, string>;
  workout_exercises!: Table<LocalWorkoutExercise, string>;
  workout_sets!: Table<LocalWorkoutSet, string>;
  bodyweight_logs!: Table<LocalBodyweightLog, string>;
  inspo_photos!: Table<LocalInspoPhoto, string>;
  _meta!: Table<LocalMeta, string>;

  // ── v4 additions ──
  workout_plans!: Table<LocalWorkoutPlan, string>;
  workout_routines!: Table<LocalWorkoutRoutine, string>;
  workout_routine_exercises!: Table<LocalWorkoutRoutineExercise, string>;
  workout_routine_sets!: Table<LocalWorkoutRoutineSet, string>;
  body_spec_logs!: Table<LocalBodySpecLog, string>;
  measurement_logs!: Table<LocalMeasurementLog, string>;
  inbody_scans!: Table<LocalInbodyScan, string>;
  body_goals!: Table<LocalBodyGoal, string>;
  nutrition_logs!: Table<LocalNutritionLog, string>;
  nutrition_week_meals!: Table<LocalNutritionWeekMeal, string>;
  nutrition_day_notes!: Table<LocalNutritionDayNote, string>;
  nutrition_targets!: Table<LocalNutritionTarget, number>;
  hrt_protocols!: Table<LocalHrtProtocol, string>;
  hrt_logs!: Table<LocalHrtLog, string>;
  wellbeing_logs!: Table<LocalWellbeingLog, string>;
  dysphoria_logs!: Table<LocalDysphoriaLog, string>;
  clothes_test_logs!: Table<LocalClothesTestLog, string>;
  progress_photos!: Table<LocalProgressPhoto, string>;

  constructor() {
    super('iron-db');

    const v1Stores = {
      exercises: 'uuid, title, is_custom, is_hidden',
      workouts: 'uuid, start_time, is_current, _synced, _updated_at',
      workout_exercises: 'uuid, workout_uuid, exercise_uuid, _synced, _updated_at',
      workout_sets: 'uuid, workout_exercise_uuid, _synced, _updated_at',
      bodyweight_logs: 'uuid, logged_at, _synced, _updated_at',
      _meta: 'key',
    };

    this.version(1).stores(v1Stores);

    // v2: re-hydrate exercises with lowercase UUIDs
    this.version(2).stores(v1Stores).upgrade(async tx => {
      await tx.table('exercises').clear();
      await tx.table('_meta').delete('exercises_hydrated_at');
    });

    // v3: local inspo photos — burst captures persist locally so they survive
    // upload failures.
    const v3Stores = {
      ...v1Stores,
      inspo_photos: 'uuid, burst_group_id, taken_at, uploaded',
    };
    this.version(3).stores(v3Stores);

    // v4: local-first migration — every domain the app reads gets a Dexie
    // table with sync metadata. Sync engine pulls change_log seq cursor and
    // fans out to per-domain row fetches; pages render from useLiveQuery.
    //
    // Indexes: every table has _synced + _updated_at so push() can find dirty
    // rows quickly. Domain-relevant indexes (workout_plan_uuid, measured_at,
    // logged_at, taken_at, etc.) so list views sort cheaply.
    const v4Stores = {
      ...v3Stores,
      workout_plans: 'uuid, order_index, _synced, _updated_at',
      workout_routines: 'uuid, workout_plan_uuid, order_index, _synced, _updated_at',
      workout_routine_exercises: 'uuid, workout_routine_uuid, exercise_uuid, order_index, _synced, _updated_at',
      workout_routine_sets: 'uuid, workout_routine_exercise_uuid, order_index, _synced, _updated_at',
      body_spec_logs: 'uuid, measured_at, _synced, _updated_at',
      measurement_logs: 'uuid, site, measured_at, source_ref, _synced, _updated_at',
      inbody_scans: 'uuid, scanned_at, _synced, _updated_at',
      body_goals: 'metric_key, _synced, _updated_at',
      nutrition_logs: 'uuid, logged_at, meal_type, _synced, _updated_at',
      nutrition_week_meals: 'uuid, day_of_week, sort_order, _synced, _updated_at',
      nutrition_day_notes: 'uuid, date, _synced, _updated_at',
      nutrition_targets: 'id, _synced, _updated_at',
      hrt_protocols: 'uuid, started_at, _synced, _updated_at',
      hrt_logs: 'uuid, logged_at, hrt_protocol_uuid, _synced, _updated_at',
      wellbeing_logs: 'uuid, logged_at, _synced, _updated_at',
      dysphoria_logs: 'uuid, logged_at, _synced, _updated_at',
      clothes_test_logs: 'uuid, logged_at, _synced, _updated_at',
      progress_photos: 'uuid, taken_at, pose, _synced, _updated_at',
    };
    this.version(4).stores(v4Stores);

    // v5: index workout_plans.is_active for fast active-plan lookup. The
    // is_active field was always synced (added in migration 006) but wasn't
    // indexed, forcing a full scan to find the active plan. Schema-only
    // change — no data transformation, existing rows pick up the index on
    // upgrade.
    const v5Stores = {
      ...v4Stores,
      workout_plans: 'uuid, order_index, is_active, _synced, _updated_at',
    };
    this.version(5).stores(v5Stores);

    // v6: nutrition upgrade — extend log/week/day-note/target rows with new
    // fields (meal_name, template_meal_id, status on logs; carbs_g/fat_g on
    // week_meals; approved_status/approved_at on day_notes; bands on
    // targets). Existing rows backfilled with safe defaults via upgrade tx.
    // No new indexed fields — none of the new columns are queried by index.
    this.version(6).stores(v5Stores).upgrade(async tx => {
      await tx.table('nutrition_logs').toCollection().modify(row => {
        if (row.meal_name === undefined) row.meal_name = null;
        if (row.template_meal_id === undefined) row.template_meal_id = null;
        if (row.status === undefined) row.status = null;
      });
      await tx.table('nutrition_week_meals').toCollection().modify(row => {
        if (row.carbs_g === undefined) row.carbs_g = null;
        if (row.fat_g === undefined) row.fat_g = null;
      });
      await tx.table('nutrition_day_notes').toCollection().modify(row => {
        if (row.approved_status === undefined) row.approved_status = 'pending';
        if (row.approved_at === undefined) row.approved_at = null;
      });
      await tx.table('nutrition_targets').toCollection().modify(row => {
        if (row.bands === undefined) row.bands = null;
      });
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
//
// CRITICAL: bundled UUIDs are lowercased before insert because sync/pull and
// every lookup site lowercases too. Any mixed-case UUID slipping through here
// produces a permanent miss until sync overwrites the row — that's the root
// cause of the "Unknown Exercise" flash bug fixed in 2026-04-30.

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
    const bundled: Array<Partial<LocalExercise> & { uuid: string }> = await bundledRes.json();
    await db.transaction('rw', db.exercises, async () => {
      for (const ex of bundled) {
        // Normalize UUID case AND fill in any fields the bundled JSON omitted.
        // The bundled catalog was built before is_custom/is_hidden/movement_pattern
        // were schema fields; keep defaults so Dexie strict mode is happy.
        await db.exercises.put({
          uuid: ex.uuid.toLowerCase(),
          everkinetic_id: ex.everkinetic_id ?? 0,
          title: ex.title ?? 'Unknown',
          alias: ex.alias ?? [],
          description: ex.description ?? null,
          primary_muscles: ex.primary_muscles ?? [],
          secondary_muscles: ex.secondary_muscles ?? [],
          equipment: ex.equipment ?? [],
          steps: ex.steps ?? [],
          tips: ex.tips ?? [],
          is_custom: ex.is_custom ?? false,
          is_hidden: ex.is_hidden ?? false,
          movement_pattern: ex.movement_pattern ?? null,
        });
      }
    });
    setExercisesReady(true);
  } catch (e) {
    console.warn('[hydrate] error:', e);
    const count = await db.exercises.count();
    if (count > 0) setExercisesReady(true);
  }
}
