/**
 * Prescription engine — synthesizes Week-page facts into per-priority-muscle
 * "next week" recommendations (PUSH / REDUCE / DELOAD). Replaces the
 * deferred-from-original-draft "deload chip" with an actionable surface.
 *
 * Determinism: this module is a pure function. `today` is an explicit
 * parameter. No `new Date()`, no `Date.now()`, no I/O.
 *
 * Architecture: lives next to the other pure training-math modules
 * (`hrv-balance.ts`, `anchor-lift-trend.ts`, `volume-landmarks.ts`).
 * The page calls this AFTER `resolveWeekTiles()` — they share the same
 * `WeekFacts` input + a small `HrtContext` extra, but produce independent
 * outputs (the prescription banner is rendered separately from tiles).
 *
 * Decision rules (full plan in
 *   ~/.gstack/projects/lewcart-Iron/feat-week-v1.1-plan-20260503-160000.md):
 *
 *   DELOAD (whole-body, supersedes per-muscle):
 *     HRV ≥1σ below 28d baseline
 *     AND (RIR drift ≥0.5 unit on ≥1 priority muscle
 *          OR e1RM stagnation across ≥2 priority muscles)
 *     UNLESS recent HRT protocol change (<4 wks) — e1RM stagnation is then
 *     suppressed as a DELOAD trigger (only HRV+RIR can fire).
 *
 *   REDUCE (per-muscle): muscle in `risk` zone (≥MRV) OR muscle's RIR
 *     drift ≥1.0 unit. Delta: -1 to -2 sets next week.
 *
 *   HOLD: muscle in `over` zone (above MAV-max, below MRV). NEVER RENDERED
 *     (prescription card filters HOLD entries — silence beats noise).
 *
 *   PUSH: muscle in `under` zone OR (in-zone with positive e1RM slope AND
 *     no RIR drift on its sets in last 7d). Delta: +1 to +2 sets.
 *
 * Total-added-sets cap (eng review safety constraint):
 *   PUSH +sets are capped across all priority muscles at TOTAL_ADDED_SETS_CAP
 *   (default 4). Ranking when over: highest e1RM-slope first, then
 *   build_emphasis order. Excess muscles drop OFF the prescription, not
 *   downgraded — the engine prefers fewer high-quality recs.
 *
 * Confidence gates (Lou requirement: chips only render when there's enough
 * data AND something to surface):
 *   - Per-muscle: ≥3 weeks of effective-set history AND ≥3 sessions in last
 *     14 days AND HRV baseline ready (or no HRV signal in any reason).
 *   - DELOAD: ≥14 days of HRV baseline AND ≥3 weeks of priority-muscle
 *     session data.
 *   - When NO muscle qualifies → returns prescriptions: [] (empty card,
 *     better than wrong card).
 */

import type { Zone } from './volume-landmarks';
import type { ReasonChip } from './reason-chip-registry';
import { sortChipsBySeverity } from './reason-chip-registry';
import type { HrtContext } from './hrt-context';
import { isRecentProtocolChange, hrtContextNote } from './hrt-context';

// ── Public API types ────────────────────────────────────────────────────

export type PrescriptionAction = 'PUSH' | 'REDUCE' | 'DELOAD';

export interface PriorityMusclePrescription {
  /** Canonical muscle slug, OR 'whole-body' for DELOAD. */
  muscle: string;
  action: PrescriptionAction;
  delta: { sets?: number };
  reasons: ReasonChip[];
  confidence: 'high' | 'medium';
}

export interface PrescriptionEngineResult {
  prescriptions: PriorityMusclePrescription[];
  /** Counts for the partial-state footer ("M of N priority muscles still warming up"). */
  eligibility: { eligible: number; ineligible: number };
  /** Context lines appended below the card (e.g. "Recent protocol change..."). */
  hrtContextNotes: string[];
  /** Sum of `delta.sets` across PUSH prescriptions (≤ totalAddedSetsCap). */
  totalSetsAdded: number;
}

// ── Engine input ────────────────────────────────────────────────────────

export interface PrescriptionMuscleFact {
  muscle: string;
  /** Working sets this week (RIR-weighted preferred — caller chooses). */
  effective_sets: number;
  /** Zone classification this week from `volume-landmarks.zoneFor()`. */
  zone: Zone;
  /** Number of weeks (out of last 8) where the muscle had ≥1 session.
   *  Drives the per-muscle confidence gate. */
  weeks_with_data: number;
  /** Mean RIR delta vs prior 7-day window (positive = drift toward failure).
   *  Null when not enough RIR-logged sets exist to compute. */
  rir_drift: number | null;
  /** Anchor-lift e1RM slope direction over last 14d. Null when no anchor or
   *  insufficient data. */
  anchor_slope: 'up' | 'flat' | 'down' | null;
  /** Anchor-lift display name (for the e1rm_stagnant chip). Null when none. */
  anchor_lift_name: string | null;
  /** Build-emphasis rank — lower index = higher priority (sort tiebreak). */
  build_emphasis_rank: number;
}

