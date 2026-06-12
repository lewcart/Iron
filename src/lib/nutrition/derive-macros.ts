/**
 * derive-macros.ts — client-side source of truth for effective meal macros.
 *
 * Mirrors the SQL logic in migration 052's nutrition_week_meal_effective view
 * exactly. Both derive sites must agree; a grep-guard test in
 * derive-macros.test.ts enforces that the scaling formula (`amount / per_qty`)
 * appears in exactly one place across this directory.
 *
 * Logic (matches GATE DECISION 1 + the SQL view):
 *   is_recipe = false → return meal's stored flat macros (legacy quick-add)
 *   is_recipe = true  → SUM over ingredients of amount / per_qty * food.macro
 *
 * per_qty guard: if per_qty is falsy (0 or null), the ingredient is skipped
 * (never divide by zero). In practice the DB CHECK (per_qty > 0) prevents this,
 * but we guard defensively here to match the SQL NULLIF(f.per_qty, 0) behaviour.
 */

// ─── Input types ─────────────────────────────────────────────────────────────

export interface DeriveFood {
  per_qty: number | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface DeriveIngredient {
  amount: number;
  food: DeriveFood;
}

export interface DeriveMeal {
  is_recipe: boolean;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface MacroResult {
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

// ─── Internal scaling helper (single derive site) ────────────────────────────

/**
 * scaleContribution — scale a single food macro by ingredient amount / per_qty.
 *
 * Returns null if per_qty is falsy (guard against division by zero) or if the
 * food macro value is null (unspecified).
 *
 * THE SCALING FORMULA LIVES HERE AND NOWHERE ELSE IN src/lib/nutrition.
 * The grep-guard test asserts this.
 */
function scaleContribution(
  amount: number,
  per_qty: number | null,
  macroValue: number | null,
): number | null {
  if (!per_qty) return null; // NULLIF guard: skip if 0 or null
  if (macroValue === null || macroValue === undefined) return null;
  return (amount / per_qty) * macroValue;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * deriveMealMacros — compute the effective macros for a week meal.
 *
 * @param meal        The week meal row (must include is_recipe + stored macros).
 * @param ingredients List of ingredient rows for this meal (pass [] if none).
 * @param foodsById   Map of food_uuid → food row (for recipe path lookups).
 *                    Pass a plain object or Map; unused when is_recipe=false.
 */
export function deriveMealMacros(
  meal: DeriveMeal,
  ingredients: DeriveIngredient[],
  // foodsById is intentionally not used when is_recipe=false; kept in signature
  // so callers always pass it (they shouldn't need to branch before calling).
  _foodsById?: Record<string, DeriveFood> | Map<string, DeriveFood>,
): MacroResult {
  // Legacy quick-add path — return stored aggregate unchanged.
  if (!meal.is_recipe) {
    return {
      calories: meal.calories,
      protein_g: meal.protein_g,
      carbs_g: meal.carbs_g,
      fat_g: meal.fat_g,
    };
  }

  // Recipe path — sum contributions from each ingredient.
  // Mirrors: SUM(amount / NULLIF(per_qty, 0) * food.macro) in the SQL view.
  // Empty ingredients → all four macros return null (mirrors SQL SUM() of nothing).
  type MacroKey = 'calories' | 'protein_g' | 'carbs_g' | 'fat_g';
  const macroKeys: MacroKey[] = ['calories', 'protein_g', 'carbs_g', 'fat_g'];

  const result = {} as MacroResult;

  for (const key of macroKeys) {
    let total = 0;
    let hasAny = false;

    for (const { amount, food } of ingredients) {
      const contribution = scaleContribution(amount, food.per_qty, food[key]);
      if (contribution !== null) {
        total += contribution;
        hasAny = true;
      }
    }

    result[key] = hasAny ? total : null;
  }

  return result;
}
