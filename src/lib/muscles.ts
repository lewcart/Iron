/**
 * Canonical muscle taxonomy — TypeScript mirror of the `muscles` and
 * `muscle_synonyms` tables seeded by migration 026.
 *
 * The Postgres trigger `validate_exercise_muscles` is the source of truth at
 * write time; this module is a typed accessor for client code (Dexie types,
 * UI pickers, MCP tool validation) that needs the same list without a DB
 * round-trip.
 *
 * Keep this in sync with:
 *   src/db/migrations/026_canonical_muscles.sql  (server seed)
 *   scripts/normalize-muscle-tags.mjs            (catalog rewrite synonym map)
 */

export const MUSCLE_SLUGS = [
  'chest',
  'lats',
  'rhomboids',
  'mid_traps',
  'lower_traps',
  'erectors',
  'delts',
  'rotator_cuff',
  'biceps',
  'triceps',
  'forearms',
  'core',
  'glutes',
  'quads',
  'hamstrings',
  'hip_abductors',
  'hip_adductors',
  'calves',
] as const;

export type MuscleSlug = (typeof MUSCLE_SLUGS)[number];

export type MuscleParentGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'arms'
  | 'core'
  | 'legs';

export interface MuscleDef {
  slug: MuscleSlug;
  display_name: string;
  parent_group: MuscleParentGroup;
  optimal_sets_min: number;
  optimal_sets_max: number;
  display_order: number;
}

/**
 * Hardcoded mirror of the seeded `muscles` rows. Used as a fallback when the
 * Dexie `muscles` table hasn't synced yet (first launch, offline cold start).
 * Server values override these once sync runs.
 */
export const MUSCLE_DEFS: Record<MuscleSlug, MuscleDef> = {
  chest:         { slug: 'chest',         display_name: 'Chest',         parent_group: 'chest',     optimal_sets_min: 10, optimal_sets_max: 20, display_order:  10 },
  lats:          { slug: 'lats',          display_name: 'Lats',          parent_group: 'back',      optimal_sets_min: 10, optimal_sets_max: 20, display_order:  20 },
  rhomboids:     { slug: 'rhomboids',     display_name: 'Rhomboids',     parent_group: 'back',      optimal_sets_min: 10, optimal_sets_max: 20, display_order:  30 },
  mid_traps:     { slug: 'mid_traps',     display_name: 'Mid Traps',     parent_group: 'back',      optimal_sets_min: 10, optimal_sets_max: 20, display_order:  40 },
  lower_traps:   { slug: 'lower_traps',   display_name: 'Lower Traps',   parent_group: 'back',      optimal_sets_min: 10, optimal_sets_max: 20, display_order:  50 },
  erectors:      { slug: 'erectors',      display_name: 'Erectors',      parent_group: 'back',      optimal_sets_min: 10, optimal_sets_max: 20, display_order:  60 },
  delts:         { slug: 'delts',         display_name: 'Delts',         parent_group: 'shoulders', optimal_sets_min: 10, optimal_sets_max: 20, display_order:  70 },
  rotator_cuff:  { slug: 'rotator_cuff',  display_name: 'Rotator Cuff',  parent_group: 'shoulders', optimal_sets_min:  2, optimal_sets_max:  8, display_order:  80 },
  biceps:        { slug: 'biceps',        display_name: 'Biceps',        parent_group: 'arms',      optimal_sets_min: 10, optimal_sets_max: 20, display_order:  90 },
  triceps:       { slug: 'triceps',       display_name: 'Triceps',       parent_group: 'arms',      optimal_sets_min: 10, optimal_sets_max: 20, display_order: 100 },
  forearms:      { slug: 'forearms',      display_name: 'Forearms',      parent_group: 'arms',      optimal_sets_min:  4, optimal_sets_max: 10, display_order: 110 },
  core:          { slug: 'core',          display_name: 'Core',          parent_group: 'core',      optimal_sets_min: 10, optimal_sets_max: 20, display_order: 120 },
  glutes:        { slug: 'glutes',        display_name: 'Glutes',        parent_group: 'legs',      optimal_sets_min: 10, optimal_sets_max: 20, display_order: 130 },
  quads:         { slug: 'quads',         display_name: 'Quads',         parent_group: 'legs',      optimal_sets_min: 10, optimal_sets_max: 20, display_order: 140 },
  hamstrings:    { slug: 'hamstrings',    display_name: 'Hamstrings',    parent_group: 'legs',      optimal_sets_min: 10, optimal_sets_max: 20, display_order: 150 },
  hip_abductors: { slug: 'hip_abductors', display_name: 'Hip Abductors', parent_group: 'legs',      optimal_sets_min: 10, optimal_sets_max: 20, display_order: 160 },
  hip_adductors: { slug: 'hip_adductors', display_name: 'Hip Adductors', parent_group: 'legs',      optimal_sets_min: 10, optimal_sets_max: 20, display_order: 170 },
  calves:        { slug: 'calves',        display_name: 'Calves',        parent_group: 'legs',      optimal_sets_min: 10, optimal_sets_max: 20, display_order: 180 },
};

