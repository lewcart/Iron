import type { PersonalRecord } from '../types';

/**
 * Estimate one-rep max using the Epley formula: weight × (1 + reps / 30)
 * Returns 0 if weight or reps is 0.
 */
export function estimate1RM(weight: number, reps: number): number {
  if (weight === 0 || reps === 0) return 0;
  return weight * (1 + reps / 30);
}

export interface PRSet {
  weight: number;
  repetitions: number;
  date: string;
  workout_uuid?: string;
  exercise_uuid?: string;
}

export interface PRResult {
  estimated1RM: PersonalRecord | null;
}

/**
 * Returns true if the given weight+reps would set a new estimated 1RM record
 * compared to the provided all-time best.
 */
export function isNewEstimated1RM(
  weight: number,
  reps: number,
  allTimeBest1RM: number,
): boolean {
  if (weight === 0 || reps === 0) return false;
  return estimate1RM(weight, reps) > allTimeBest1RM;
}

/**
 * Calculate the personal record from an array of completed sets.
 * Returns the set with the highest Epley 1RM estimate.
 *
 * Heaviest-weight and most-reps were previously surfaced as separate PBs
 * but were dropped: heaviest-weight without rep context is gameable, and
 * most-reps-in-a-set is an endurance derivative, not a strength PB. e1RM
 * is the only honest progress signal in a 1-rep-max-extrapolation framing.
 */
export function calculatePRs(
  sets: PRSet[],
): PRResult {
  if (sets.length === 0) {
    return { estimated1RM: null };
  }

  let best1RMSet: PRSet | null = null;
  let best1RMValue = -Infinity;

  for (const set of sets) {
    const orm = estimate1RM(set.weight, set.repetitions);
    if (orm > best1RMValue) {
      best1RMValue = orm;
      best1RMSet = set;
    }
  }

  if (!best1RMSet) return { estimated1RM: null };

  return {
    estimated1RM: {
      exercise_uuid: best1RMSet.exercise_uuid ?? '',
      weight: best1RMSet.weight,
      repetitions: best1RMSet.repetitions,
      estimated_1rm: estimate1RM(best1RMSet.weight, best1RMSet.repetitions),
      date: best1RMSet.date,
      workout_uuid: best1RMSet.workout_uuid ?? '',
    },
  };
}

// ─── Time-mode PRs (held duration) ──────────────────────────────────────────

export interface TimePRSet {
  duration_seconds: number;
  date: string;
  workout_uuid?: string;
  exercise_uuid?: string;
}

export interface TimePR {
  exercise_uuid: string;
  duration_seconds: number;
  date: string;
  workout_uuid: string;
}

export interface TimePRResult {
  longestHold: TimePR | null;
  /** Sum across all completed time-mode sets. Useful as a secondary stat. */
  totalSeconds: number;
}

/**
 * Calculate personal records for a time-mode exercise (e.g. plank held for
 * 60s). Mode-agnostic at the type level — callers must pre-filter to
 * time-mode sets, since exercise-level mode lives on the exercise row.
 */
export function calculateTimePRs(sets: TimePRSet[]): TimePRResult {
  if (sets.length === 0) return { longestHold: null, totalSeconds: 0 };

  let longestSet: TimePRSet | null = null;
  let longestValue = -Infinity;
  let total = 0;

  for (const set of sets) {
    // Zero / negative durations don't qualify as "holds" — skip them so a
    // logged-but-immediately-cancelled set doesn't show up as a PB.
    if (set.duration_seconds <= 0) continue;
    if (set.duration_seconds > longestValue) {
      longestValue = set.duration_seconds;
      longestSet = set;
    }
    total += set.duration_seconds;
  }

  if (!longestSet) return { longestHold: null, totalSeconds: total };

  return {
    longestHold: {
      exercise_uuid: longestSet.exercise_uuid ?? '',
      duration_seconds: longestSet.duration_seconds,
      date: longestSet.date,
      workout_uuid: longestSet.workout_uuid ?? '',
    },
    totalSeconds: total,
  };
}

/** Returns true if the given duration would set a new longest-hold record. */
export function isNewLongestHold(
  durationSeconds: number,
  allTimeLongestSeconds: number,
): boolean {
  if (durationSeconds <= 0) return false;
  return durationSeconds > allTimeLongestSeconds;
}
