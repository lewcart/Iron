import { NextRequest, NextResponse } from 'next/server';
import { listNutritionWeekMeals, createNutritionWeekMeal } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const dayParam = searchParams.get('day');
  const day_of_week = dayParam != null ? parseInt(dayParam, 10) : undefined;
  const meals = await listNutritionWeekMeals(day_of_week);
  return NextResponse.json(meals);
}

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const body = await request.json();
  if (body.day_of_week == null || !body.meal_name) {
    return NextResponse.json({ error: 'day_of_week and meal_name are required' }, { status: 400 });
  }
  const meal = await createNutritionWeekMeal({
    day_of_week: parseInt(body.day_of_week, 10),
    meal_slot: body.meal_slot ?? '',
    meal_name: body.meal_name,
    protein_g: body.protein_g != null ? parseFloat(body.protein_g) : null,
    calories: body.calories != null ? parseFloat(body.calories) : null,
    quality_rating: body.quality_rating != null ? parseInt(body.quality_rating, 10) : null,
    sort_order: body.sort_order != null ? parseInt(body.sort_order, 10) : 0,
  });
  return NextResponse.json(meal, { status: 201 });
}
