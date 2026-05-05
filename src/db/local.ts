import Dexie, { type Table } from 'dexie';
import type { MealSlot } from '@/types';

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
  /** How sets for this exercise are tracked: 'reps' (weight × repetitions)
   *  or 'time' (held duration_seconds). Defaults to 'reps'. Defensive
   *  callers should coerce undefined → 'reps' for rows that arrived from
   *  a Dexie v5 store before the v6 schema bump. */
  tracking_mode: 'reps' | 'time';
  /** Number of demo image frames available (0-3). Source-of-truth for
   *  whether the demo strip renders. Frames addressed by exercise.uuid
   *  at public/exercise-images/{uuid}/{01,02,03}.jpg. */
  image_count: number;
  /** Optional YouTube reference URL with start-time embedded. */
  youtube_url: string | null;
  /** Optional Vercel Blob URLs for AI-generated in-app demo images.
   *  When set, takes precedence over the bundled public/ path. */
  image_urls: string[] | null;
  /** When true, the exercise is performed unilaterally (each leg / each
   *  arm). The in-workout stopwatch enters a 10-second switch countdown
   *  after the user stops the first side, then resumes counting up for
   *  the second side. Default false; coerce undefined → false on read for
   *  rows that arrived from a Dexie v19 store before the v20 schema bump. */
  has_sides: boolean;
  /** Marks shoulder lateral-head emphasis. Routine projection (PR3)
   *  derives a virtual delts_lateral row from sets touching exercises
   *  with lateral_emphasis=true. Default false; coerce undefined → false
   *  on read for pre-v22 rows. */
  lateral_emphasis: boolean;
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
  /** Reps in Reserve (0–5). 0=failure, 5=5+ left. NULL=not recorded. */
  rir: number | null;
  tag: 'dropSet' | 'failure' | null;
  comment: string | null;
  is_completed: boolean;
  is_pr: boolean;
  /** True when this set should NOT count toward PR / PB calculations (form
   *  was wrong, partial reps, etc). The set still contributes to volume,
   *  set-counts, and history. Toggle from the per-set action sheet, or in
   *  bulk via the "Adjust PB history" sheet. Default false. */
  excluded_from_pb: boolean;
  order_index: number;
  /** Held duration in seconds. Populated only for time-mode exercise sets;
   *  null for reps-mode sets (which use weight + repetitions instead). */
  duration_seconds: number | null;
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
  /** Days in one cycle (default null = weekly). A 4-day routine with
   *  cycle_length_days=9 delivers ~3.1 days/wk effective frequency. */
  cycle_length_days: number | null;
  /** Explicit ×/wk override. Null = derive from cycle_length_days (or
   *  assume weekly). Use for routines run on irregular cadence. */
  frequency_per_week: number | null;
}

export interface LocalWorkoutRoutineExercise extends SyncMeta {
  uuid: string;
  workout_routine_uuid: string;
  exercise_uuid: string;
  comment: string | null;
  order_index: number;
  /** Rep-window goal (strength|power|build|pump|endurance). See
   *  src/lib/rep-windows.ts for the canonical registry. NULL = unassigned. */
  goal_window: 'strength' | 'power' | 'build' | 'pump' | 'endurance' | null;
}

export interface LocalWorkoutRoutineSet extends SyncMeta {
  uuid: string;
  workout_routine_exercise_uuid: string;
  min_repetitions: number | null;
  max_repetitions: number | null;
  tag: 'dropSet' | null;
  comment: string | null;
  order_index: number;
  /** Routine template target hold in seconds. Populated only for time-mode
   *  exercises. Mirrors min_repetitions/max_repetitions for the rep case. */
  target_duration_seconds: number | null;
  /** Routine template target RIR (0-10). Null = unspecified; projection
   *  treats as low-confidence (no charitable green tick). Mirrors live
   *  workout_sets.rir convention. */
  target_rir: number | null;
}

/**
 * Per-vision per-muscle range and frequency override. Mirrors Postgres
 * vision_muscle_overrides table (migration 044). Postgres uses composite
 * PK (vision_uuid, muscle_slug); locally we derive a single string
 * primary key `id = "${vision_uuid}|${muscle_slug}"` so Dexie bulkDelete
 * works through the generic sync engine. The two underlying fields are
 * denormalized for indexed queries.
 *
 * muscle_slug is text — virtual sub-muscles like 'delts_lateral' have
 * overrides without a taxonomy change.
 */
