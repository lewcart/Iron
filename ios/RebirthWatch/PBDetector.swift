import Foundation
import RebirthModels

/// Local PB detection — used to fire the celebration haptic immediately on
/// confirm, before the server's PR recompute round-trips. Compares the new
/// set's Epley e1RM against the max e1RM in the cached history hint.
///
/// Excluded sets (excludedFromPb) are skipped on both sides — neither the
/// candidate nor history rows count if they're excluded.
enum PBDetector {

    /// Epley 1RM. NB: the server uses the same formula. Returns nil for
    /// non-strength inputs (no weight, no reps, or duration-only sets).
    static func epley(weight: Double?, reps: Int?) -> Double? {
        guard let w = weight, w > 0, let r = reps, r > 0 else { return nil }
        return w * (1.0 + Double(r) / 30.0)
    }

    /// Returns (isPB, deltaKg) — `deltaKg` is the difference between the
    /// candidate weight and the previous PB weight (negative if not a PB).
    static func detect(
        candidate: WorkoutSet,
        completedWeight: Double?,
        completedReps: Int?,
        history: ExerciseHistoryHint?
    ) -> (isPB: Bool, deltaKg: Double?) {
        guard !candidate.excludedFromPb else { return (false, nil) }
        guard let candidateE1rm = epley(weight: completedWeight, reps: completedReps) else {
            return (false, nil)
        }
        let historySets = history?.sets ?? []
        let priorMax = historySets
            .filter { !$0.excludedFromPb }
            .compactMap { epley(weight: $0.actualWeight ?? $0.targetWeight, reps: $0.actualReps ?? $0.targetReps) }
            .max() ?? 0

        if candidateE1rm > priorMax + 0.01 {     // ε to avoid floating-point ties
            let priorPbWeight = historySets
                .filter { !$0.excludedFromPb }
                .compactMap { $0.actualWeight ?? $0.targetWeight }
                .max() ?? 0
            let delta = (completedWeight ?? 0) - priorPbWeight
            return (true, delta)
        }
        return (false, nil)
    }
}
