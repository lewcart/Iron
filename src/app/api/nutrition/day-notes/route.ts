import { NextRequest, NextResponse } from 'next/server';
import { getNutritionDayNote, upsertNutritionDayNote } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  if (!date) return NextResponse.json({ error: 'date query param required (YYYY-MM-DD)' }, { status: 400 });
  const note = await getNutritionDayNote(date);
  if (!note) return NextResponse.json(null);
  return NextResponse.json(note);
}

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const body = await request.json();
  if (!body.date) return NextResponse.json({ error: 'date is required (YYYY-MM-DD)' }, { status: 400 });
  const note = await upsertNutritionDayNote(body.date, {
    hydration_ml: body.hydration_ml != null ? parseInt(body.hydration_ml, 10) : undefined,
    notes: body.notes ?? undefined,
  });
  return NextResponse.json(note, { status: 201 });
}