export interface LocalVisionMuscleOverride extends SyncMeta {
  /** Synthetic primary key: `${vision_uuid}|${muscle_slug}`. */
  id: string;
  vision_uuid: string;
  muscle_slug: string;
  override_sets_min: number | null;
  override_sets_max: number | null;
  override_freq_min: number | null;
  evidence: 'low' | 'medium' | 'high' | null;
  notes: string | null;
}

/** Compose the synthetic primary key for vision_muscle_overrides. */
export function visionOverrideKey(vision_uuid: string, muscle_slug: string): string {
  return `${vision_uuid}|${muscle_slug}`;
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

// ─── Vision / Plan / Checkpoints ──────────────────────────────────────────────
//
// Strategic layer above execution. Vision = aesthetic concept (years, prose-
// first). Plan = time-bound strategy (12-24 months, structured + prose).
// Checkpoint = quarterly review record. JSONB shapes mirror migration 024.

export interface NorthStarMetric {
  metric_key: string;
  baseline_value: number | null;
  baseline_date: string;       // YYYY-MM-DD
  target_value: number | null;
  target_date: string;         // YYYY-MM-DD
  reasoning: string;
}

export interface ProgrammingDose {
  strength_sessions_per_week?: { min: number; max: number; rationale: string };
  cardio_floor_minutes_weekly?: { target: number; rationale: string };
  movement_principles?: string[];
  add_more_when?: string[];
}

export interface NutritionAnchors {
  protein_g_per_kg?: number;
  deficit_approach?: 'aggressive' | 'moderate' | 'maintenance' | 'surplus';
}

export interface LocalBodyVision extends SyncMeta {
  uuid: string;
  title: string;
  body_md: string | null;
  summary: string | null;
  principles: string[];
  build_emphasis: string[];
  maintain_emphasis: string[];
  deemphasize: string[];
  status: 'active' | 'archived';
  archived_at: string | null;
}

export interface LocalBodyPlan extends SyncMeta {
  uuid: string;
  vision_id: string;
  title: string;
  summary: string | null;
  body_md: string | null;
  horizon_months: number;
  start_date: string;          // YYYY-MM-DD
  target_date: string;         // YYYY-MM-DD
  north_star_metrics: NorthStarMetric[];
  programming_dose: ProgrammingDose;
  nutrition_anchors: NutritionAnchors;
  reevaluation_triggers: string[];
  status: 'active' | 'archived' | 'superseded';
}

export interface LocalPlanCheckpoint extends SyncMeta {
  uuid: string;
  plan_id: string;
  quarter_label: string;
  target_date: string;         // YYYY-MM-DD
  review_date: string | null;  // YYYY-MM-DD; null until completed
  status: 'scheduled' | 'completed';
  metrics_snapshot: Record<string, number | null> | null;
  assessment: 'on_track' | 'ahead' | 'behind' | 'reset_required' | null;
  notes: string | null;
  adjustments_made: string[];
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
  meal_slot: MealSlot;
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
  /**
   * ISO timestamp set the first time the standard-week template materialized
   * into nutrition_logs for this date. Once non-null, ensurePlannedLogsForDate
   * is a no-op for this date — even if the user deletes the resulting logs.
   */
  template_applied_at: string | null;
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
//
// Period-based timeline (mirrors Notion HRT Timeline DB). Each row is a
// protocol period with start date + optional end date + the doses taken
// across that span. Adherence ("taken today") is intentionally not tracked
// here — Lewis logs adherence in a separate medications app.

export interface LocalHrtTimelinePeriod extends SyncMeta {
  uuid: string;
  name: string;
  started_at: string;            // YYYY-MM-DD
  ended_at: string | null;       // YYYY-MM-DD; null = current
  doses_e: string | null;        // e.g. "Estrogel 1.5mg estradiol"
  doses_t_blocker: string | null;
  doses_other: string[];         // multi-select
  notes: string | null;
}

// ─── Labs ─────────────────────────────────────────────────────────────────────

export interface LocalLabDraw extends SyncMeta {
  uuid: string;
  drawn_at: string;              // YYYY-MM-DD
  notes: string | null;
  source: string;                // 'manual' | 'notion_import' | etc.
}

export interface LocalLabResult extends SyncMeta {
  uuid: string;
  draw_uuid: string;
  lab_code: string;
  value: number;
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
  /** Pose categorization — mirrors progress_photos.pose so the photos-compare
   *  feature can mix progress + inspo into the same pose-filtered viewer.
   *  Null = legacy row captured before migration 030 (UI prompts to set). */
  pose: 'front' | 'side' | 'back' | 'face_front' | 'face_side' | 'other' | null;
  /** CSS object-position y%, 0-100. NULL = renderer defaults to 50 (center). */
  crop_offset_y?: number | null;
  /** CSS object-position x%, 0-100. See migration 039. */
  crop_offset_x?: number | null;
  /** Server-cached person-segmentation mask URL (Vercel Blob). NULL = not yet
   *  computed. See migration 038. Read-only client-side; server-owned cache. */
  mask_url?: string | null;
}

/** Progress photo metadata — JPEG fetched lazily from blob_url.
 *
 *  Offline-friendly capture (parity with inspo_photos): when the upload to
 *  Vercel Blob is queued/retrying, `blob_url` carries a `local:<uuid>` stub
 *  pointing at the JPEG held in `blob`. Once the upload succeeds the row is
 *  rewritten with the real Vercel URL and `uploaded` flips to '1'; sync push
 *  then carries the metadata forward. Rows with `uploaded='0'` are excluded
 *  from sync push (the `local:` stub would corrupt the server). */
export interface LocalProgressPhoto extends SyncMeta {
  uuid: string;
  blob_url: string;
  pose: 'front' | 'side' | 'back' | 'face_front' | 'face_side' | 'other';
  notes: string | null;
  taken_at: string;
  /** Raw JPEG Blob. Present while `uploaded='0'`; cleared once upload succeeds
   *  to free IDB space. Legacy rows (synced before this column existed) are
   *  null with `uploaded='1'`. */
  blob: Blob | null;
  /** '1' once the JPEG has been pushed to Vercel Blob and `blob_url` carries
   *  the real URL, '0' while the upload is queued/retrying. */
  uploaded: '0' | '1';
  /** CSS object-position y%, 0-100. NULL = renderer defaults to 50 (center).
   *  Auto-filled on capture via best-effort face detection where supported;
   *  manual drag-to-nudge in adjust mode also writes here. */
  crop_offset_y: number | null;
  /** CSS object-position x%, 0-100. See migration 039. Auto-filled by
   *  silhouette-centroid detection (mask_url required) or face-detect
   *  fallback when no mask is cached. */
  crop_offset_x?: number | null;
  /** Server-cached person-segmentation mask URL (Vercel Blob). NULL = not yet
   *  computed. See migration 038. Read-only client-side; server-owned cache. */
  mask_url?: string | null;
}

// ─── Exercise image candidates (read-only, server-owned) ────────────────────
//
// One row per AI-generated frame. Two rows per batch (frame 1 + frame 2,
// generated together). Active pair (one per exercise) is mirrored into
// exercises.image_urls / exercises.image_count for the demo strip.
//
// Pull-only: client never writes. Sync engine stamps _synced=true on apply,
// so the push() dirty-row scan never picks anything up. We deliberately do
// NOT extend SyncMeta on the type — the local writes that would set the
// flags don't exist.

export interface LocalExerciseImageCandidate {
  uuid: string;
  exercise_uuid: string;
  batch_id: string;
  frame_index: 1 | 2;
  url: string;
  is_active: boolean;
  created_at: string;
}

// ─── Muscle taxonomy (read-only catalog, mirrors Postgres `muscles`) ─────────

export interface LocalMuscle {
  slug: string;
  display_name: string;
  parent_group: string;
  optimal_sets_min: number;
  optimal_sets_max: number;
  display_order: number;
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
  body_vision!: Table<LocalBodyVision, string>;
  body_plan!: Table<LocalBodyPlan, string>;
  plan_checkpoint!: Table<LocalPlanCheckpoint, string>;
  nutrition_logs!: Table<LocalNutritionLog, string>;
  nutrition_week_meals!: Table<LocalNutritionWeekMeal, string>;
  nutrition_day_notes!: Table<LocalNutritionDayNote, string>;
  nutrition_targets!: Table<LocalNutritionTarget, number>;
  hrt_timeline_periods!: Table<LocalHrtTimelinePeriod, string>;
  lab_draws!: Table<LocalLabDraw, string>;
  lab_results!: Table<LocalLabResult, string>;
  wellbeing_logs!: Table<LocalWellbeingLog, string>;
  dysphoria_logs!: Table<LocalDysphoriaLog, string>;
  clothes_test_logs!: Table<LocalClothesTestLog, string>;
  progress_photos!: Table<LocalProgressPhoto, string>;

  // ── v9 additions ──
  muscles!: Table<LocalMuscle, string>;

  // ── v15 additions ──
  exercise_image_candidates!: Table<LocalExerciseImageCandidate, string>;

  // ── v22 additions ──
  vision_muscle_overrides!: Table<LocalVisionMuscleOverride, string>;

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

    // v6: HRT timeline + labs replace the old adherence model. Drop the
    // hrt_protocols + hrt_logs Dexie tables (server-side equivalents are
    // dropped in main's migration 020); add hrt_timeline_periods,
    // lab_draws, lab_results.
    const v6Stores = {
      ...v5Stores,
      hrt_protocols: null,
      hrt_logs: null,
      hrt_timeline_periods: 'uuid, started_at, ended_at, _synced, _updated_at',
      lab_draws: 'uuid, drawn_at, _synced, _updated_at',
      lab_results: 'uuid, draw_uuid, lab_code, _synced, _updated_at',
    };
    this.version(6).stores(v6Stores);

    // v7: nutrition upgrade — extend log/week/day-note/target rows with new
    // fields (meal_name, template_meal_id, status on logs; carbs_g/fat_g on
    // week_meals; approved_status/approved_at on day_notes; bands on
    // targets). Existing rows backfilled with safe defaults via upgrade tx.
    // No new indexed fields — none of the new columns are queried by index.
    this.version(7).stores(v6Stores).upgrade(async tx => {
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

    // v8: time-based exercises (mirrors Postgres migration 022).
    // tracking_mode lives on exercises; duration_seconds on workout_sets;
    // target_duration_seconds on workout_routine_sets. All additive — Dexie
    // tolerates missing fields on existing rows, and read sites coerce
    // undefined → 'reps' / null defensively. No upgrade hook needed.
    this.version(8).stores(v6Stores);

    // v9: exercise demo assets (mirrors Postgres migration 023).
    // image_count (0-3), youtube_url (nullable), image_urls (Blob URLs for
    // AI-generated in-app images). All additive. Backfill defaults so old
    // rows pushed via sync don't fail the server-side NOT NULL constraint
    // on image_count.
    this.version(9).stores(v6Stores).upgrade(async tx => {
      await tx.table('exercises').toCollection().modify(row => {
        if (row.image_count === undefined) row.image_count = 0;
        if (row.youtube_url === undefined) row.youtube_url = null;
        if (row.image_urls === undefined) row.image_urls = null;
      });
    });

    // v10: strategic layer — body_vision + body_plan + plan_checkpoint
    // (mirrors Postgres migration 024). All synced via change_log. Indexes:
    // status (for active-row lookups), vision_id / plan_id (for FK joins),
    // target_date on checkpoints (for chronological listing). plan_dose_revision
    // is server-only and not represented in Dexie.
    const v10Stores = {
      ...v6Stores,
      body_vision: 'uuid, status, _synced, _updated_at',
      body_plan: 'uuid, vision_id, status, _synced, _updated_at',
      plan_checkpoint: 'uuid, plan_id, target_date, status, _synced, _updated_at',
    };
    this.version(10).stores(v10Stores);

    // v11: canonical muscle taxonomy (mirrors Postgres migration 026).
    //
    // Adds muscles table (read-only, server-owned) and clears the existing
    // exercises table so hydrateExercises() re-pulls from the canonical
    // bundled catalog on next launch. UUIDs are preserved across the rewrite
    // (catalog rewrite only touched primary_muscles/secondary_muscles arrays),
    // so workout_exercises.exercise_uuid references stay valid through the
    // window between clear() and hydrate.
    //
    // Pattern mirrors v2's exercise re-hydration: clear table + delete the
    // hydrated_at marker so the next hydrate runs.
    const v11Stores = {
      ...v10Stores,
      muscles: 'slug, display_order, parent_group',
    };
    this.version(11).stores(v11Stores).upgrade(async tx => {
      await tx.table('exercises').clear();
      await tx.table('_meta').delete('exercises_hydrated_at');
    });

    // v12: Reps in Reserve (mirrors Postgres migration 028_rir_column).
    // workout_sets.rir is purely additive — Dexie tolerates the undefined
    // field on existing rows, sync overwrites with the server value (NULL
    // for un-logged sets) on next pull. No upgrade hook needed.
    this.version(12).stores(v11Stores);

    // v13: pose tag on inspo photos (mirrors Postgres migration 030).
    const v13Stores = {
      ...v11Stores,
      inspo_photos: 'uuid, burst_group_id, taken_at, uploaded, pose',
    };
    this.version(13).stores(v13Stores).upgrade(async tx => {
      await tx.table('inspo_photos').toCollection().modify(row => {
        if (row.pose === undefined) row.pose = null;
      });
    });

    // v14: offline-friendly progress photo capture (parity with inspo_photos).
    // Adds `blob` (Blob | null) and `uploaded` ('0' | '1') so the JPEG can be
    // held locally while the Vercel Blob upload is queued/retrying.
    const v14Stores = {
      ...v13Stores,
      progress_photos: 'uuid, taken_at, pose, uploaded, _synced, _updated_at',
    };
    this.version(14).stores(v14Stores).upgrade(async tx => {
      await tx.table('progress_photos').toCollection().modify(row => {
        if (row.uploaded === undefined) row.uploaded = '1';
        if (row.blob === undefined) row.blob = null;
      });
    });

    // v15: goal_window on workout_routine_exercises (mirrors Postgres
    // migration 031_routine_exercise_goal_window). Additive non-indexed
    // column — no schema-string change. Existing rows get undefined
    // locally; the next sync pull overwrites with NULL.
    this.version(15).stores(v14Stores);

    // v16: exercise image candidates (mirrors Postgres migration
    // 032_exercise_image_candidates). Read-only on the client; sync pull
    // is the only writer. Indexes: exercise_uuid (live-query the strip),
    // batch_id (group history tiles), [exercise_uuid+is_active] (find the
    // current pair), created_at (history sort).
    const v16Stores = {
      ...v14Stores,
      exercise_image_candidates:
        'uuid, exercise_uuid, batch_id, [exercise_uuid+is_active], created_at',
    };
    this.version(16).stores(v16Stores);

    // v17: standard-week template auto-fill (mirrors Postgres migration
    // 036_nutrition_week_template_autofill). Backfills meal_slot to the
    // strict enum {breakfast,lunch,dinner,snack} — anything not matching
    // breakfast/lunch/dinner falls into snack, matching the SQL backfill.
    // Also adds template_applied_at on day notes (default null).
    this.version(17).stores(v16Stores).upgrade(async tx => {
      await tx.table('nutrition_week_meals').toCollection().modify(row => {
        const raw = String(row.meal_slot ?? '').toLowerCase();
        if (raw.includes('breakfast')) row.meal_slot = 'breakfast';
        else if (raw.includes('lunch')) row.meal_slot = 'lunch';
        else if (raw.includes('dinner')) row.meal_slot = 'dinner';
        else row.meal_slot = 'snack';
      });
      await tx.table('nutrition_day_notes').toCollection().modify(row => {
        if (row.template_applied_at === undefined) row.template_applied_at = null;
      });
    });
    // v18: photo segmentation masks for /photos/compare silhouette mode.
    // Server-cached mask URL (Vercel Blob) on progress + inspo photos. Stores
    // shape unchanged (mask_url is not indexed). Backfill mask_url=null on
    // existing rows so reads after upgrade get a defined value, not undefined.
    this.version(18).stores(v16Stores).upgrade(async tx => {
      await tx.table('progress_photos').toCollection().modify(row => {
        if (row.mask_url === undefined) row.mask_url = null;
      });
      await tx.table('inspo_photos').toCollection().modify(row => {
        if (row.mask_url === undefined) row.mask_url = null;
      });
    });
    // v19: horizontal alignment offset for the silhouette venn (positional
    // drift was reading as shape change). Stores shape unchanged
    // (crop_offset_x not indexed). Backfill crop_offset_x=null on existing
    // rows so reads after upgrade get a defined value, not undefined.
    this.version(19).stores(v16Stores).upgrade(async tx => {
      await tx.table('progress_photos').toCollection().modify(row => {
        if (row.crop_offset_x === undefined) row.crop_offset_x = null;
      });
      await tx.table('inspo_photos').toCollection().modify(row => {
        if (row.crop_offset_x === undefined) row.crop_offset_x = null;
      });
    });
    // v20: exercises.has_sides — unilateral flag for the in-workout
    // stopwatch's switch-sides countdown. Mirrors Postgres migration 041.
    // Stores shape unchanged (has_sides is not indexed). Backfill false on
    // existing rows so reads after upgrade get a defined boolean.
    this.version(20).stores(v16Stores).upgrade(async tx => {
      await tx.table('exercises').toCollection().modify(row => {
        if (row.has_sides === undefined) row.has_sides = false;
      });
    });

    // v21: per-set "excluded from PB" flag. Lets Lou invalidate PRs that came
    // from sets done with bad form without losing the workout record. Stores
    // shape unchanged (excluded_from_pb is not indexed). Backfill to false on
    // existing rows so reads after upgrade get a defined value, not undefined.
    // Renumbered from v20 → v21 during merge: v20 is taken by has_sides on main.
    // Mirrors Postgres migration 042 (renumbered from 041 same reason).
    this.version(21).stores(v16Stores).upgrade(async tx => {
      await tx.table('workout_sets').toCollection().modify(row => {
        if (row.excluded_from_pb === undefined) row.excluded_from_pb = false;
      });
    });

    // v22: routine volume fit check (mirrors Postgres migration 044).
    //
    //   - workout_routine_sets.target_rir (additive nullable column,
    //     not indexed)
    //   - workout_routines.cycle_length_days + frequency_per_week
    //     (additive nullable, not indexed)
    //   - exercises.lateral_emphasis (additive boolean default false)
    //   - vision_muscle_overrides (NEW table — composite key on
    //     [vision_uuid+muscle_slug])
    //
    // Backfill defaults so reads on pre-v22 rows return defined values
    // rather than undefined.
    const v22Stores = {
      ...v16Stores,
      // Synthetic single-string PK = `${vision_uuid}|${muscle_slug}` so the
      // generic sync bulkDelete path works (it operates on string row_uuids
      // from change_log). vision_uuid + muscle_slug indexed for query.
      vision_muscle_overrides: 'id, vision_uuid, muscle_slug, _synced, _updated_at',
    };
    this.version(22).stores(v22Stores).upgrade(async tx => {
      await tx.table('workout_routine_sets').toCollection().modify(row => {
        if (row.target_rir === undefined) row.target_rir = null;
      });
      await tx.table('workout_routines').toCollection().modify(row => {
        if (row.cycle_length_days === undefined) row.cycle_length_days = null;
        if (row.frequency_per_week === undefined) row.frequency_per_week = null;
      });
      await tx.table('exercises').toCollection().modify(row => {
        if (row.lateral_emphasis === undefined) row.lateral_emphasis = false;
      });
    });

    // versionchange handler — when a new SW activates and the next page
    // load opens the DB at v22+, Dexie fires versionchange on existing
    // open connections. Without handling, those connections deadlock the
    // upgrade. Close + reload so the new schema actually takes effect.
    this.on('versionchange', () => {
      this.close();
      if (typeof window !== 'undefined') window.location.reload();
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
          tracking_mode: ex.tracking_mode ?? 'reps',
          image_count: ex.image_count ?? 0,
          youtube_url: ex.youtube_url ?? null,
          image_urls: ex.image_urls ?? null,
          has_sides: ex.has_sides ?? false,
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