/**
 * Synonym → canonical slug map. Mirrors migration 026's `muscle_synonyms`.
 * Used by find_exercises (forgiving muscle_group filter) and the catalog
 * normalize script.
 */
export const MUSCLE_SYNONYMS: Record<string, MuscleSlug> = {
  // chest
  'chest': 'chest',
  'pectoralis major': 'chest',
  'pectorals': 'chest',
  'pecs': 'chest',
  // lats
  'lats': 'lats',
  'latissimus dorsi': 'lats',
  'latissimus': 'lats',
  // rhomboids
  'rhomboids': 'rhomboids',
  // mid/lower traps
  'mid_traps': 'mid_traps',
  'mid traps': 'mid_traps',
  'trapezius': 'mid_traps',
  'upper traps': 'mid_traps',
  'lower_traps': 'lower_traps',
  'lower traps': 'lower_traps',
  'lower trapezius': 'lower_traps',
  // erectors
  'erectors': 'erectors',
  'erector spinae': 'erectors',
  'lower back': 'erectors',
  // delts
  'delts': 'delts',
  'deltoid': 'delts',
  'deltoids': 'delts',
  'shoulders': 'delts',
  'rear delts': 'delts',
  // rotator cuff
  'rotator_cuff': 'rotator_cuff',
  'rotator cuff': 'rotator_cuff',
  // biceps
  'biceps': 'biceps',
  'biceps brachii': 'biceps',
  'brachialis': 'biceps',
  // triceps
  'triceps': 'triceps',
  'triceps brachii': 'triceps',
  // forearms
  'forearms': 'forearms',
  'forearm': 'forearms',
  'forerm': 'forearms',
  // core
  'core': 'core',
  'abdominals': 'core',
  'abs': 'core',
  'obliques': 'core',
  'deep stabilisers': 'core',
  'hip flexors': 'core',
  // glutes
  'glutes': 'glutes',
  'glutaeus maximus': 'glutes',
  'gluteus maximus': 'glutes',
  // quads
  'quads': 'quads',
  'quadriceps': 'quads',
  // hamstrings
  'hamstrings': 'hamstrings',
  'ischiocrural muscles': 'hamstrings',
  // hip abductors / adductors
  'hip_abductors': 'hip_abductors',
  'hip abductors': 'hip_abductors',
  'tensor fasciae latae': 'hip_abductors',
  'hip stabilisers': 'hip_abductors',
  'hip_adductors': 'hip_adductors',
  'hip adductors': 'hip_adductors',
  // calves
  'calves': 'calves',
  'gastrocnemius': 'calves',
  'soleus': 'calves',
};

/** True if `value` is a canonical slug. */
export function isMuscleSlug(value: unknown): value is MuscleSlug {
  return typeof value === 'string' && value in MUSCLE_DEFS;
}

/**
 * Resolve any legacy muscle name (or canonical slug) to a canonical slug.
 * Returns null for unknown values. Lookup is case-insensitive on the input.
 */
export function resolveMuscleSlug(value: string): MuscleSlug | null {
  const normalized = value.trim().toLowerCase();
  return MUSCLE_SYNONYMS[normalized] ?? null;
}

/** Default optimal range used as a fallback when the muscles table is empty. */
export function defaultOptimalRange(slug: MuscleSlug): { min: number; max: number } {
  const def = MUSCLE_DEFS[slug];
  return { min: def.optimal_sets_min, max: def.optimal_sets_max };
}

/** Status of a muscle's weekly set count vs its optimal range. */
export type MuscleStatus = 'zero' | 'under' | 'optimal' | 'over';

export function muscleStatus(setCount: number, min: number, max: number): MuscleStatus {
  if (setCount === 0) return 'zero';
  if (setCount < min) return 'under';
  if (setCount > max) return 'over';
  return 'optimal';
}

/**
 * Normalize raw muscle tags from the DB/Dexie boundary into canonical slugs.
 *
 * Handles non-array/null input, legacy synonyms (e.g. "shoulders" → "delts"),
 * unknown values (silently dropped), and dedupes primary > secondary so the
 * same muscle never appears in both buckets.
 */
export function normalizeMuscleTags(
  rawPrimary: unknown,
  rawSecondary: unknown,
): { primary: MuscleSlug[]; secondary: MuscleSlug[] } {
  const norm = (raw: unknown): MuscleSlug[] => {
    if (!Array.isArray(raw)) return [];
    const out: MuscleSlug[] = [];
    const seen = new Set<MuscleSlug>();
    for (const v of raw) {
      if (typeof v !== 'string') continue;
      const slug = resolveMuscleSlug(v);
      if (slug && !seen.has(slug)) {
        out.push(slug);
        seen.add(slug);
      }
    }
    return out;
  };
  const primary = norm(rawPrimary);
  const primarySet = new Set(primary);
  const secondary = norm(rawSecondary).filter((s) => !primarySet.has(s));
  return { primary, secondary };
}
