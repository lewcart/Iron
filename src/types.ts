// Core data types for Iron workout tracker

export interface Exercise {
  uuid: string;
  everkinetic_id: number;
  title: string;
  alias: string[]; // JSON array
  description: string | null;
  primary_muscles: string[]; // JSON array
  secondary_muscles: string[]; // JSON array
  equipment: string[]; // JSON array
  steps: string[]; // JSON array
  tips: string[]; // JSON array
  is_custom: boolean;
  is_hidden: boolean;
  movement_pattern: string | null;
}

export interface Workout {
  uuid: string;
  start_time: string; // ISO date string
  end_time: string | null;
  title: string | null;
  comment: string | null;
  is_current: boolean;
}

export interface WorkoutExercise {
  uuid: string;
  workout_uuid: string;
  exercise_uuid: string;
  comment: string | null;
  order_index: number;
}

export interface WorkoutSet {
  uuid: string;
  workout_exercise_uuid: string;
  weight: number | null;
  repetitions: number | null;
  min_target_reps: number | null;
  max_target_reps: number | null;
  rpe: number | null; // 7.0-10.0 by 0.5
  tag: 'dropSet' | 'failure' | null;
  comment: string | null;
  is_completed: boolean;
  is_pr: boolean;
  order_index: number;
}

export interface WorkoutPlan {
  uuid: string;
  title: string | null;
  order_index: number;
}

export interface WorkoutRoutine {
  uuid: string;
  workout_plan_uuid: string;
  title: string | null;
  comment: string | null;
  order_index: number;
}

export interface WorkoutRoutineExercise {
  uuid: string;
  workout_routine_uuid: string;
  exercise_uuid: string;
  comment: string | null;
  order_index: number;
  /** Present when joined from exercises table (plans UI, exports). */
  exercise_title?: string | null;
  /** Present when fetched with sets (plans UI). */
  sets?: WorkoutRoutineSet[];
}

export interface WorkoutRoutineSet {
  uuid: string;
  workout_routine_exercise_uuid: string;
  min_repetitions: number | null;
  max_repetitions: number | null;
  tag: 'dropSet' | null;
  comment: string | null;
  order_index: number;
}

// Helper types
export type MuscleGroup = 'abdominals' | 'arms' | 'back' | 'chest' | 'legs' | 'shoulders';
export type RPEValue = 7.0 | 7.5 | 8.0 | 8.5 | 9.0 | 9.5 | 10.0;
export type SetTag = 'dropSet' | 'failure';

// Computed data types
export interface WorkoutWithStats extends Workout {
  duration_minutes: number | null;
  total_sets: number;
  completed_sets: number;
  total_weight: number;
  muscle_groups: string[];
}

export interface ExerciseHistory {
  exercise: Exercise;
  workouts: {
    workout_uuid: string;
    workout_date: string;
    sets: WorkoutSet[];
  }[];
}

export interface PersonalRecord {
  exercise_uuid: string;
  weight: number;
  repetitions: number;
  estimated_1rm: number;
  date: string;
  workout_uuid: string;
}

export interface BodyweightLog {
  uuid: string;
  weight_kg: number;
  logged_at: string;
  note: string | null;
  /** Set by importers for idempotent re-import */
  dedupe_key: string | null;
}

// ===== REBIRTH MODULES 2–6 =====

export interface BodySpecLog {
  uuid: string;
  height_cm: number | null;
  weight_kg: number | null;
  body_fat_pct: number | null;
  lean_mass_kg: number | null;
  notes: string | null;
  measured_at: string;
}

export type MeasurementSite =
  | 'chest' | 'waist' | 'hips' | 'neck'
  | 'left_bicep' | 'right_bicep'
  | 'left_forearm' | 'right_forearm'
  | 'left_thigh' | 'right_thigh'
  | 'left_calf' | 'right_calf'
  | 'shoulders' | 'abdomen';

export interface MeasurementLog {
  uuid: string;
  site: string;
  value_cm: number;
  notes: string | null;
  measured_at: string;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';
export type NutritionLogStatus = 'planned' | 'deviation' | 'added';

export interface NutritionLog {
  uuid: string;
  logged_at: string;
  meal_type: MealType | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  notes: string | null;
  meal_name: string | null;
  template_meal_id: string | null;
  status: NutritionLogStatus | null;
  /** Stable key for idempotent imports (e.g. Fitbee meal aggregates) */
  external_ref: string | null;
}

/** One row from a Fitbee-style food CSV (before DB insert). */
export interface FitbeeFoodRowParsed {
  logged_at_iso: string;
  day_local: string;
  meal_type: MealType;
  food_name: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  nutrients: Record<string, number | string | null>;
}

export interface FitbeeWaterRowParsed {
  date: string;
  ml: number;
}

export interface FitbeeWeightRowParsed {
  logged_at_iso: string;
  weight_kg: number;
  note: string | null;
}

export interface FitbeeActivityRowParsed {
  logged_at_iso: string;
  activity_name: string;
  calories_burned: number | null;
}

export interface FitbeeImportSummary {
  batch_uuid: string;
  food_entries_inserted: number;
  food_entries_skipped_duplicates: number;
  nutrition_aggregates_upserted: number;
  water_days_updated: number;
  weights_inserted: number;
  weights_skipped_duplicates: number;
  activities_inserted: number;
  activities_skipped_duplicates: number;
  warnings: string[];
}

export interface NutritionWeekMeal {
  uuid: string;
  day_of_week: number; // 0=Mon … 6=Sun
  meal_slot: string;
  meal_name: string;
  protein_g: number | null;
  calories: number | null;
  quality_rating: number | null; // 1–5
  sort_order: number;
}

export interface NutritionDayNote {
  uuid: string;
  date: string; // YYYY-MM-DD
  hydration_ml: number | null;
  notes: string | null;
  updated_at: string;
}

export type HrtRoute = 'injection' | 'topical' | 'oral' | 'patch' | 'other';
export type HrtForm = 'gel' | 'patch' | 'injection' | 'oral' | 'other';

export interface HrtProtocol {
  uuid: string;
  medication: string;
  dose_description: string;
  form: HrtForm;
  started_at: string;   // DATE as ISO string
  ended_at: string | null;
  includes_blocker: boolean;
  blocker_name: string | null;
  notes: string | null;
  created_at: string;
}

export interface HrtLog {
  uuid: string;
  logged_at: string;
  medication: string;
  dose_mg: number | null;
  route: HrtRoute | null;
  notes: string | null;
  taken: boolean;
  protocol_uuid: string | null;
}

export interface WellbeingLog {
  uuid: string;
  logged_at: string;
  mood: number | null;       // 1–10
  energy: number | null;     // 1–10
  sleep_hours: number | null;
  sleep_quality: number | null; // 1–10
  stress: number | null;     // 1–10
  notes: string | null;
}

// Module 10: Dysphoria/euphoria journal
export interface DysphoriaLog {
  uuid: string;
  logged_at: string;
  scale: number;      // 1–10 (1 = high dysphoria, 10 = high euphoria)
  note: string | null;
}

// Module 10: Clothes test log
export interface ClothesTestLog {
  uuid: string;
  logged_at: string;
  outfit_description: string;
  photo_url: string | null;
  comfort_rating: number | null;   // 1–10
  euphoria_rating: number | null;  // 1–10
  notes: string | null;
}

// Module 7: Progress photos
export type ProgressPhotoPose = 'front' | 'side' | 'back';

export interface ProgressPhoto {
  uuid: string;
  blob_url: string;
  pose: ProgressPhotoPose;
  notes: string | null;
  taken_at: string;
}
