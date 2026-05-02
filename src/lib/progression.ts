// Progression recommendations.
//
// Given the most-recent completed session's working sets for an exercise,
// returns a directional cue for the next session: go heavier / more reps /
// go longer / hold / back off. The user decides magnitude — we only pick
// direction + intensity (single vs double arrow).
//
// Two paths:
//
// 1. Window-aware (preferred — when goal_window is provided):
//    - majority of sets in a window BELOW the goal → back off
//    - majority spilled TWO+ windows up OR avg RIR ≥ 4 → go heavier (high ↑↑)
//    - majority spilled ONE window up → go heavier (medium ↑)
//    - majority in goal window with avg RIR ≥ 2 → more reps
//    - majority in goal window with RIR 0–1 → hold
//
// 2. Legacy (fallback when goal_window is null — uses set-level min/max):
//    - majority of sets below min_target_reps → back off
//    - majority above max_target_reps OR avg RIR ≥ 4 → go heavier (high)
//    - majority at/over max_target_reps with avg RIR ≥ 2 → go heavier
//    - in range with avg RIR ≥ 2 → more reps
//    - nailed target with RIR 0–1 → hold
//
// Rule (time mode): same RIR thresholds, but the verb is "go longer".
//
// Null RIR is treated as 2 (charitable default — same convention as
// effective_set_count weighting).

import type { LocalWorkoutSet } from '@/db/local';
import { REP_WINDOW_ORDER, windowForReps, type RepWindow } from './rep-windows';

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
  goalWindow?: RepWindow | null,
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

  // Window-aware path: classify each set by which window its reps land in,
  // then compare to the goal window. Diff > 0 = spilled up; diff < 0 = below.
  if (goalWindow) {
    const goalIdx = REP_WINDOW_ORDER.indexOf(goalWindow);
    // _inWindow is computed for symmetry/future use but isn't read by any
    // recommendation branch below — the in-window case falls through to the
    // RIR-based "more reps" / "hold" decision. Underscore prefix per the
    // project's no-unused-vars lint allowance.
    let _inWindow = 0, upOne = 0, upTwoPlus = 0, belowGoal = 0;

    for (const s of working) {
      const setWin = windowForReps(s.repetitions ?? 0);
      if (!setWin) { belowGoal++; continue; }
      const diff = REP_WINDOW_ORDER.indexOf(setWin) - goalIdx;
      if (diff === 0) _inWindow++;
      else if (diff === 1) upOne++;
      else if (diff >= 2) upTwoPlus++;
      else belowGoal++;
    }

    const total = working.length;
    const majorityBelow = belowGoal / total >= 0.5;
    const majorityUpTwoPlus = upTwoPlus / total >= 0.5;
    const majorityUpOne = upOne / total >= 0.5;

    if (majorityBelow) {
      return { kind: 'back-off', intensity: 'medium', label: 'back off' };
    }
    if (majorityUpTwoPlus || rir >= 4) {
      return { kind: 'go-heavier', intensity: 'high', label: 'go heavier' };
    }
    if (majorityUpOne) {
      return { kind: 'go-heavier', intensity: 'medium', label: 'go heavier' };
    }
    if (rir >= 2) {
      return { kind: 'more-reps', intensity: 'medium', label: 'more reps' };
    }
    return { kind: 'hold', intensity: 'medium', label: 'hold' };
  }

  // Legacy path — set-level min/max comparison. Kept for routines that haven't
  // been assigned a goal_window yet.
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
