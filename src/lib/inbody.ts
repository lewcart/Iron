// Shared helpers for InBody scan UI: metric metadata, reference resolution,
// colour coding. Kept client-safe (no DB imports).

import type { BodyGoal, BodyNormRange, InbodyScan } from '@/types';

export type ReferenceSet = 'M' | 'F' | 'ME';

export type MetricGroup =
  | 'body_comp'
  | 'derived'
  | 'seg_lean'
  | 'seg_fat'
  | 'circumference'
  | 'recommendation';

export interface MetricDef {
  key: keyof InbodyScan | string;
  label: string;
  unit: string;           // 'kg' | '%' | 'cm' | 'score' | 'level' | 'L' | 'kcal'
  group: MetricGroup;
  /** For norm comparison: whether higher or lower is healthier. Goals use body_goals.direction. */
  preferredDirection?: 'higher' | 'lower' | 'match';
  /** Decimals for display. */
  dp?: number;
}

export const METRICS: MetricDef[] = [
  // Body comp
  { key: 'weight_kg', label: 'Weight', unit: 'kg', group: 'body_comp', preferredDirection: 'match', dp: 1 },
  { key: 'total_body_water_l', label: 'Total Body Water', unit: 'L', group: 'body_comp', dp: 1 },
  { key: 'intracellular_water_l', label: 'Intracellular Water', unit: 'L', group: 'body_comp', dp: 1 },
  { key: 'extracellular_water_l', label: 'Extracellular Water', unit: 'L', group: 'body_comp', dp: 1 },
  { key: 'protein_kg', label: 'Protein', unit: 'kg', group: 'body_comp', preferredDirection: 'higher', dp: 2 },
  { key: 'minerals_kg', label: 'Minerals', unit: 'kg', group: 'body_comp', dp: 2 },
  { key: 'bone_mineral_kg', label: 'Bone Mineral', unit: 'kg', group: 'body_comp', dp: 2 },
  { key: 'body_fat_mass_kg', label: 'Body Fat Mass', unit: 'kg', group: 'body_comp', preferredDirection: 'lower', dp: 1 },
  { key: 'smm_kg', label: 'Skeletal Muscle Mass', unit: 'kg', group: 'body_comp', preferredDirection: 'higher', dp: 1 },
  { key: 'soft_lean_mass_kg', label: 'Soft Lean Mass', unit: 'kg', group: 'body_comp', preferredDirection: 'higher', dp: 1 },
  { key: 'fat_free_mass_kg', label: 'Fat Free Mass', unit: 'kg', group: 'body_comp', preferredDirection: 'higher', dp: 1 },

  // Derived
  { key: 'bmi', label: 'BMI', unit: '', group: 'derived', preferredDirection: 'match', dp: 1 },
  { key: 'pbf_pct', label: 'Percent Body Fat', unit: '%', group: 'derived', preferredDirection: 'match', dp: 1 },
  { key: 'whr', label: 'Waist–Hip Ratio', unit: '', group: 'derived', preferredDirection: 'lower', dp: 2 },
  { key: 'inbody_score', label: 'InBody Score', unit: 'score', group: 'derived', preferredDirection: 'higher', dp: 0 },
  { key: 'visceral_fat_level', label: 'Visceral Fat Level', unit: 'level', group: 'derived', preferredDirection: 'lower', dp: 0 },
  { key: 'bmr_kcal', label: 'BMR', unit: 'kcal', group: 'derived', dp: 0 },
  { key: 'body_cell_mass_kg', label: 'Body Cell Mass', unit: 'kg', group: 'derived', dp: 1 },
  { key: 'ecw_ratio', label: 'ECW/TBW Ratio', unit: '', group: 'derived', preferredDirection: 'match', dp: 3 },

  // Segmental lean
  { key: 'seg_lean_right_arm_kg', label: 'Right Arm (lean)', unit: 'kg', group: 'seg_lean', dp: 2 },
  { key: 'seg_lean_left_arm_kg', label: 'Left Arm (lean)', unit: 'kg', group: 'seg_lean', dp: 2 },
  { key: 'seg_lean_trunk_kg', label: 'Trunk (lean)', unit: 'kg', group: 'seg_lean', dp: 2 },
  { key: 'seg_lean_right_leg_kg', label: 'Right Leg (lean)', unit: 'kg', group: 'seg_lean', dp: 2 },
  { key: 'seg_lean_left_leg_kg', label: 'Left Leg (lean)', unit: 'kg', group: 'seg_lean', dp: 2 },

  // Segmental fat
  { key: 'seg_fat_right_arm_kg', label: 'Right Arm (fat)', unit: 'kg', group: 'seg_fat', dp: 2 },
  { key: 'seg_fat_left_arm_kg', label: 'Left Arm (fat)', unit: 'kg', group: 'seg_fat', dp: 2 },
  { key: 'seg_fat_trunk_kg', label: 'Trunk (fat)', unit: 'kg', group: 'seg_fat', dp: 2 },
  { key: 'seg_fat_right_leg_kg', label: 'Right Leg (fat)', unit: 'kg', group: 'seg_fat', dp: 2 },
  { key: 'seg_fat_left_leg_kg', label: 'Left Leg (fat)', unit: 'kg', group: 'seg_fat', dp: 2 },
  { key: 'seg_fat_right_arm_pct', label: 'Fat % Right Arm', unit: '%', group: 'seg_fat', preferredDirection: 'lower', dp: 1 },
  { key: 'seg_fat_left_arm_pct', label: 'Fat % Left Arm', unit: '%', group: 'seg_fat', preferredDirection: 'lower', dp: 1 },
  { key: 'seg_fat_trunk_pct', label: 'Fat % Trunk', unit: '%', group: 'seg_fat', preferredDirection: 'lower', dp: 1 },
  { key: 'seg_fat_right_leg_pct', label: 'Fat % Right Leg', unit: '%', group: 'seg_fat', preferredDirection: 'lower', dp: 1 },
  { key: 'seg_fat_left_leg_pct', label: 'Fat % Left Leg', unit: '%', group: 'seg_fat', preferredDirection: 'lower', dp: 1 },

  // Circumferences
  { key: 'circ_neck_cm', label: 'Neck', unit: 'cm', group: 'circumference', dp: 1 },
  { key: 'circ_chest_cm', label: 'Chest', unit: 'cm', group: 'circumference', dp: 1 },
  { key: 'circ_abdomen_cm', label: 'Abdomen', unit: 'cm', group: 'circumference', dp: 1 },
  { key: 'circ_hip_cm', label: 'Hip', unit: 'cm', group: 'circumference', dp: 1 },
  { key: 'circ_right_arm_cm', label: 'Right Arm', unit: 'cm', group: 'circumference', dp: 1 },
  { key: 'circ_left_arm_cm', label: 'Left Arm', unit: 'cm', group: 'circumference', dp: 1 },
  { key: 'circ_right_thigh_cm', label: 'Right Thigh', unit: 'cm', group: 'circumference', dp: 1 },
  { key: 'circ_left_thigh_cm', label: 'Left Thigh', unit: 'cm', group: 'circumference', dp: 1 },
  { key: 'arm_muscle_circumference_cm', label: 'Arm Muscle Circumference', unit: 'cm', group: 'circumference', preferredDirection: 'higher', dp: 1 },

  // Recommendations
  { key: 'target_weight_kg', label: 'Target Weight', unit: 'kg', group: 'recommendation', dp: 1 },
  { key: 'weight_control_kg', label: 'Weight Control', unit: 'kg', group: 'recommendation', dp: 1 },
  { key: 'fat_control_kg', label: 'Fat Control', unit: 'kg', group: 'recommendation', dp: 1 },
  { key: 'muscle_control_kg', label: 'Muscle Control', unit: 'kg', group: 'recommendation', dp: 1 },
];

