import { HealthKit, type WorkoutRecord, type HeartRateSample } from '@/lib/healthkit';

// ── Types ────────────────────────────────────────────────────────────────────

export type HealthDataType =
  | 'workout'
  | 'stepCount'
  | 'activeEnergyBurned'
  | 'heartRate'
  | 'distanceWalkingRunning';

export type PermissionStatus = 'granted' | 'denied' | 'notDetermined';

export type PermissionStatusMap = Record<HealthDataType, PermissionStatus>;

/**
 * Wraps a HealthKit query result with silent-denial context.
 *
 * HealthKit silently returns empty data when read permission is denied —
 * there is no error, just an empty result. `possibleSilentDenial` is true
 * when the result is empty AND permissions were previously requested,
 * signalling the UI to show an empty state with a re-request prompt rather
 * than a generic "no data" message.
 */
export interface HealthResult<T> {
  data: T;
  possibleSilentDenial: boolean;
}

// ── Permission tracking (localStorage) ───────────────────────────────────────

const LS_KEY = 'rebirth-hk-permissions-requested';

export function markPermissionsRequested(): void {
  try {
    localStorage.setItem(LS_KEY, '1');
  } catch {
    // localStorage unavailable (SSR / private browsing)
  }
}

export function werePermissionsRequested(): boolean {
  try {
    return localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Request HealthKit read access for:
 *   HKWorkoutType, stepCount, activeEnergyBurned, heartRate, distanceWalkingRunning
 *
 * Triggers the iOS permission sheet on first call. Subsequent calls are
 * no-ops from the user's perspective (iOS does not show the sheet again).
 * Returns { granted: false } on non-iOS or simulator.
 */
export async function requestPermissions(): Promise<{ granted: boolean }> {
  try {
    const { available } = await HealthKit.isAvailable();
    if (!available) return { granted: false };

    markPermissionsRequested();
    return await HealthKit.requestPermissions();
  } catch {
    return { granted: false };
  }
}

/**
 * Returns the authorization status for each tracked data type.
 *
 * Important iOS limitation: Apple hides read-permission status for privacy.
 * Read-only types (stepCount, heartRate, distanceWalkingRunning) will always
 * report 'notDetermined' even after the user has granted access. Only the
 * workout type (which requires write access) reflects the true status.
 *
 * Use `wrapQueryResult` to detect silent denial at query time instead.
 */
export async function checkPermissionStatus(): Promise<PermissionStatusMap> {
  const fallback: PermissionStatusMap = {
    workout: 'notDetermined',
    stepCount: 'notDetermined',
    activeEnergyBurned: 'notDetermined',
    heartRate: 'notDetermined',
    distanceWalkingRunning: 'notDetermined',
  };

  try {
    const { available } = await HealthKit.isAvailable();
    if (!available) return fallback;

    const { statuses } = await HealthKit.checkPermissionStatus();

    return {
      workout: asPermissionStatus(statuses['workout']),
      stepCount: asPermissionStatus(statuses['stepCount']),
      activeEnergyBurned: asPermissionStatus(statuses['activeEnergyBurned']),
      heartRate: asPermissionStatus(statuses['heartRate']),
      distanceWalkingRunning: asPermissionStatus(statuses['distanceWalkingRunning']),
    };
  } catch {
    return fallback;
  }
}

/**
 * Wraps a HealthKit query result with silent-denial detection.
 *
 * Usage:
 *   const result = wrapQueryResult(steps, (v) => v === 0);
 *   if (result.possibleSilentDenial) {
 *     // show empty state with "Open Health app to grant access" prompt
 *   }
 *
 * @param data     The value returned by the HealthKit query
 * @param isEmpty  Predicate that returns true when `data` represents no data
 */
export function wrapQueryResult<T>(
  data: T,
  isEmpty: (d: T) => boolean,
): HealthResult<T> {
  return {
    data,
    possibleSilentDenial: isEmpty(data) && werePermissionsRequested(),
  };
}

// ── Query functions ───────────────────────────────────────────────────────────

export { type WorkoutRecord, type HeartRateSample };

/**
 * Query workouts within a date range.
 * Returns an empty array when HealthKit is unavailable or permission is denied.
 */
export async function getWorkouts(
  startDate: Date,
  endDate: Date,
): Promise<HealthResult<WorkoutRecord[]>> {
  try {
    const { available } = await HealthKit.isAvailable();
    if (!available) return wrapQueryResult([], (d) => d.length === 0);

    const { workouts } = await HealthKit.getWorkouts({
      startTime: startDate.getTime(),
      endTime: endDate.getTime(),
    });
    return wrapQueryResult(workouts, (d) => d.length === 0);
  } catch {
    return wrapQueryResult([], (d) => d.length === 0);
  }
}

/**
 * Aggregate step count over a date range.
 * Returns 0 when HealthKit is unavailable or permission is denied.
 */
export async function getSteps(
  startDate: Date,
  endDate: Date,
): Promise<HealthResult<number>> {
  try {
    const { available } = await HealthKit.isAvailable();
    if (!available) return wrapQueryResult(0, (v) => v === 0);

    const { value } = await HealthKit.getSteps({
      startTime: startDate.getTime(),
      endTime: endDate.getTime(),
    });
    return wrapQueryResult(value, (v) => v === 0);
  } catch {
    return wrapQueryResult(0, (v) => v === 0);
  }
}

/**
 * Fetch heart rate samples as a time series within a date range.
 * Returns an empty array when HealthKit is unavailable or permission is denied.
 */
export async function getHeartRate(
  startDate: Date,
  endDate: Date,
): Promise<HealthResult<HeartRateSample[]>> {
  try {
    const { available } = await HealthKit.isAvailable();
    if (!available) return wrapQueryResult([], (d) => d.length === 0);

    const { samples } = await HealthKit.getHeartRate({
      startTime: startDate.getTime(),
      endTime: endDate.getTime(),
    });
    return wrapQueryResult(samples, (d) => d.length === 0);
  } catch {
    return wrapQueryResult([], (d) => d.length === 0);
  }
}

/**
 * Aggregate active energy burned (kcal) over a date range.
 * Returns 0 when HealthKit is unavailable or permission is denied.
 */
export async function getActiveCalories(
  startDate: Date,
  endDate: Date,
): Promise<HealthResult<number>> {
  try {
    const { available } = await HealthKit.isAvailable();
    if (!available) return wrapQueryResult(0, (v) => v === 0);

    const { value } = await HealthKit.getActiveCalories({
      startTime: startDate.getTime(),
      endTime: endDate.getTime(),
    });
    return wrapQueryResult(value, (v) => v === 0);
  } catch {
    return wrapQueryResult(0, (v) => v === 0);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function asPermissionStatus(raw: string | undefined): PermissionStatus {
  if (raw === 'granted' || raw === 'denied' || raw === 'notDetermined') return raw;
  return 'notDetermined';
}
