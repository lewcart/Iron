/**
 * Reason-chip registry — single source of truth for the small inline labels
 * shown on PrescriptionCard rows ("HRV ↓1.2σ", "RIR drift", etc).
 *
 * Why a registry? Reason chips are touched in three places: the engine emits
 * them (`prescription-engine.ts`), the PrescriptionCard renders them inline,
 * and the "Why?" sheet expands their full English explanation. Without this
 * registry the chip vocabulary drifts: the engine adds a new kind, the UI
 * forgets a render branch, the a11y label diverges from the visible text.
 *
 * The engine emits `{kind, ...payload}` tagged-union values. The UI imports
 * `REASON_CHIP_REGISTRY` and renders by `chip.kind`. Adding a new chip kind
 * touches the engine rule + one entry in this registry.
 *
 * Severity: drives chip ordering inside a single prescription row. Higher
 * = more salient; reasons render in descending severity order so the
 * strongest signal lands first when chips wrap on narrow screens.
 *
 * Symbols in `label` (↓σ, ↘) are ALSO duplicated in plain English in
 * `ariaLabel` so VoiceOver / TalkBack users get the actual meaning, not
 * the symbol name.
 */

export type ReasonChipKind =
  | 'hrv_low'
  | 'rir_drift'
  | 'failure_load'
  | 'e1rm_stagnant'
  | 'zone_over'
  | 'zone_risk';

export interface ReasonChipBase {
  kind: ReasonChipKind;
}

export interface HrvLowChip extends ReasonChipBase {
  kind: 'hrv_low';
  /** Standard deviations below baseline (positive number; 1.2 means -1.2σ). */
  sigma: number;
}
export interface RirDriftChip extends ReasonChipBase {
  kind: 'rir_drift';
  /** Muscle slug whose sets drifted. */
  muscle: string;
  /** RIR delta (positive = drifting toward failure). */
  delta: number;
}
/** Distinct from `rir_drift`. Drift is the RATE of change ("RIR fell by N
 *  this week"); this is the LEVEL ("N% of sets went to failure"). Once
 *  someone has trained at failure for several weeks the rate flattens while
 *  the level stays extreme, so only this chip fires in that state. */
export interface FailureLoadChip extends ReasonChipBase {
  kind: 'failure_load';
  /** Muscle slug carrying the load, or 'whole-body' for the aggregate case. */
  muscle: string;
  /** Share of RIR-logged working sets taken to failure, 0..1. */
  share: number;
  /** How many priority muscles are over the threshold. */
  muscle_count: number;
}
export interface E1rmStagnantChip extends ReasonChipBase {
  kind: 'e1rm_stagnant';
  /** Display name of the anchor lift. */
  lift: string;
}
export interface ZoneOverChip extends ReasonChipBase {
  kind: 'zone_over';
  muscle: string;
}
export interface ZoneRiskChip extends ReasonChipBase {
  kind: 'zone_risk';
  muscle: string;
}

export type ReasonChip =
  | HrvLowChip
  | RirDriftChip
  | FailureLoadChip
  | E1rmStagnantChip
  | ZoneOverChip
  | ZoneRiskChip;

export interface ReasonChipMeta {
  /** Compact label shown inline on the prescription row. May contain
   *  unicode arrows / symbols. */
  label: (chip: ReasonChip) => string;
  /** Full English aria-label for screen readers. NEVER contains symbols
   *  that don't read aloud (↗, ↘, ↓σ, etc). */
  ariaLabel: (chip: ReasonChip) => string;
  /** Plain-English explanation rendered inside the "Why?" sheet. */
  explanation: (chip: ReasonChip) => string;
  /** Higher severity sorts FIRST in the chip array. 1..3 today. */
  severity: number;
}

export const REASON_CHIP_REGISTRY: Record<ReasonChipKind, ReasonChipMeta> = {
  hrv_low: {
    label: c => `HRV ↓${(c as HrvLowChip).sigma.toFixed(1)}σ`,
    ariaLabel: c =>
      `HRV down ${(c as HrvLowChip).sigma.toFixed(1)} standard deviations`,
    explanation: c =>
      `Your 7-day HRV mean is ${(c as HrvLowChip).sigma.toFixed(1)} standard deviations below your 28-day personal baseline. ` +
      `Persistent low HRV indicates accumulated training/life stress.`,
    severity: 3,
  },
  rir_drift: {
    label: () => `RIR drift`,
    ariaLabel: () => `RIR drift on this muscle's sets`,
    explanation: c =>
      `Average RIR (reps in reserve) on ${(c as RirDriftChip).muscle} sets dropped by ${(c as RirDriftChip).delta.toFixed(1)} units this week. ` +
      `You're closer to failure than you were a week ago — usually a sign of accumulated fatigue or under-recovery.`,
    severity: 2,
  },
  failure_load: {
    label: c => `${Math.round((c as FailureLoadChip).share * 100)}% to failure`,
    ariaLabel: c =>
      `${Math.round((c as FailureLoadChip).share * 100)} percent of logged sets taken to failure ` +
      `across ${(c as FailureLoadChip).muscle_count} priority muscles`,
    explanation: c =>
      `${Math.round((c as FailureLoadChip).share * 100)}% of your RIR-logged working sets were taken to failure (RIR 0), ` +
      `across ${(c as FailureLoadChip).muscle_count} priority muscles. Training to failure produces about the same ` +
      `hypertrophy as stopping 1–3 reps short, but costs substantially more recovery — so this is near-maximum ` +
      `fatigue for near-zero extra stimulus. Note your effective-set count cannot show this: it credits RIR 0 and ` +
      `RIR 2 identically, by design.`,
    severity: 3,
  },
  e1rm_stagnant: {
    label: () => `lift slope ↘`,
    ariaLabel: () => `anchor lift estimated 1RM trending down`,
    explanation: c =>
      `${(c as E1rmStagnantChip).lift} estimated 1RM has flattened or declined over the last 14 days. ` +
      `Without HRT-protocol context, this is a fatigue signal; with a recent protocol change, expect strength recalibration.`,
    severity: 2,
  },
  zone_over: {
    label: () => `over MAV`,
    ariaLabel: () => `set count above productive zone`,
    explanation: c =>
      `${(c as ZoneOverChip).muscle} weekly working sets exceed the productive volume range (MAV-max). ` +
      `Adding more rarely improves growth and increases recovery cost.`,
    severity: 1,
  },
  zone_risk: {
    label: () => `at MRV`,
    ariaLabel: () => `set count at recovery limit`,
    explanation: c =>
      `${(c as ZoneRiskChip).muscle} weekly sets are at or above MRV (Maximum Recoverable Volume). ` +
      `Pushing further this week likely overshoots your recovery capacity.`,
    severity: 3,
  },
};

/** Sort an array of chips in DESCENDING severity (strongest signal first). */
export function sortChipsBySeverity(chips: readonly ReasonChip[]): ReasonChip[] {
  return [...chips].sort(
    (a, b) => REASON_CHIP_REGISTRY[b.kind].severity - REASON_CHIP_REGISTRY[a.kind].severity,
  );
}