export interface PrescriptionFacts {
  /** YYYY-MM-DD reference date (engine determinism). */
  today: string;
  /** HRV summary (the existing hrv-balance result, simplified). */
  hrv: {
    available: boolean;
    /** Sigmas below baseline. Positive value when below; 0/negative = at/above. */
    sigma_below: number;
    /** Days of baseline data (0..28 typical). */
    baseline_days: number;
  };
  /** Number of distinct strength sessions in last 14 days (whole body). */
  sessions_last_14d: number;
  /** Per-priority-muscle facts. EMPTY array → engine returns nothing. */
  muscles: PrescriptionMuscleFact[];
}

// ── Tunables ────────────────────────────────────────────────────────────

const TOTAL_ADDED_SETS_CAP = 4;
const PER_MUSCLE_MIN_WEEKS = 3;
const SESSIONS_LAST_14D_MIN = 3;
const HRV_BASELINE_MIN_DAYS = 14;

const HRV_LOW_SIGMA = 1.0;            // ≥1σ below baseline → "low"
const RIR_DRIFT_REDUCE_THRESHOLD = 1.0;  // per-muscle REDUCE
const RIR_DRIFT_DELOAD_THRESHOLD = 0.5;  // contributes to DELOAD
const STAGNATION_MUSCLE_COUNT_FOR_DELOAD = 2;

// ── Engine ──────────────────────────────────────────────────────────────

export interface PrescriptionEngineOpts {
  /** Override the default total-added-sets cap (default 4). */
  totalAddedSetsCap?: number;
}

