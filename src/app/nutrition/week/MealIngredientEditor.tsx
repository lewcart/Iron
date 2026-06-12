'use client';

/**
 * MealIngredientEditor — expandable ingredient disclosure for a Standard Week
 * meal row.
 *
 * GATE DECISION 1:
 *   - A meal that has is_recipe=false (default) shows its flat quick-add inputs
 *     unchanged, PLUS a "Convert to recipe" button below the existing edit fields.
 *   - Tapping "Convert to recipe" calls setMealIsRecipe(true) and the meal
 *     switches to ingredient mode. The stored aggregate macros are kept in the DB
 *     but are superseded by the derived sum once ingredients are added.
 *   - In ingredient mode: persistent live macro header; per-ingredient rows with
 *     inline amount edit and trash; "Add food" → AddIngredientSheet.
 *
 * This component is rendered inside the existing SlotSection rows in week/page.tsx.
 * It receives the full meal row and any related ingredients as props (the parent
 * reads from Dexie via hooks and passes them down, keeping this component pure/testable).
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { deriveMealMacros } from '@/lib/nutrition/derive-macros';
import {
  setMealIsRecipe,
  addMealIngredient,
  updateMealIngredientAmount,
  removeMealIngredient,
} from '@/lib/mutations-nutrition-foods';
import { promoteFoodFromResult, createManualFood } from '@/lib/nutrition/promote-food';
import type { LocalNutritionWeekMeal, LocalFood, LocalWeekMealIngredient } from '@/db/local';
import { AddIngredientSheet } from './AddIngredientSheet';
import type { AddIngredientResult } from './AddIngredientSheet';

interface Props {
  meal: LocalNutritionWeekMeal;
  ingredients: LocalWeekMealIngredient[];
  foodsById: Record<string, LocalFood>;
}

export function MealIngredientEditor({ meal, ingredients, foodsById }: Props) {
  const isRecipe = !!meal.is_recipe;

  // ── Convert to recipe ─────────────────────────────────────────────────────
  if (!isRecipe) {
    return (
      <ConvertPrompt meal={meal} />
    );
  }

  // ── Recipe mode ───────────────────────────────────────────────────────────
  return (
    <RecipeEditor
      meal={meal}
      ingredients={ingredients}
      foodsById={foodsById}
    />
  );
}

// ─── ConvertPrompt ────────────────────────────────────────────────────────────

function ConvertPrompt({ meal }: { meal: LocalNutritionWeekMeal }) {
  const [converting, setConverting] = useState(false);

  async function handleConvert() {
    setConverting(true);
    try {
      await setMealIsRecipe(meal.uuid, true);
    } finally {
      setConverting(false);
    }
  }

  return (
    <div className="px-4 pb-3 pt-1">
      <button
        type="button"
        onClick={handleConvert}
        disabled={converting}
        className="text-xs text-primary hover:underline disabled:opacity-40"
        aria-label={`Convert ${meal.meal_name} to recipe`}
      >
        {converting ? 'Converting…' : 'Convert to recipe'}
      </button>
    </div>
  );
}

// ─── RecipeEditor ─────────────────────────────────────────────────────────────

interface RecipeEditorProps {
  meal: LocalNutritionWeekMeal;
  ingredients: LocalWeekMealIngredient[];
  foodsById: Record<string, LocalFood>;
}

function RecipeEditor({ meal, ingredients, foodsById }: RecipeEditorProps) {
  const [expanded, setExpanded] = useState(true);
  const [addSheetOpen, setAddSheetOpen] = useState(false);

  // Build DeriveIngredient list for live macro computation
  const deriveIngredients = ingredients
    .map(i => {
      const food = foodsById[i.food_uuid];
      if (!food) return null;
      return {
        amount: Number(i.amount),
        food: {
          per_qty: Number(food.per_qty),
          calories: food.calories != null ? Number(food.calories) : null,
          protein_g: food.protein_g != null ? Number(food.protein_g) : null,
          carbs_g: food.carbs_g != null ? Number(food.carbs_g) : null,
          fat_g: food.fat_g != null ? Number(food.fat_g) : null,
        },
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const effectiveMacros = deriveMealMacros(
    {
      is_recipe: true,
      calories: meal.calories,
      protein_g: meal.protein_g,
      carbs_g: meal.carbs_g,
      fat_g: meal.fat_g,
    },
    deriveIngredients,
  );

  async function handleAdd(result: AddIngredientResult) {
    let foodUuid: string;

    if (result.searchResult) {
      // Promote search result into local foods table (idempotent)
      foodUuid = await promoteFoodFromResult(result.searchResult);
    } else if (result.manual) {
      const m = result.manual;
      foodUuid = await createManualFood({
        name: m.name,
        per_unit: 'serve',
        per_qty: 1,
        calories: m.calories ? parseFloat(m.calories) : null,
        protein_g: m.protein_g ? parseFloat(m.protein_g) : null,
        carbs_g: m.carbs_g ? parseFloat(m.carbs_g) : null,
        fat_g: m.fat_g ? parseFloat(m.fat_g) : null,
      });
    } else {
      return;
    }

    await addMealIngredient({
      week_meal_uuid: meal.uuid,
      food_uuid: foodUuid,
      amount: result.amount,
      sort_order: ingredients.length,
    });

    setAddSheetOpen(false);
  }

  return (
    <div className="pb-1">
      {/* Disclosure toggle + persistent live macro header */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        aria-pressed={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ingredients for ${meal.meal_name}`}
        className="w-full flex items-center justify-between px-4 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0" />
          )}
          <span>
            {ingredients.length === 0
              ? 'Ingredients'
              : `${ingredients.length} ingredient${ingredients.length !== 1 ? 's' : ''}`}
          </span>
        </div>

        {/* Live macro summary — always visible */}
        <MacroSummary
          calories={effectiveMacros.calories}
          protein_g={effectiveMacros.protein_g}
          carbs_g={effectiveMacros.carbs_g}
          fat_g={effectiveMacros.fat_g}
        />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-2 space-y-0">
          {ingredients.length === 0 && (
            <div className="text-xs text-muted-foreground py-2">
              No ingredients yet. Add one below.
            </div>
          )}

          {ingredients.map((ingredient) => {
            const food = foodsById[ingredient.food_uuid];
            return (
              <IngredientRow
                key={ingredient.uuid}
                ingredient={ingredient}
                food={food ?? null}
                onUpdateAmount={(amount) =>
                  updateMealIngredientAmount(ingredient.uuid, amount)
                }
                onRemove={() => removeMealIngredient(ingredient.uuid)}
              />
            );
          })}

          {/* Add food button */}
          <button
            type="button"
            onClick={() => setAddSheetOpen(true)}
            className="w-full flex items-center gap-1.5 py-2 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="size-3.5" />
            Add food
          </button>
        </div>
      )}

      <AddIngredientSheet
        open={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        onAdd={handleAdd}
      />
    </div>
  );
}

// ─── IngredientRow ────────────────────────────────────────────────────────────

interface IngredientRowProps {
  ingredient: LocalWeekMealIngredient;
  food: LocalFood | null;
  onUpdateAmount: (amount: number) => Promise<void> | void;
  onRemove: () => Promise<void> | void;
}

function IngredientRow({ ingredient, food, onUpdateAmount, onRemove }: IngredientRowProps) {
  // Local draft: editing amount without round-tripping on every keystroke
  const [localAmount, setLocalAmount] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const displayAmount = localAmount ?? String(ingredient.amount);

  const perUnit = food?.per_unit ?? 'serve';
  const perQty = food?.per_qty ? Number(food.per_qty) : 1;
  const amount = localAmount !== null ? parseFloat(localAmount) : Number(ingredient.amount);

  // Contribution macros (for display next to the ingredient)
  const contribution = food
    ? {
        calories:
          food.calories != null && perQty > 0
            ? (amount / perQty) * Number(food.calories)
            : null,
        protein_g:
          food.protein_g != null && perQty > 0
            ? (amount / perQty) * Number(food.protein_g)
            : null,
      }
    : { calories: null, protein_g: null };

  async function handleBlur() {
    if (localAmount === null) return;
    const parsed = parseFloat(localAmount);
    if (Number.isFinite(parsed) && parsed > 0) {
      await onUpdateAmount(parsed);
    } else {
      // Revert to last persisted value
      setLocalAmount(null);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      await onRemove();
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0">
      {/* Food name */}
      <div className="flex-1 min-w-0">
        <span className="text-sm truncate block">
          {food?.name ?? '(loading…)'}
        </span>
        {/* Contribution: kcal + protein */}
        <span className="text-[11px] text-muted-foreground">
          {contribution.calories != null
            ? `${Math.round(contribution.calories)} kcal`
            : '—'}
          {contribution.protein_g != null
            ? ` · ${Math.round(contribution.protein_g)}p`
            : ''}
        </span>
      </div>

      {/* Inline amount edit */}
      <div className="flex items-center gap-1 shrink-0">
        <input
          type="number"
          inputMode="decimal"
          value={displayAmount}
          onChange={(e) => setLocalAmount(e.target.value)}
          onBlur={handleBlur}
          aria-label={`Amount for ${food?.name ?? 'ingredient'}`}
          className="w-16 h-8 px-2 rounded-lg bg-muted/40 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground w-6 shrink-0">{perUnit}</span>
      </div>

      {/* Trash */}
      <button
        type="button"
        onClick={handleRemove}
        disabled={removing}
        aria-label={`Remove ${food?.name ?? 'ingredient'}`}
        className="p-1.5 text-muted-foreground hover:text-red-500 disabled:opacity-40 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

// ─── MacroSummary ─────────────────────────────────────────────────────────────

function MacroSummary({
  calories,
  protein_g,
  carbs_g,
  fat_g,
}: {
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}) {
  if (calories == null && protein_g == null) {
    return <span className="text-xs text-muted-foreground/60">no ingredients</span>;
  }
  return (
    <span className="text-xs text-muted-foreground tabular-nums flex gap-2">
      {calories != null && <span>{Math.round(calories)} kcal</span>}
      {protein_g != null && <span>{Math.round(protein_g)}p</span>}
      {carbs_g != null && <span>{Math.round(carbs_g)}c</span>}
      {fat_g != null && <span>{Math.round(fat_g)}f</span>}
    </span>
  );
}
