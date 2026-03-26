import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { listClothesTestLogs, createClothesTestLog } from '@/db/queries';

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') ?? '50', 10);
  const logs = await listClothesTestLogs(limit);
  return NextResponse.json(logs);
}

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const body = await request.json();
  if (!body.outfit_description) {
    return NextResponse.json({ error: 'outfit_description is required' }, { status: 400 });
  }
  const log = await createClothesTestLog({
    logged_at: body.logged_at,
    outfit_description: body.outfit_description,
    photo_url: body.photo_url ?? null,
    comfort_rating: body.comfort_rating != null ? parseInt(body.comfort_rating, 10) : null,
    euphoria_rating: body.euphoria_rating != null ? parseInt(body.euphoria_rating, 10) : null,
    notes: body.notes ?? null,
  });
  return NextResponse.json(log, { status: 201 });
}
