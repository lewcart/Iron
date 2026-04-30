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
  heaviestWeight: PersonalRecord | null;
  mostReps: PersonalRecord | null;
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
 * Calculate personal records from an array of completed sets.
 * Returns the best set for each of three categories:
 *   - estimated1RM: highest Epley 1RM estimate
 *   - heaviestWeight: highest weight lifted
 *   - mostReps: most repetitions in a single set
 */
export function calculatePRs(
  sets: PRSet[],
): PRResult {
  if (sets.length === 0) {
    return { estimated1RM: null, heaviestWeight: null, mostReps: null };
  }

  let best1RMSet: PRSet | null = null;
  let best1RMValue = -Infinity;

  let heaviestSet: PRSet | null = null;
  let heaviestValue = -Infinity;

  let mostRepsSet: PRSet | null = null;
  let mostRepsValue = -Infinity;

  for (const set of sets) {
    const orm = estimate1RM(set.weight, set.repetitions);

    if (orm > best1RMValue) {
      best1RMValue = orm;
      best1RMSet = set;
    }

    if (set.weight > heaviestValue) {
      heaviestValue = set.weight;
      heaviestSet = set;
    }

    if (set.repetitions > mostRepsValue) {
      mostRepsValue = set.repetitions;
      mostRepsSet = set;
    }
  }

  const toPersonalRecord = (set: PRSet): PersonalRecord => ({
    exercise_uuid: set.exercise_uuid ?? '',
    weight: set.weight,
    repetitions: set.repetitions,
    estimated_1rm: estimate1RM(set.weight, set.repetitions),
    date: set.date,
    workout_uuid: set.workout_uuid ?? '',
  });

  return {
    estimated1RM: best1RMSet ? toPersonalRecord(best1RMSet) : null,
    heaviestWeight: heaviestSet ? toPersonalRecord(heaviestSet) : null,
    mostReps: mostRepsSet ? toPersonalRecord(mostRepsSet) : null,
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
