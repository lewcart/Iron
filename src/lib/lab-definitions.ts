// Canonical lab metadata for the Labs surface.
//
// Mirrors the seed in src/db/migrations/020_hrt_labs_meds.sql one-for-one;
// changes here MUST go in both places (migration for MCP server-side,
// constant for UI). Single-user app, ~50 rows, low churn — duplication is
// a small tax for keeping UI rendering synchronous and offline-safe.
//
// Sex-specific reference ranges (E2, Testosterone) carry both male and female
// bounds. The UI defaults to female ranges (Lewis's relevant set); MCP tools
// expose both so callers can pick.

export interface LabDefinition {
  lab_code: string;
  label: string;
  unit: string | null;
  ref_low: number | null;
  ref_high: number | null;
  ref_text: string | null;
  ref_female_low: number | null;
  ref_female_high: number | null;
  ref_male_low: number | null;
  ref_male_high: number | null;
  category: LabCategory;
  sort_order: number;
}

export type LabCategory =
  | 'hormones'
  | 'thyroid'
  | 'lipids'
  | 'inflammation'
  | 'blood'
  | 'electrolytes'
  | 'kidney'
  | 'liver'
  | 'minerals'
  | 'other';

export const LAB_CATEGORY_LABELS: Record<LabCategory, string> = {
  hormones: 'Hormones',
  thyroid: 'Thyroid',
  lipids: 'Lipids',
  inflammation: 'Inflammation',
  blood: 'Blood',
  electrolytes: 'Electrolytes',
  kidney: 'Kidney',
  liver: 'Liver',
  minerals: 'Minerals & Bone',
  other: 'Other',
};

