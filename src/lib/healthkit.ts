import { registerPlugin } from '@capacitor/core';

export interface SaveWorkoutOptions {
  activityType: 'traditionalStrengthTraining' | 'walking';
  startTime: number; // epoch ms
  endTime: number;   // epoch ms
  activeEnergyKcal: number;
  uuid?: string;
  metadata?: string; // JSON-encoded extra info
}

export interface HealthWorkout {
  startTime: number;       // epoch ms
  endTime: number;         // epoch ms
  durationMinutes: number;
  activeCalories: number;
  activityType: string;
  distanceMeters?: number;
}

export interface WorkoutRecord {
  activityType: string;
  durationMinutes: number;
  activeCalories: number;
  distanceMeters: number;
  startTime: number; // epoch ms
  endTime: number;   // epoch ms
}

export interface HeartRateSample {
  bpm: number;
  timestamp: number; // epoch ms
}

export interface HealthSummary {
  steps: number;
  activeCalories: number;
  recentWorkouts: HealthWorkout[];
}

// ── Quantity metrics supported by fetchDailyAggregates ───────────────────────

export type QuantityMetric =
  | 'steps'
  | 'active_energy'
  | 'basal_energy'
  | 'exercise_minutes'
  | 'heart_rate'
  | 'hrv'
  | 'resting_hr'
  | 'vo2_max';

export const QUANTITY_METRICS: QuantityMetric[] = [
  'steps', 'active_energy', 'basal_energy', 'exercise_minutes',
  'heart_rate', 'hrv', 'resting_hr', 'vo2_max',
];

export interface DailyAggregateRow {
  metric: QuantityMetric;
  date: string;            // YYYY-MM-DD
  value_min?: number;
  value_max?: number;
  value_avg?: number;
  value_sum?: number;
  count?: number;
  source_primary?: string;
}

export interface SleepNight {
  date: string;            // YYYY-MM-DD (wake date)
  start_at: number;        // epoch ms
  end_at: number;          // epoch ms
  asleep_min: number;
  rem_min: number;
  deep_min: number;
  core_min: number;
  awake_min: number;
  in_bed_min: number;
}

export interface MedicationRecord {
  hk_uuid: string;
  /** Always "Unknown medication" on iOS 26.3.1 — Apple's API doesn't expose a
   *  link from a dose event back to its parent medication. See
   *  docs/healthkit-medications-name-linkage.md. The medication names live in
   *  `annotatedMedications` on the fetch response instead. */
  medication_name: string;
  dose_string?: string;
  taken_at: number;          // epoch ms
  scheduled_at?: number;     // epoch ms
  source_name?: string;
  source_bundle_id?: string;
  metadata_json?: string;
}

/** A user-tracked medication (HKUserAnnotatedMedication). Returned alongside
 *  dose events. Use to render the medication list / aggregate dose counts. */
export interface AnnotatedMedication {
  name: string;
  is_archived: boolean;
  has_schedule: boolean;
  /** Apple's display text for the underlying medication concept (e.g. the
   *  pharmaceutical name). Often the same as `name`; differs when the user
   *  set a nickname. */
  concept_display_text: string;
}

export interface FullHKWorkout {
  hk_uuid: string;
  activity_type: string;
  start_at: number;        // epoch ms
  end_at: number;          // epoch ms
  duration_s: number;
  total_energy_kcal?: number | null;
  total_distance_m?: number | null;
  source_name?: string;
  source_bundle_id?: string;
  metadata_json?: string;
  rebirth_workout_uuid?: string;   // if we authored it
}

export interface WrittenSample {
  hk_uuid: string;
  hk_type: string;
}

export type HKRequestStatus = 'shouldRequest' | 'unnecessary' | 'unknown';

