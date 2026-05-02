import { MUSCLE_DEFS, type MuscleParentGroup, type MuscleSlug } from './muscles';

const MUSCLE_COLORS: Record<string, string> = {
  chest: '#3b82f6',
  back: '#f97316',
  shoulders: '#a855f7',
  arms: '#ec4899',
  legs: '#10b981',
  abdominals: '#f59e0b',
  default: '#6b7280',
};

const PARENT_GROUP_COLORS: Record<MuscleParentGroup, string> = {
  chest: '#3b82f6', // blue 500
  back: '#f97316', // orange 500
  shoulders: '#a855f7', // purple 500
  arms: '#ec4899', // pink 500
  core: '#f59e0b', // amber 500
  legs: '#10b981', // emerald 500
};

/**
 * Lighter variants used for secondary muscles in MuscleMap. Same hue, less
 * saturation so the diagram reads "primary stronger than secondary" without
 * relying on the role label alone.
 */
const PARENT_GROUP_COLORS_LIGHT: Record<MuscleParentGroup, string> = {
  chest: '#93c5fd', // blue 300
  back: '#fdba74', // orange 300
  shoulders: '#d8b4fe', // purple 300
  arms: '#f9a8d4', // pink 300
  core: '#fcd34d', // amber 300
  legs: '#6ee7b7', // emerald 300
};

/**
 * Darker variants for primary-muscle borders in the body diagram. Same hue,
 * more saturation — they ring the filled region so primary muscles read as
 * "louder than secondary" beyond color alone.
 */
const PARENT_GROUP_COLORS_DARK: Record<MuscleParentGroup, string> = {
  chest: '#1d4ed8', // blue 700
  back: '#c2410c', // orange 700
  shoulders: '#7e22ce', // purple 700
  arms: '#be185d', // pink 700
  core: '#b45309', // amber 700
  legs: '#047857', // emerald 700
};

/**
 * Legacy substring-matching helper. Kept for callers that pass arbitrary
 * `string[]` (not necessarily canonical slugs). New code should prefer
 * {@link getMuscleGroupColor} for type safety.
 */
export function getMuscleColor(muscles: string[]): string {
  for (const m of muscles) {
    const key = m.toLowerCase();
    for (const [k, v] of Object.entries(MUSCLE_COLORS)) {
      if (key.includes(k)) return v;
    }
  }
  return MUSCLE_COLORS.default;
}

/** Typed accessor: returns the canonical hex for a muscle parent group. */
export function getMuscleGroupColor(group: MuscleParentGroup): string {
  return PARENT_GROUP_COLORS[group];
}

/** Lighter variant of the parent-group color, for secondary roles. */
export function getMuscleGroupColorLight(group: MuscleParentGroup): string {
  return PARENT_GROUP_COLORS_LIGHT[group];
}

/** Darker variant of the parent-group color, used as a border on primary fills. */
export function getMuscleGroupColorDark(group: MuscleParentGroup): string {
  return PARENT_GROUP_COLORS_DARK[group];
}

/** Convenience: resolve a canonical slug to its parent-group color. */
export function getSlugColor(slug: MuscleSlug): string {
  return PARENT_GROUP_COLORS[MUSCLE_DEFS[slug].parent_group];
}