export const LAB_DEFINITIONS: LabDefinition[] = [
  // Sex hormones (HRT-relevant)
  { lab_code: 'e2',                  label: 'E2 (Estradiol)',     unit: 'pmol/L', ref_low: null, ref_high: null, ref_text: 'Male: <150 / Female: 250–1000', ref_female_low: 250, ref_female_high: 1000, ref_male_low: null, ref_male_high: 150, category: 'hormones', sort_order: 10 },
  { lab_code: 'testosterone',        label: 'Testosterone',       unit: 'nmol/L', ref_low: null, ref_high: null, ref_text: 'Male: 10.0–33.0 / Female: <2.5', ref_female_low: 0, ref_female_high: 2.5, ref_male_low: 10, ref_male_high: 33, category: 'hormones', sort_order: 20 },
  { lab_code: 'fsh',                 label: 'FSH',                unit: 'IU/L',   ref_low: 1,    ref_high: 10,    ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'hormones', sort_order: 30 },
  { lab_code: 'lh',                  label: 'LH',                 unit: 'IU/L',   ref_low: 1,    ref_high: 10,    ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'hormones', sort_order: 40 },
  { lab_code: 'prl',                 label: 'PRL (Prolactin)',    unit: 'mIU/L',  ref_low: null, ref_high: 300,   ref_text: '<300', ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'hormones', sort_order: 50 },

  // Thyroid
  { lab_code: 'tsh',                 label: 'TSH',                unit: 'mIU/L',  ref_low: 0.5,  ref_high: 4.0,   ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'thyroid', sort_order: 60 },

  // Lipids
  { lab_code: 'total_cholesterol',   label: 'Total Cholesterol',  unit: 'mmol/L', ref_low: null, ref_high: 4.0,   ref_text: '<4.0', ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'lipids', sort_order: 100 },
  { lab_code: 'hdl',                 label: 'HDL',                unit: 'mmol/L', ref_low: 1.0,  ref_high: null,  ref_text: '>1.0', ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'lipids', sort_order: 110 },
  { lab_code: 'ldl',                 label: 'LDL',                unit: 'mmol/L', ref_low: null, ref_high: 2.5,   ref_text: '<2.5', ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'lipids', sort_order: 120 },
  { lab_code: 'non_hdl',             label: 'Non-HDL',            unit: 'mmol/L', ref_low: null, ref_high: 3.3,   ref_text: '<3.3', ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'lipids', sort_order: 130 },
  { lab_code: 'total_hdl_ratio',     label: 'Total/HDL ratio',    unit: null,     ref_low: null, ref_high: null,  ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'lipids', sort_order: 140 },
  { lab_code: 'triglycerides',       label: 'Triglycerides',      unit: 'mmol/L', ref_low: null, ref_high: 2.0,   ref_text: '<2.0', ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'lipids', sort_order: 150 },

  // Inflammation
  { lab_code: 'crp',                 label: 'CRP',                unit: 'mg/L',   ref_low: 0,    ref_high: 6,     ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'inflammation', sort_order: 200 },

  // Blood / haematology
  { lab_code: 'hb',                  label: 'Hb (Haemoglobin)',   unit: 'g/L',    ref_low: 135,  ref_high: 180,   ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'blood', sort_order: 300 },
  { lab_code: 'hct',                 label: 'Hct (Haematocrit)',  unit: null,     ref_low: 0.38, ref_high: 0.52,  ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'blood', sort_order: 310 },
  { lab_code: 'rcc',                 label: 'RCC',                unit: 'x10^12/L', ref_low: 4.2, ref_high: 6.0,  ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'blood', sort_order: 320 },
  { lab_code: 'mcv',                 label: 'MCV',                unit: 'fL',     ref_low: 80,   ref_high: 98,    ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'blood', sort_order: 330 },
  { lab_code: 'mch',                 label: 'MCH',                unit: 'pg',     ref_low: 27,   ref_high: 35,    ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'blood', sort_order: 340 },
  { lab_code: 'platelets',           label: 'Platelets',          unit: 'x10^9/L', ref_low: 150, ref_high: 450,   ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'blood', sort_order: 350 },
  { lab_code: 'wcc',                 label: 'WCC',                unit: 'x10^9/L', ref_low: 4.0, ref_high: 11.0,  ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'blood', sort_order: 360 },
  { lab_code: 'neutrophils',         label: 'Neutrophils',        unit: '%',      ref_low: null, ref_high: null,  ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'blood', sort_order: 370 },
  { lab_code: 'lymphocytes',         label: 'Lymphocytes',        unit: '%',      ref_low: null, ref_high: null,  ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'blood', sort_order: 380 },
  { lab_code: 'monocytes',           label: 'Monocytes',          unit: '%',      ref_low: null, ref_high: null,  ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'blood', sort_order: 390 },
  { lab_code: 'eosinophils',         label: 'Eosinophils',        unit: '%',      ref_low: null, ref_high: null,  ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'blood', sort_order: 400 },
  { lab_code: 'basophils',           label: 'Basophils',          unit: '%',      ref_low: null, ref_high: null,  ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'blood', sort_order: 410 },
  { lab_code: 'ferritin',            label: 'Ferritin',           unit: 'ug/L',   ref_low: 30,   ref_high: 320,   ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'blood', sort_order: 420 },

  // Electrolytes
  { lab_code: 'sodium',              label: 'Sodium',             unit: 'mmol/L', ref_low: 137,  ref_high: 147,   ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'electrolytes', sort_order: 500 },
  { lab_code: 'potassium',           label: 'Potassium',          unit: 'mmol/L', ref_low: 3.5,  ref_high: 5.0,   ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'electrolytes', sort_order: 510 },
  { lab_code: 'chloride',            label: 'Chloride',           unit: 'mmol/L', ref_low: 96,   ref_high: 109,   ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'electrolytes', sort_order: 520 },
  { lab_code: 'bicarbonate',         label: 'Bicarbonate',        unit: 'mmol/L', ref_low: 25,   ref_high: 33,    ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'electrolytes', sort_order: 530 },
  { lab_code: 'anion_gap',           label: 'Anion Gap',          unit: 'mmol/L', ref_low: 4,    ref_high: 17,    ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'electrolytes', sort_order: 540 },

  // Glucose
  { lab_code: 'glucose',             label: 'Glucose',            unit: 'mmol/L', ref_low: 3.0,  ref_high: 7.7,   ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'other', sort_order: 600 },

  // Kidney
  { lab_code: 'urea',                label: 'Urea',               unit: 'mmol/L', ref_low: 2.5,  ref_high: 8.0,   ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'kidney', sort_order: 700 },
  { lab_code: 'creatinine',          label: 'Creatinine',         unit: 'umol/L', ref_low: 60,   ref_high: 130,   ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'kidney', sort_order: 710 },
  { lab_code: 'egfr',                label: 'eGFR',               unit: 'mL/min', ref_low: 59,   ref_high: null,  ref_text: '>59', ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'kidney', sort_order: 720 },
  { lab_code: 'urate',               label: 'Urate',              unit: 'mmol/L', ref_low: 0.12, ref_high: 0.45,  ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'kidney', sort_order: 730 },

  // Liver
  { lab_code: 't_bilirubin',         label: 'T.Bilirubin',        unit: 'umol/L', ref_low: 2,    ref_high: 20,    ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'liver', sort_order: 800 },
  { lab_code: 'alp',                 label: 'ALP',                unit: 'U/L',    ref_low: 30,   ref_high: 115,   ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'liver', sort_order: 810 },
  { lab_code: 'ggt',                 label: 'GGT',                unit: 'U/L',    ref_low: 0,    ref_high: 70,    ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'liver', sort_order: 820 },
  { lab_code: 'alt',                 label: 'ALT',                unit: 'U/L',    ref_low: 0,    ref_high: 45,    ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'liver', sort_order: 830 },
  { lab_code: 'ast',                 label: 'AST',                unit: 'U/L',    ref_low: 0,    ref_high: 41,    ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'liver', sort_order: 840 },
  { lab_code: 'ld',                  label: 'LD',                 unit: 'U/L',    ref_low: 80,   ref_high: 250,   ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'liver', sort_order: 850 },
  { lab_code: 'total_protein',       label: 'Total Protein',      unit: 'g/L',    ref_low: 60,   ref_high: 82,    ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'liver', sort_order: 860 },
  { lab_code: 'albumin',             label: 'Albumin',            unit: 'g/L',    ref_low: 35,   ref_high: 50,    ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'liver', sort_order: 870 },
  { lab_code: 'globulin',            label: 'Globulin',           unit: 'g/L',    ref_low: 20,   ref_high: 40,    ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'liver', sort_order: 880 },

  // Minerals + bone
  { lab_code: 'calcium',             label: 'Calcium',            unit: 'mmol/L', ref_low: 2.15, ref_high: 2.60,  ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'minerals', sort_order: 900 },
  { lab_code: 'corrected_calcium',   label: 'Corrected Calcium',  unit: 'mmol/L', ref_low: 2.15, ref_high: 2.60,  ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'minerals', sort_order: 910 },
  { lab_code: 'phosphate',           label: 'Phosphate',          unit: 'mmol/L', ref_low: 0.8,  ref_high: 1.5,   ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'minerals', sort_order: 920 },
  { lab_code: 'pth',                 label: 'PTH',                unit: 'pmol/L', ref_low: 1.5,  ref_high: 7.6,   ref_text: null, ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'minerals', sort_order: 930 },
  { lab_code: 'vitamin_d3',          label: 'Vitamin D3',         unit: 'nmol/L', ref_low: 49,   ref_high: null,  ref_text: '>49', ref_female_low: null, ref_female_high: null, ref_male_low: null, ref_male_high: null, category: 'minerals', sort_order: 940 },
];

