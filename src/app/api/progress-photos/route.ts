import { NextRequest, NextResponse } from 'next/server';
import { listProgressPhotos, createProgressPhoto } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') ?? '50', 10);
  const photos = await listProgressPhotos(limit);
  return NextResponse.json(photos);
}

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const body = await request.json();
  if (!body.blob_url || !body.pose) {
    return NextResponse.json({ error: 'blob_url and pose are required' }, { status: 400 });
  }
  const photo = await createProgressPhoto({
    blob_url: body.blob_url,
    pose: body.pose,
    notes: body.notes ?? null,
    taken_at: body.taken_at,
  });
  return NextResponse.json(photo, { status: 201 });
}