export const METRIC_LABEL: Record<string, string> = Object.fromEntries(
  METRICS.map(m => [m.key, m.label]),
);

export const GROUP_LABELS: Record<MetricGroup, string> = {
  body_comp: 'Body Composition',
  derived: 'Derived',
  seg_lean: 'Segmental Lean',
  seg_fat: 'Segmental Fat',
  circumference: 'Circumferences',
  recommendation: 'Recommendations',
};

export function scanValue(scan: InbodyScan, key: string): number | null {
  const rec = scan as unknown as Record<string, unknown>;
  const v = rec[key];
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formatValue(val: number | null, m: MetricDef): string {
  if (val == null) return '—';
  const dp = m.dp ?? 1;
  const rounded = dp > 0 ? val.toFixed(dp) : Math.round(val).toString();
  return m.unit ? `${rounded} ${m.unit}` : rounded;
}

export type StatusLabel = 'IN RANGE' | 'BELOW' | 'ABOVE' | 'AT GOAL' | 'BELOW GOAL' | 'ABOVE GOAL' | 'NO REF';
export type StatusColor = 'good' | 'warn' | 'bad' | 'muted';

export interface MetricStatus {
  label: StatusLabel;
  color: StatusColor;
  refText: string;
}

/** 5% margin for the "close to range" warn zone. */
const WARN_FRACTION = 0.05;

export function evaluateAgainstNorm(value: number | null, range: BodyNormRange | undefined): MetricStatus {
  if (!range) return { label: 'NO REF', color: 'muted', refText: '—' };
  const refText = `${range.low}–${range.high}`;
  if (value == null) return { label: 'NO REF', color: 'muted', refText };
  const span = Math.max(1e-9, range.high - range.low);
  const warnAbs = span * WARN_FRACTION;
  if (value < range.low - warnAbs) return { label: 'BELOW', color: 'bad', refText };
  if (value > range.high + warnAbs) return { label: 'ABOVE', color: 'bad', refText };
  if (value < range.low || value > range.high) return { label: value < range.low ? 'BELOW' : 'ABOVE', color: 'warn', refText };
  return { label: 'IN RANGE', color: 'good', refText };
}

export function evaluateAgainstGoal(value: number | null, goal: BodyGoal | undefined): MetricStatus {
  if (!goal) return { label: 'NO REF', color: 'muted', refText: '—' };
  const refText = `${goal.direction === 'higher' ? '≥' : goal.direction === 'lower' ? '≤' : '='} ${goal.target_value}${goal.unit ? ' ' + goal.unit : ''}`;
  if (value == null) return { label: 'NO REF', color: 'muted', refText };
  const target = goal.target_value;
  const matchMargin = Math.max(1e-9, Math.abs(target) * WARN_FRACTION);
  if (goal.direction === 'higher') {
    if (value >= target) return { label: 'AT GOAL', color: 'good', refText };
    if (value >= target - matchMargin) return { label: 'BELOW GOAL', color: 'warn', refText };
    return { label: 'BELOW GOAL', color: 'bad', refText };
  }
  if (goal.direction === 'lower') {
    if (value <= target) return { label: 'AT GOAL', color: 'good', refText };
    if (value <= target + matchMargin) return { label: 'ABOVE GOAL', color: 'warn', refText };
    return { label: 'ABOVE GOAL', color: 'bad', refText };
  }
  // match
  const diff = Math.abs(value - target);
  if (diff <= matchMargin) return { label: 'AT GOAL', color: 'good', refText };
  if (diff <= matchMargin * 2) return { label: value > target ? 'ABOVE GOAL' : 'BELOW GOAL', color: 'warn', refText };
  return { label: value > target ? 'ABOVE GOAL' : 'BELOW GOAL', color: 'bad', refText };
}

export function statusColorClasses(c: StatusColor): { text: string; bg: string; ring: string } {
  switch (c) {
    case 'good': return { text: 'text-emerald-500', bg: 'bg-emerald-500/15', ring: 'ring-emerald-500/30' };
    case 'warn': return { text: 'text-amber-400', bg: 'bg-amber-400/15', ring: 'ring-amber-400/30' };
    case 'bad':  return { text: 'text-rose-500', bg: 'bg-rose-500/15', ring: 'ring-rose-500/30' };
    case 'muted':
    default:     return { text: 'text-muted-foreground', bg: 'bg-muted/20', ring: 'ring-border' };
  }
}

export function resolveStatus(
  value: number | null,
  metric: MetricDef,
  ref: ReferenceSet,
  norms: Record<string, BodyNormRange[]> | null,
  goals: Record<string, BodyGoal> | null,
): MetricStatus {
  if (ref === 'ME') {
    return evaluateAgainstGoal(value, goals?.[metric.key as string]);
  }
  // M or F: norms keyed by sex. Component calls getBodyNormRanges with the right sex.
  const range = norms?.[metric.key as string]?.[0];
  return evaluateAgainstNorm(value, range);
}