export const LAB_DEFINITIONS_BY_CODE: Record<string, LabDefinition> =
  Object.fromEntries(LAB_DEFINITIONS.map(d => [d.lab_code, d]));

// ─── Range evaluation ────────────────────────────────────────────────────────

export type RangeStatus = 'in_range' | 'low' | 'high' | 'unknown';

/**
 * Evaluate where a value falls vs the reference range. Sex-specific labs
 * (E2, Testosterone) take a `sex` argument; defaults to 'female' which is
 * Lewis's relevant set.
 *
 * Status semantics:
 *   in_range — value is within [low, high] (or beats a one-sided bound)
 *   low      — value below low bound
 *   high     — value above high bound
 *   unknown  — no numeric range; cannot evaluate
 */
export function evaluateLabRange(
  def: LabDefinition,
  value: number,
  sex: 'female' | 'male' = 'female',
): RangeStatus {
  const sexLow = sex === 'female' ? def.ref_female_low : def.ref_male_low;
  const sexHigh = sex === 'female' ? def.ref_female_high : def.ref_male_high;
  const low = sexLow ?? def.ref_low;
  const high = sexHigh ?? def.ref_high;

  // No bounds at all → unknown
  if (low == null && high == null) return 'unknown';

  if (low != null && value < low) return 'low';
  if (high != null && value > high) return 'high';
  return 'in_range';
}
