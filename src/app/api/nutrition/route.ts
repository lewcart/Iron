import { NextRequest, NextResponse } from 'next/server';
import { listNutritionLogs, createNutritionLog } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') ?? '90', 10);
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const logs = await listNutritionLogs({ limit, from, to });
  return NextResponse.json(logs);
}

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const body = await request.json();
  const log = await createNutritionLog({
    logged_at: body.logged_at,
    meal_type: body.meal_type ?? null,
    calories: body.calories != null ? parseFloat(body.calories) : null,
    protein_g: body.protein_g != null ? parseFloat(body.protein_g) : null,
    carbs_g: body.carbs_g != null ? parseFloat(body.carbs_g) : null,
    fat_g: body.fat_g != null ? parseFloat(body.fat_g) : null,
    notes: body.notes ?? null,
    meal_name: body.meal_name ?? null,
    template_meal_id: body.template_meal_id ?? null,
    status: body.status ?? null,
  });
  return NextResponse.json(log, { status: 201 });
}
