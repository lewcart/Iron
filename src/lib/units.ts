// Weight unit conversion utilities

export type WeightUnit = 'kg' | 'lbs';

const KG_TO_LBS = 2.20462;
const LBS_TO_KG = 0.453592;

export function kgToLbs(kg: number): number {
  return kg * KG_TO_LBS;
}

export function lbsToKg(lbs: number): number {
  return lbs * LBS_TO_KG;
}

/** Convert a kg value to the display unit (no rounding). */
export function toDisplayWeight(kg: number, unit: WeightUnit): number {
  return unit === 'lbs' ? kgToLbs(kg) : kg;
}

/** Convert a user-entered value (in display unit) back to kg for storage. */
export function fromDisplayWeight(value: number, unit: WeightUnit): number {
  return unit === 'lbs' ? lbsToKg(value) : value;
}

/** Round a display weight to a sensible precision. */
export function roundDisplayWeight(value: number, _unit: WeightUnit): number {
  return Math.round(value * 10) / 10;
}

/** Format a kg value with its unit label, e.g. "80.0 kg" or "176.4 lbs". */
export function formatWeight(kg: number, unit: WeightUnit): string {
  const val = roundDisplayWeight(toDisplayWeight(kg, unit), unit);
  return `${val} ${unit}`;
}
