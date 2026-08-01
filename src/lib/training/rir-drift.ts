/**
 * Per-muscle RIR drift — the *rate* at which a muscle's sets are moving
 * toward failure, week over week.
 *
 * Feeds `PrescriptionMuscleFact.rir_drift`, which the prescription engine
 * uses for its per-muscle REDUCE branch and as a DELOAD contributor. Sign
 * convention matches that field's contract (prescription-engine.ts):
 *
 *     drift = mean RIR(prior 7d) − mean RIR(recent 7d)
 *     positive → drifting toward failure
 *
 * Complements, but does not replace, failure share (`volume-math.ts`).
 * Drift measures the rate of change; failure share measures the level.
 * Both are needed: once someone has been pinned near failure for several
 * weeks the rate flattens toward zero while the level stays extreme, so a
 * rate-only signal goes blind exactly when the situation is worst.
 *
 * Drop-tagged sets are excluded, consistent with `working_set_count` and
 * the failure counts — a drop's RIR is a property of the parent's chain,
 * not an independent observation.
 */

/** Days in each comparison window. */
export const RIR_DRIFT_WINDOW_DAYS = 7;

/** Minimum RIR-logged working sets required in BOTH windows before a drift
 *  value is trustworthy. Below this, drift is null (unknown), which the
 *  engine treats as "no signal" rather than "no drift". */
export const RIR_DRIFT_MIN_SETS_PER_WINDOW = 3;

export interface RirDriftSetInput {
  /** Session date in the user's local TZ, YYYY-MM-DD. */
  local_date: string;
  /** Reps in reserve. Null (not logged) rows are ignored entirely. */
  rir: number | null;
  /** Canonical muscle slugs this set credits — primary and secondary
   *  merged by the caller. A muscle appearing twice is counted once. */
  muscles: readonly string[];
  /** 'dropSet' rows are excluded. */
  tag?: 'dropSet' | 'failure' | null;
}

export interface RirDriftResult {
  muscle: string;
  /** Prior-window mean minus recent-window mean; positive = toward failure.
   *  Null when either window is below the coverage floor. */
  drift: number | null;
  recent_mean: number | null;
  prior_mean: number | null;
  recent_n: number;
  prior_n: number;
}

/** Shift a YYYY-MM-DD date string by whole days. Parsed at UTC noon so the
 *  arithmetic can't slip a day across an offset boundary. */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Compute per-muscle RIR drift over the two windows ending at `today`.
 *
 *   recent window: (today − 7d, today]
 *   prior  window: (today − 14d, today − 7d]
 *
 * `today` is a YYYY-MM-DD string in the user's local TZ so the result is
 * deterministic and testable — no ambient clock reads.
 */
export function buildRirDrift(
  sets: readonly RirDriftSetInput[],
  today: string,
): RirDriftResult[] {
  const recentFloor = shiftDate(today, -RIR_DRIFT_WINDOW_DAYS);
  const priorFloor = shiftDate(today, -RIR_DRIFT_WINDOW_DAYS * 2);

  const buckets = new Map<string, { recent: number[]; prior: number[] }>();

  for (const set of sets) {
    if (set.tag === 'dropSet') continue;
    if (set.rir == null) continue;
    // String comparison is safe and cheap for zero-padded ISO dates.
    if (set.local_date > today || set.local_date <= priorFloor) continue;

    const isRecent = set.local_date > recentFloor;
    // Dedupe: a muscle listed as both primary and secondary is one data point.
    for (const muscle of new Set(set.muscles)) {
      let bucket = buckets.get(muscle);
      if (!bucket) {
        bucket = { recent: [], prior: [] };
        buckets.set(muscle, bucket);
      }
      (isRecent ? bucket.recent : bucket.prior).push(set.rir);
    }
  }

  return Array.from(buckets.entries()).map(([muscle, b]) => {
    const recentMean = mean(b.recent);
    const priorMean = mean(b.prior);
    const enoughData =
      b.recent.length >= RIR_DRIFT_MIN_SETS_PER_WINDOW &&
      b.prior.length >= RIR_DRIFT_MIN_SETS_PER_WINDOW;
    return {
      muscle,
      drift:
        enoughData && recentMean != null && priorMean != null
          ? priorMean - recentMean
          : null,
      recent_mean: recentMean,
      prior_mean: priorMean,
      recent_n: b.recent.length,
      prior_n: b.prior.length,
    };
  });
}

/** Convenience lookup keyed by muscle slug. */
export function rirDriftBySlug(results: readonly RirDriftResult[]): Map<string, RirDriftResult> {
  return new Map(results.map(r => [r.muscle, r]));
}