interface HealthKitPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  requestPermissions(): Promise<{ granted: boolean }>;
  checkPermissionStatus(): Promise<{ statuses: Record<string, string> }>;
  /** Tells you whether iOS will actually show the permission sheet on next requestPermissions().
   *  After the user has answered for every type in the request set, iOS returns 'unnecessary'
   *  and requestPermissions becomes a silent no-op. Use this to decide whether to show the
   *  in-app "Request Authorization" button or route to Settings/Health. */
  getRequestStatus(): Promise<{ status: HKRequestStatus; shouldRequest: boolean }>;
  /** Sets the runtime feature flag that gates iOS 26 Medications reads. When enabling,
   *  this also triggers iOS's per-object medication chooser so the user can pick which
   *  medications Rebirth can read. Returns whether the flag was set AND whether the user
   *  authorized at least some medications. */
  setMedicationsEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean; authorized: boolean; reason?: 'ios_too_old' }>;
  /** Requests per-object read authorization for iOS 26 Medications. Shows iOS's
   *  medication chooser sheet so the user picks which meds the app can read.
   *  Medications CANNOT use the standard requestAuthorization(toShare:read:) flow —
   *  Apple's HealthKit aborts the process if you try. Per-object auth is mandatory. */
  requestMedicationsAuthorization(): Promise<{ granted: boolean; reason?: 'not_available' | 'ios_too_old' }>;

  // Legacy reads (kept for HealthSection compat)
  saveWorkout(options: SaveWorkoutOptions): Promise<{ saved: boolean; hk_uuid?: string }>;
  getSteps(options: { startTime: number; endTime: number }): Promise<{ value: number }>;
  getActiveCalories(options: { startTime: number; endTime: number }): Promise<{ value: number }>;
  getRecentWorkouts(options: { startTime: number }): Promise<{ workouts: HealthWorkout[] }>;
  getWorkouts(options: { startTime: number; endTime: number }): Promise<{ workouts: WorkoutRecord[] }>;
  getHeartRate(options: { startTime: number; endTime: number }): Promise<{ samples: HeartRateSample[] }>;

  // New anchored / aggregated reads
  fetchDailyAggregates(options: {
    metrics: QuantityMetric[];
    startTime: number;   // epoch ms
    endTime: number;     // epoch ms
  }): Promise<{ results: DailyAggregateRow[] }>;

  fetchSleepNights(options: {
    startTime: number;
    endTime: number;
    anchor?: string;     // base64-encoded HKQueryAnchor
  }): Promise<{ nights: SleepNight[]; deleted: string[]; nextAnchor: string }>;

  fetchWorkouts(options: {
    startTime: number;
    endTime: number;
    anchor?: string;
  }): Promise<{ workouts: FullHKWorkout[]; deleted: string[]; nextAnchor: string }>;

  fetchMedicationRecords(options: {
    startTime: number;
    endTime: number;
    anchor?: string;
  }): Promise<{
    medications: MedicationRecord[];
    deleted: string[];
    nextAnchor: string;
    /** All HKUserAnnotatedMedications the user has authorized Rebirth to read.
     *  This is how we surface medication NAMES on iOS 26.3.1 — see
     *  docs/healthkit-medications-name-linkage.md for why it's separate from
     *  the dose-event stream. */
    annotatedMedications: AnnotatedMedication[];
  }>;

  // Writes
  saveNutrition(options: {
    timestamp: number;   // epoch ms
    mealUuid: string;
    kcal?: number;
    proteinG?: number;
    carbsG?: number;
    fatG?: number;
    waterMl?: number;
  }): Promise<{ saved: boolean; samples: WrittenSample[] }>;

  saveBodyComposition(options: {
    timestamp: number;
    inbodyUuid: string;
    weightKg?: number;
    bodyFatPct?: number;
    leanKg?: number;
  }): Promise<{ saved: boolean; samples: WrittenSample[] }>;

  deleteSamples(options: { uuids: string[] }): Promise<{ deleted: number; failed: string[] }>;
}

export const HealthKit = registerPlugin<HealthKitPlugin>('HealthKit');

/**
 * Activity type remapping rules.
 * Key: activityType string from HealthKit iOS mapping.
 * Value: { displayType, intensityMultiplier }
 *
 * "Hiking" on Apple Watch is how Lou logs dog walks. Reclassify to "Dog Walk"
 * with 0.65x intensity since it's lower effort than actual hiking.
 * "Walking" remains unchanged — those are gym commute walks at full value.
 */
const ACTIVITY_REMAP: Record<string, { displayType: string; intensityMultiplier: number }> = {
  Hiking: { displayType: 'Dog Walk', intensityMultiplier: 0.65 },
};

/** Apply activity type remapping and intensity scaling to a HealthKit workout. */
export function reclassifyWorkout(workout: HealthWorkout): HealthWorkout {
  const remap = ACTIVITY_REMAP[workout.activityType];
  if (!remap) return workout;
  return {
    ...workout,
    activityType: remap.displayType,
    activeCalories: Math.round(workout.activeCalories * remap.intensityMultiplier),
  };
}

/** Estimate active calories for a strength training session based on duration. */
function estimateActiveKcal(durationMs: number): number {
  const minutes = durationMs / 1000 / 60;
  // ~6 kcal/min for moderate strength training (MET ≈ 3.5 for avg person)
  return Math.round(minutes * 6);
}

/**
 * Save a completed workout to HealthKit with activity ring credit.
 * Silently no-ops on non-iOS or if permission is denied.
 */
export async function saveWorkoutToHealthKit(opts: {
  uuid: string;
  startTime: string;   // ISO string
  endTime: string;     // ISO string
  title?: string | null;
  exerciseMetadata?: string; // JSON string of exercise/set summary
}): Promise<void> {
  try {
    const { available } = await HealthKit.isAvailable();
    if (!available) return;

    await HealthKit.requestPermissions();

    const startMs = new Date(opts.startTime).getTime();
    const endMs = new Date(opts.endTime).getTime();
    const activeEnergyKcal = estimateActiveKcal(endMs - startMs);

    await HealthKit.saveWorkout({
      activityType: 'traditionalStrengthTraining',
      startTime: startMs,
      endTime: endMs,
      activeEnergyKcal,
      uuid: opts.uuid,
      metadata: opts.exerciseMetadata,
    });
  } catch {
    // HealthKit errors should never break the workout save flow
  }
}

/**
 * Fetch today's steps, active calories, and recent workouts from HealthKit.
 * Returns null if HealthKit is unavailable or permission is denied.
 * Also returns null on simulator (HealthKit not available).
 */
export async function fetchHealthSummary(): Promise<HealthSummary | null> {
  try {
    const { available } = await HealthKit.isAvailable();
    if (!available) return null;

    await HealthKit.requestPermissions();

    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayStartMs = startOfToday.getTime();

    const sevenDaysAgoMs = now - 7 * 24 * 60 * 60 * 1000;

    const [stepsResult, caloriesResult, workoutsResult] = await Promise.all([
      HealthKit.getSteps({ startTime: todayStartMs, endTime: now }),
      HealthKit.getActiveCalories({ startTime: todayStartMs, endTime: now }),
      HealthKit.getRecentWorkouts({ startTime: sevenDaysAgoMs }),
    ]);

    return {
      steps: stepsResult.value,
      activeCalories: caloriesResult.value,
      recentWorkouts: workoutsResult.workouts.map(reclassifyWorkout),
    };
  } catch {
    return null;
  }
}
