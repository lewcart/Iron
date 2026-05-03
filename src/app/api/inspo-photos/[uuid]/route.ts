import { NextRequest, NextResponse } from 'next/server';
import { deleteInspoPhoto, updateInspoPhoto } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';
import { ALL_POSES, isInspoPose } from '@/lib/poses';
import type { InspoPhotoPose } from '@/types';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { uuid } = await params;
  await deleteInspoPhoto(uuid);
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

  const updates: { pose?: InspoPhotoPose | null; notes?: string | null; crop_offset_y?: number | null; crop_offset_x?: number | null } = {};
  if ('pose' in body) {
    if (body.pose === null) {
      updates.pose = null;
    } else if (isInspoPose(body.pose)) {
      updates.pose = body.pose;
    } else {
      return NextResponse.json(
        { error: `pose must be one of ${ALL_POSES.join(', ')} or null` },
        { status: 400 },
      );
    }
  }
  if ('notes' in body) {
    updates.notes = body.notes == null ? null : String(body.notes);
  }
  for (const axis of ['crop_offset_y', 'crop_offset_x'] as const) {
    if (axis in body) {
      const v = body[axis];
      if (v === null) {
        updates[axis] = null;
      } else if (typeof v === 'number' && v >= 0 && v <= 100) {
        updates[axis] = v;
      } else {
        return NextResponse.json(
          { error: `${axis} must be a number 0-100 or null` },
          { status: 400 },
        );
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }

  const photo = await updateInspoPhoto(uuid, updates);
  if (!photo) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(photo);
}