export function prescriptionsFor(
  facts: PrescriptionFacts,
  hrtContext: HrtContext,
  opts: PrescriptionEngineOpts = {},
): PrescriptionEngineResult {
  const cap = opts.totalAddedSetsCap ?? TOTAL_ADDED_SETS_CAP;
  const hrtNotes: string[] = [];
  const note = hrtContextNote(hrtContext);
  if (note) hrtNotes.push(note);

  // Eligibility gate per muscle. Excluded muscles are counted in
  // eligibility.ineligible so the UI can render the partial-state footer.
  const eligibleMuscles: PrescriptionMuscleFact[] = [];
  let ineligible = 0;
  for (const m of facts.muscles) {
    if (m.weeks_with_data < PER_MUSCLE_MIN_WEEKS || facts.sessions_last_14d < SESSIONS_LAST_14D_MIN) {
      ineligible++;
      continue;
    }
    eligibleMuscles.push(m);
  }
  const eligibility = { eligible: eligibleMuscles.length, ineligible };

  // No data to work with → empty card.
  if (eligibleMuscles.length === 0) {
    return { prescriptions: [], eligibility, hrtContextNotes: hrtNotes, totalSetsAdded: 0 };
  }

  // ── DELOAD trigger evaluation (whole-body) ────────────────────────────
  const hrvLow =
    facts.hrv.available &&
    facts.hrv.baseline_days >= HRV_BASELINE_MIN_DAYS &&
    facts.hrv.sigma_below >= HRV_LOW_SIGMA;

  const recentProtocol = isRecentProtocolChange(hrtContext);

  if (hrvLow) {
    const rirDriftMuscleCount = eligibleMuscles.filter(
      m => (m.rir_drift ?? 0) >= RIR_DRIFT_DELOAD_THRESHOLD,
    ).length;
    const stagnantMuscleCount = recentProtocol
      ? 0  // suppressed during recent protocol change
      : eligibleMuscles.filter(m => m.anchor_slope === 'down' || m.anchor_slope === 'flat').length;

    const triggerByRir = rirDriftMuscleCount >= 1;
    const triggerByStagnation = stagnantMuscleCount >= STAGNATION_MUSCLE_COUNT_FOR_DELOAD;

    if (triggerByRir || triggerByStagnation) {
      const reasons: ReasonChip[] = [
        { kind: 'hrv_low', sigma: round1(facts.hrv.sigma_below) },
      ];
      // Surface the strongest contributing muscle's RIR drift, if any.
      const driftMuscle = eligibleMuscles
        .filter(m => (m.rir_drift ?? 0) >= RIR_DRIFT_DELOAD_THRESHOLD)
        .sort((a, b) => (b.rir_drift ?? 0) - (a.rir_drift ?? 0))[0];
      if (driftMuscle) {
        reasons.push({
          kind: 'rir_drift',
          muscle: driftMuscle.muscle,
          delta: round1(driftMuscle.rir_drift ?? 0),
        });
      }
      // Surface the first stagnating muscle's lift name (for the chip).
      if (triggerByStagnation) {
        const stagnant = eligibleMuscles.find(
          m => (m.anchor_slope === 'down' || m.anchor_slope === 'flat') && m.anchor_lift_name,
        );
        if (stagnant?.anchor_lift_name) {
          reasons.push({ kind: 'e1rm_stagnant', lift: stagnant.anchor_lift_name });
        }
      }
      return {
        prescriptions: [
          {
            muscle: 'whole-body',
            action: 'DELOAD',
            delta: {},  // delta intentionally empty — modal explains -50% sets / -20% load
            reasons: sortChipsBySeverity(reasons),
            confidence: 'high',
          },
        ],
        eligibility,
        hrtContextNotes: hrtNotes,
        totalSetsAdded: 0,
      };
    }
  }

  // ── Per-muscle prescriptions (PUSH / REDUCE; HOLD filtered) ──────────
  const candidates: PriorityMusclePrescription[] = [];

  for (const m of eligibleMuscles) {
    // REDUCE wins over PUSH if both conditions could fire (which they
    // shouldn't for the same muscle, but be defensive).
    if (m.zone === 'risk') {
      candidates.push({
        muscle: m.muscle,
        action: 'REDUCE',
        delta: { sets: -2 },  // risk = ≥MRV → larger pull
        reasons: [{ kind: 'zone_risk', muscle: m.muscle }],
        confidence: 'high',
      });
      continue;
    }
    if ((m.rir_drift ?? 0) >= RIR_DRIFT_REDUCE_THRESHOLD) {
      candidates.push({
        muscle: m.muscle,
        action: 'REDUCE',
        delta: { sets: -1 },
        reasons: [
          { kind: 'rir_drift', muscle: m.muscle, delta: round1(m.rir_drift ?? 0) },
        ],
        confidence: 'high',
      });
      continue;
    }
    if (m.zone === 'over') {
      // HOLD — filtered out (never rendered per design spec).
      continue;
    }
    if (m.zone === 'under') {
      candidates.push({
        muscle: m.muscle,
        action: 'PUSH',
        delta: { sets: 2 },  // under-zone = aggressive push
        reasons: [],  // no chips — the absence of zone is the reason
        confidence: 'medium',
      });
      continue;
    }
    if (m.zone === 'in-zone' && m.anchor_slope === 'up' && (m.rir_drift ?? 0) < RIR_DRIFT_DELOAD_THRESHOLD) {
      // Asymmetric guard against pushing into incipient drift (Codex eng-review note).
      candidates.push({
        muscle: m.muscle,
        action: 'PUSH',
        delta: { sets: 1 },
        reasons: [],
        confidence: 'medium',
      });
      continue;
    }
    // in-zone with no upside signal → HOLD (filtered).
  }

  // Apply total-added-sets cap to PUSH candidates only.
  const reduceList = candidates.filter(c => c.action === 'REDUCE');
  const pushList = candidates.filter(c => c.action === 'PUSH');

  // Rank PUSHes by (a) anchor_slope=up first, (b) build_emphasis_rank ascending.
  const rankedPush = pushList
    .map(p => {
      const fact = eligibleMuscles.find(m => m.muscle === p.muscle)!;
      return { p, fact };
    })
    .sort((a, b) => {
      const aHasUp = a.fact.anchor_slope === 'up' ? 0 : 1;
      const bHasUp = b.fact.anchor_slope === 'up' ? 0 : 1;
      if (aHasUp !== bHasUp) return aHasUp - bHasUp;
      return a.fact.build_emphasis_rank - b.fact.build_emphasis_rank;
    });

  const acceptedPush: PriorityMusclePrescription[] = [];
  let totalSetsAdded = 0;
  for (const { p } of rankedPush) {
    const want = p.delta.sets ?? 0;
    if (totalSetsAdded + want > cap) {
      // Try a smaller delta first — if even +1 wouldn't fit, drop entirely.
      const room = cap - totalSetsAdded;
      if (room <= 0) break;
      acceptedPush.push({ ...p, delta: { sets: room } });
      totalSetsAdded += room;
      break;  // cap reached
    }
    acceptedPush.push(p);
    totalSetsAdded += want;
  }

  return {
    prescriptions: [...reduceList, ...acceptedPush],
    eligibility,
    hrtContextNotes: hrtNotes,
    totalSetsAdded,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
