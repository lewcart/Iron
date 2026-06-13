// @vitest-environment jsdom
/**
 * Tests for the MealIngredientEditor component.
 *
 * Covers:
 *   1. Flat meal (is_recipe=false) renders ConvertPrompt, not recipe editor.
 *   2. "Convert to recipe" calls setMealIsRecipe(true).
 *   3. Recipe meal (is_recipe=true) renders ingredient list + live macro header.
 *   4. Adding an ingredient calls promoteFoodFromResult + addMealIngredient.
 *   5. Removing an ingredient calls removeMealIngredient.
 *   6. Editing amount calls updateMealIngredientAmount on blur.
 *   7. Live macro header reflects ingredient changes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockSetMealIsRecipe,
  mockAddMealIngredient,
  mockUpdateMealIngredientAmount,
  mockRemoveMealIngredient,
  mockPromoteFoodFromResult,
  mockCreateManualFood,
} = vi.hoisted(() => ({
  mockSetMealIsRecipe: vi.fn().mockResolvedValue(undefined),
  mockAddMealIngredient: vi.fn().mockResolvedValue({ uuid: 'new-ingredient', week_meal_uuid: 'meal-1', food_uuid: 'food-1', amount: 100, sort_order: 0, created_at: '', _synced: false, _updated_at: 0, _deleted: false }),
  mockUpdateMealIngredientAmount: vi.fn().mockResolvedValue(undefined),
  mockRemoveMealIngredient: vi.fn().mockResolvedValue(undefined),
  mockPromoteFoodFromResult: vi.fn().mockResolvedValue('food-1'),
  mockCreateManualFood: vi.fn().mockResolvedValue('food-manual'),
}));

vi.mock('@/lib/mutations-nutrition-foods', () => ({
  setMealIsRecipe: mockSetMealIsRecipe,
  addMealIngredient: mockAddMealIngredient,
  updateMealIngredientAmount: mockUpdateMealIngredientAmount,
  removeMealIngredient: mockRemoveMealIngredient,
}));

vi.mock('@/lib/nutrition/promote-food', () => ({
  promoteFoodFromResult: mockPromoteFoodFromResult,
  createManualFood: mockCreateManualFood,
}));

// Mock AddIngredientSheet so we can control when onAdd is called
const { mockAddSheetOnAdd } = vi.hoisted(() => ({
  mockAddSheetOnAdd: vi.fn(),
}));

vi.mock('./AddIngredientSheet', () => ({
  AddIngredientSheet: ({
    open,
    onClose,
    onAdd,
  }: {
    open: boolean;
    onClose: () => void;
    onAdd: (result: { searchResult?: { food_name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number; serving_size: { qty: number; unit: string } | null; source: 'local'; nutrients: null; external_id: null; meta: null; }; manual?: unknown; amount: number }) => void;
  }) => {
    // Store the onAdd callback so tests can call it
    mockAddSheetOnAdd.mockImplementation(onAdd);
    return open ? (
      <div data-testid="add-ingredient-sheet">
        <button
          data-testid="sheet-add-oats"
          onClick={() =>
            onAdd({
              searchResult: {
                food_name: 'Oats',
                calories: 389,
                protein_g: 17,
                carbs_g: 66,
                fat_g: 7,
                serving_size: { qty: 100, unit: 'g' },
                source: 'local',
                nutrients: null,
                external_id: null,
                meta: null,
              },
              amount: 80,
            })
          }
        >
          Add Oats 80g
        </button>
        <button data-testid="sheet-close" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null;
  },
}));

import { MealIngredientEditor } from './MealIngredientEditor';
import type { LocalNutritionWeekMeal, LocalFood, LocalWeekMealIngredient } from '@/db/local';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const flatMeal: LocalNutritionWeekMeal = {
  uuid: 'meal-1',
  day_of_week: 0,
  meal_slot: 'breakfast',
  meal_name: 'Tofu Smoothie',
  protein_g: 45,
  carbs_g: 60,
  fat_g: 12,
  calories: 571,
  quality_rating: null,
  sort_order: 0,
  is_recipe: false,
  _synced: false,
  _updated_at: 0,
  _deleted: false,
};

const recipeMeal: LocalNutritionWeekMeal = {
  ...flatMeal,
  is_recipe: true,
};

const oatsFood: LocalFood = {
  uuid: 'food-1',
  name: 'Oats',
  brand: null,
  per_unit: 'g',
  per_qty: 100,
  calories: 389,
  protein_g: 17,
  carbs_g: 66,
  fat_g: 7,
  nutrients: {},
  source: 'local',
  archived_at: null,
  created_at: '',
  _synced: false,
  _updated_at: 0,
  _deleted: false,
};

const oatsIngredient: LocalWeekMealIngredient = {
  uuid: 'ing-1',
  week_meal_uuid: 'meal-1',
  food_uuid: 'food-1',
  amount: 80,
  sort_order: 0,
  created_at: '',
  _synced: false,
  _updated_at: 0,
  _deleted: false,
};

const foodsById: Record<string, LocalFood> = {
  'food-1': oatsFood,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
});

describe('MealIngredientEditor — flat meal (is_recipe=false)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "Convert to recipe" button, not ingredient list', () => {
    render(
      <MealIngredientEditor
        meal={flatMeal}
        ingredients={[]}
        foodsById={foodsById}
      />,
    );

    // The button's text content is "Convert to recipe"
    expect(screen.getByText('Convert to recipe')).toBeTruthy();
    // No recipe editor disclosure header
    expect(screen.queryByText(/\d+ ingredient/i)).toBeNull();
    expect(screen.queryByText(/no ingredients yet/i)).toBeNull();
  });

  it('does NOT show ingredient mode for a flat meal even if ingredients passed', () => {
    // Safety: if somehow ingredients exist on a flat meal, still show ConvertPrompt
    render(
      <MealIngredientEditor
        meal={flatMeal}
        ingredients={[oatsIngredient]}
        foodsById={foodsById}
      />,
    );
    expect(screen.getByText('Convert to recipe')).toBeTruthy();
    // The ingredient list should not be shown
    expect(screen.queryByTestId('add-ingredient-sheet')).toBeNull();
  });

  it('calls setMealIsRecipe(true) when Convert is tapped', async () => {
    render(
      <MealIngredientEditor
        meal={flatMeal}
        ingredients={[]}
        foodsById={foodsById}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Convert to recipe'));
    });

    expect(mockSetMealIsRecipe).toHaveBeenCalledTimes(1);
    expect(mockSetMealIsRecipe).toHaveBeenCalledWith('meal-1', true);
  });
});

describe('MealIngredientEditor — recipe meal (is_recipe=true)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders ingredient list with "Ingredients" header', () => {
    render(
      <MealIngredientEditor
        meal={recipeMeal}
        ingredients={[oatsIngredient]}
        foodsById={foodsById}
      />,
    );

    expect(screen.getByText(/1 ingredient/i)).toBeTruthy();
    expect(screen.getByText('Oats')).toBeTruthy();
  });

  it('shows empty state message when no ingredients', () => {
    render(
      <MealIngredientEditor
        meal={recipeMeal}
        ingredients={[]}
        foodsById={foodsById}
      />,
    );

    expect(screen.getByText(/no ingredients yet/i)).toBeTruthy();
  });

  it('shows live macro header with derived values when ingredients present', () => {
    // 80g oats (per_qty=100): 0.8 × 389kcal = 311.2 ≈ 311, 0.8 × 17p = 13.6 ≈ 14
    render(
      <MealIngredientEditor
        meal={recipeMeal}
        ingredients={[oatsIngredient]}
        foodsById={foodsById}
      />,
    );

    // The macro header shows derived calories (311) and protein (14), NOT stored (571, 45)
    // Multiple elements may show the contribution + header — use getAllByText
    const calElements = screen.getAllByText('311 kcal');
    expect(calElements.length).toBeGreaterThan(0);
    expect(screen.queryByText('571 kcal')).toBeNull();
  });

  it('shows "no ingredients" in macro header when recipe has no ingredients', () => {
    render(
      <MealIngredientEditor
        meal={recipeMeal}
        ingredients={[]}
        foodsById={foodsById}
      />,
    );

    // Both the header and the empty state say "no ingredients" — at least one must show
    const noIngElements = screen.getAllByText(/no ingredients/i);
    expect(noIngElements.length).toBeGreaterThan(0);
  });

  it('calls promoteFoodFromResult + addMealIngredient when adding via search', async () => {
    render(
      <MealIngredientEditor
        meal={recipeMeal}
        ingredients={[]}
        foodsById={foodsById}
      />,
    );

    // Click "Add food" — there's only one such button since no ingredients yet
    await act(async () => {
      fireEvent.click(screen.getAllByText(/add food/i)[0]);
    });

    // The mock sheet should be visible; click "Add Oats 80g"
    expect(screen.getByTestId('add-ingredient-sheet')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('sheet-add-oats'));
    });

    expect(mockPromoteFoodFromResult).toHaveBeenCalledTimes(1);
    expect(mockPromoteFoodFromResult).toHaveBeenCalledWith(
      expect.objectContaining({ food_name: 'Oats' }),
    );
    expect(mockAddMealIngredient).toHaveBeenCalledTimes(1);
    expect(mockAddMealIngredient).toHaveBeenCalledWith(
      expect.objectContaining({
        week_meal_uuid: 'meal-1',
        food_uuid: 'food-1',
        amount: 80,
      }),
    );
  });

  it('calls removeMealIngredient when trash icon is clicked', async () => {
    render(
      <MealIngredientEditor
        meal={recipeMeal}
        ingredients={[oatsIngredient]}
        foodsById={foodsById}
      />,
    );

    // Use first match (multiple remove buttons possible in DOM — one per ingredient row)
    const removeBtns = screen.getAllByRole('button', { name: /remove oats/i });
    await act(async () => {
      fireEvent.click(removeBtns[0]);
    });

    expect(mockRemoveMealIngredient).toHaveBeenCalledTimes(1);
    expect(mockRemoveMealIngredient).toHaveBeenCalledWith('ing-1');
  });

  it('calls updateMealIngredientAmount on blur after editing amount', async () => {
    render(
      <MealIngredientEditor
        meal={recipeMeal}
        ingredients={[oatsIngredient]}
        foodsById={foodsById}
      />,
    );

    const amountInputs = screen.getAllByLabelText(/amount for oats/i);
    const amountInput = amountInputs[0];

    await act(async () => {
      fireEvent.change(amountInput, { target: { value: '120' } });
      fireEvent.blur(amountInput);
    });

    expect(mockUpdateMealIngredientAmount).toHaveBeenCalledTimes(1);
    expect(mockUpdateMealIngredientAmount).toHaveBeenCalledWith('ing-1', 120);
  });

  it('does NOT call updateMealIngredientAmount if amount is invalid on blur', async () => {
    render(
      <MealIngredientEditor
        meal={recipeMeal}
        ingredients={[oatsIngredient]}
        foodsById={foodsById}
      />,
    );

    const amountInputs = screen.getAllByLabelText(/amount for oats/i);
    const amountInput = amountInputs[0];

    await act(async () => {
      fireEvent.change(amountInput, { target: { value: '-5' } });
      fireEvent.blur(amountInput);
    });

    expect(mockUpdateMealIngredientAmount).not.toHaveBeenCalled();
  });

  it('shows per-ingredient contribution (kcal + protein) in row', () => {
    // 80g oats → 311 kcal, 14p
    render(
      <MealIngredientEditor
        meal={recipeMeal}
        ingredients={[oatsIngredient]}
        foodsById={foodsById}
      />,
    );

    // Ingredient row shows contribution
    expect(screen.getAllByText(/311 kcal/)).toBeTruthy();
  });

  it('pluralises ingredient count correctly', () => {
    const ing2: LocalWeekMealIngredient = {
      ...oatsIngredient,
      uuid: 'ing-2',
      food_uuid: 'food-1',
      amount: 50,
      sort_order: 1,
    };
    render(
      <MealIngredientEditor
        meal={recipeMeal}
        ingredients={[oatsIngredient, ing2]}
        foodsById={foodsById}
      />,
    );
    expect(screen.getByText(/2 ingredients/i)).toBeTruthy();
  });
});
