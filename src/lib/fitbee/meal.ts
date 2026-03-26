import type { MealType } from '@/types';

const MEAL_MAP: Record<string, MealType> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  snacks: 'snack',
  snack: 'snack',
  other: 'other',
};

export function normaliseFitbeeMeal(raw: string): MealType | null {
  const k = raw.trim().toLowerCase();
  return MEAL_MAP[k] ?? null;
}
