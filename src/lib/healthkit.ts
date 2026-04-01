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

interface HealthKitPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  requestPermissions(): Promise<{ granted: boolean }>;
  checkPermissionStatus(): Promise<{ statuses: Record<string, string> }>;
  saveWorkout(options: SaveWorkoutOptions): Promise<{ saved: boolean }>;
  getSteps(options: { startTime: number; endTime: number }): Promise<{ value: number }>;
  getActiveCalories(options: { startTime: number; endTime: number }): Promise<{ value: number }>;
  getRecentWorkouts(options: { startTime: number }): Promise<{ workouts: HealthWorkout[] }>;
  getWorkouts(options: { startTime: number; endTime: number }): Promise<{ workouts: WorkoutRecord[] }>;
  getHeartRate(options: { startTime: number; endTime: number }): Promise<{ samples: HeartRateSample[] }>;
}

export const HealthKit = registerPlugin<HealthKitPlugin>('HealthKit');

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
      recentWorkouts: workoutsResult.workouts,
    };
  } catch {
    return null;
  }
}
