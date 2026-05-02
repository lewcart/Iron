// Progression recommendations.
//
// Given the most-recent completed session's working sets for an exercise,
// returns a directional cue for the next session: go heavier / more reps /
// go longer / hold / back off. The user decides magnitude — we only pick
// direction + intensity (single vs double arrow).
//
// Rule (rep mode):
//   - majority of sets below min_target_reps → back off
//   - majority above max_target_reps OR avg RIR ≥ 4 → go heavier (high)
//   - majority at/over max_target_reps with avg RIR ≥ 2 → go heavier
//   - in range with avg RIR ≥ 2 → more reps
//   - nailed target with RIR 0–1 → hold
//
// Rule (time mode): same RIR thresholds, but the verb is "go longer".
//
// Null RIR is treated as 2 (charitable default — same convention as
// effective_set_count weighting).

import type { LocalWorkoutSet } from '@/db/local';

export type RecommendationKind =
  | 'go-heavier'
  | 'more-reps'
  | 'go-longer'
  | 'hold'
  | 'back-off';

export type RecommendationIntensity = 'high' | 'medium';

export interface ExerciseRecommendation {
  kind: RecommendationKind;
  intensity: RecommendationIntensity;
  /** Short verb shown next to the arrow ("go heavier", "more reps", etc.) */
  label: string;
}

type ProgressionInputSet = Pick<
  LocalWorkoutSet,
  | 'is_completed'
  | 'repetitions'
  | 'duration_seconds'
  | 'min_target_reps'
  | 'max_target_reps'
  | 'rir'
>;

export function recommendForExercise(
  prevSets: ProgressionInputSet[],
  trackingMode: 'reps' | 'time',
): ExerciseRecommendation | null {
  const working = prevSets.filter(s =>
    s.is_completed
    && (trackingMode === 'time'
      ? (s.duration_seconds ?? 0) > 0
      : (s.repetitions ?? 0) > 0),
  );
  if (working.length === 0) return null;

  const recordedRirs = working
    .map(s => s.rir)
    .filter((r): r is number => r != null);
  const avgRir = recordedRirs.length > 0
    ? recordedRirs.reduce((a, b) => a + b, 0) / recordedRirs.length
    : null;
  const rir = avgRir ?? 2;

  if (trackingMode === 'time') {
    if (rir >= 4) return { kind: 'go-longer', intensity: 'high', label: 'go longer' };
    if (rir >= 2) return { kind: 'go-longer', intensity: 'medium', label: 'go longer' };
    if (rir <= 1) return { kind: 'hold', intensity: 'medium', label: 'hold' };
    return null;
  }

  let aboveMax = 0;
  let atMax = 0;
  let belowMin = 0;
  let unknownTarget = 0;

  for (const s of working) {
    const reps = s.repetitions ?? 0;
    const min = s.min_target_reps;
    const max = s.max_target_reps;
    if (min == null && max == null) { unknownTarget++; continue; }
    if (max != null && reps > max) aboveMax++;
    else if (max != null && reps === max) atMax++;
    else if (min != null && reps < min) belowMin++;
  }

  const total = working.length;
  if (unknownTarget === total) {
    if (rir >= 4) return { kind: 'go-heavier', intensity: 'high', label: 'go heavier' };
    if (rir >= 2) return { kind: 'go-heavier', intensity: 'medium', label: 'go heavier' };
    if (rir <= 1) return { kind: 'hold', intensity: 'medium', label: 'hold' };
    return null;
  }

  const majorityAboveMax = aboveMax / total >= 0.5;
  const majorityBelowMin = belowMin / total >= 0.5;
  const majorityAtOrAboveMax = (aboveMax + atMax) / total >= 0.5;

  if (majorityBelowMin) {
    return { kind: 'back-off', intensity: 'medium', label: 'back off' };
  }
  if (majorityAboveMax || rir >= 4) {
    return { kind: 'go-heavier', intensity: 'high', label: 'go heavier' };
  }
  if (majorityAtOrAboveMax && rir >= 2) {
    return { kind: 'go-heavier', intensity: 'medium', label: 'go heavier' };
  }
  if (rir >= 2) {
    return { kind: 'more-reps', intensity: 'medium', label: 'more reps' };
  }
  return { kind: 'hold', intensity: 'medium', label: 'hold' };
}
