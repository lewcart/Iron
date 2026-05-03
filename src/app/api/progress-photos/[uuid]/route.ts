import { NextRequest, NextResponse } from 'next/server';
import { deleteProgressPhoto, updateProgressPhoto } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { uuid } = await params;
  await deleteProgressPhoto(uuid);
  return new NextResponse(null, { status: 204 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { uuid } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }

  const updates: { crop_offset_y?: number | null; notes?: string | null; pose?: 'front' | 'side' | 'back' } = {};
  if ('crop_offset_y' in body) {
    if (body.crop_offset_y === null) {
      updates.crop_offset_y = null;
    } else if (typeof body.crop_offset_y === 'number' && body.crop_offset_y >= 0 && body.crop_offset_y <= 100) {
      updates.crop_offset_y = body.crop_offset_y;
    } else {
      return NextResponse.json(
        { error: 'crop_offset_y must be a number 0-100 or null' },
        { status: 400 },
      );
    }
  }
  if ('notes' in body) {
    updates.notes = body.notes == null ? null : String(body.notes);
  }
  if ('pose' in body) {
    if (body.pose !== 'front' && body.pose !== 'side' && body.pose !== 'back') {
      return NextResponse.json(
        { error: 'pose must be one of front, side, back' },
        { status: 400 },
      );
    }
    updates.pose = body.pose;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }

  const photo = await updateProgressPhoto(uuid, updates);
  if (!photo) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(photo);
}
