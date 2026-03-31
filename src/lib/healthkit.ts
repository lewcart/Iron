import { registerPlugin } from '@capacitor/core';

export interface SaveWorkoutOptions {
  activityType: 'traditionalStrengthTraining' | 'walking';
  startTime: number; // epoch ms
  endTime: number;   // epoch ms
  activeEnergyKcal: number;
  uuid?: string;
  metadata?: string; // JSON-encoded extra info
}

interface HealthKitPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  requestPermissions(): Promise<{ granted: boolean }>;
  saveWorkout(options: SaveWorkoutOptions): Promise<{ saved: boolean }>;
}

const HealthKit = registerPlugin<HealthKitPlugin>('HealthKit');

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
