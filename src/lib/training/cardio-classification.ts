/**
 * Activity-type → cardio category classification.
 *
 * v1.1 ships activity-type-only classification. The HR-zone-first path was
 * dropped during /autoplan eng review because `healthkit_workouts` only
 * stores workout-average HR (not per-second samples), and an averaged HR
 * systematically misclassifies HIIT (warmup + intervals + cooldown averages
 * into zone-2 territory) and zone-2 efforts that briefly spike. Add HR-zone
 * classification in v1.2 only when per-sample HR is in the schema.
 *
 * Activity-type strings come from Apple HealthKit's HKWorkoutActivityType
 * (lower-snake-cased on the way into Postgres). The full enum is large; we
 * tag the ones Lou actually does.
 *
 * Strength activities are NOT cardio. They are excluded entirely from the
 * cardio total — this is by design, not a bug. A strength-only week shows
 * 0 / target on the cardio tile silently (no warning copy).
 */

export type CardioCategory = 'zone2' | 'intervals' | 'uncategorized';

/**
 * Map a HealthKit activity type to a cardio category.
 *
 *   zone2          steady-state cardio: walking, hiking, outdoor cycling,
 *                  long rowing/cycling sessions
 *   intervals      HIIT / sprint work: high_intensity_interval_training,
 *                  short rowing/cycling sessions (< 30 min)
 *   uncategorized  strength, mobility, sport — excluded from cardio total
 *
 * `durationMinutes` is required because some activity types (rowing,
 * cycling_indoor) classify differently based on duration as a
 * conservative HIIT-vs-zone-2 proxy in the absence of HR data.
 */
export function classifyActivityType(
  activityType: string,
  durationMinutes: number,
): CardioCategory {
  const t = activityType.toLowerCase();

  // Definitively HIIT regardless of duration
  if (t === 'high_intensity_interval_training') return 'intervals';

  // Steady-state by activity type
  if (t === 'walking' || t === 'hiking' || t === 'cycling_outdoor') {
    return 'zone2';
  }

  // Duration-dispatched (rowing / indoor cycling): short sessions are very
  // likely interval work; longer sessions are very likely steady-state.
  if (t === 'rowing' || t === 'cycling_indoor') {
    return durationMinutes < 30 ? 'intervals' : 'zone2';
  }

  // Strength / mobility / sport / etc — not cardio.
  return 'uncategorized';
}

/**
 * Aggregate a list of workouts into per-category total minutes.
 * `uncategorized` minutes are dropped (not returned in the totals).
 */
export interface ClassifiedWorkout {
  category: CardioCategory;
  duration_minutes: number;
}

export interface CardioMinutesByCategory {
  zone2: number;
  intervals: number;
  total: number;  // zone2 + intervals only (excludes uncategorized)
}

export function aggregateMinutes(
  workouts: readonly ClassifiedWorkout[],
): CardioMinutesByCategory {
  let zone2 = 0;
  let intervals = 0;
  for (const w of workouts) {
    if (w.category === 'zone2') zone2 += w.duration_minutes;
    else if (w.category === 'intervals') intervals += w.duration_minutes;
  }
  return { zone2, intervals, total: zone2 + intervals };
}
