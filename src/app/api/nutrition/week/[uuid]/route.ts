import { NextRequest, NextResponse } from 'next/server';
import { updateNutritionWeekMeal, deleteNutritionWeekMeal } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { uuid } = await params;
  const body = await request.json();
  const meal = await updateNutritionWeekMeal(uuid, body);
  if (!meal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(meal);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { uuid } = await params;
  await deleteNutritionWeekMeal(uuid);
  return new NextResponse(null, { status: 204 });
}
