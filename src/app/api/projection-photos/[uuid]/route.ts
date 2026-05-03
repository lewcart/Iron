import { NextRequest, NextResponse } from 'next/server';
import { deleteProjectionPhoto, updateProjectionPhoto } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';
import { isPose, ALL_POSES } from '@/lib/poses';
import type { ProgressPhotoPose } from '@/types';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { uuid } = await params;
  await deleteProjectionPhoto(uuid);
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

  const updates: {
    crop_offset_y?: number | null;
    notes?: string | null;
    target_horizon?: string | null;
    pose?: ProgressPhotoPose;
  } = {};
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
  if ('target_horizon' in body) {
    updates.target_horizon = body.target_horizon == null ? null : String(body.target_horizon);
  }
  if ('pose' in body) {
    if (!isPose(body.pose)) {
      return NextResponse.json(
        { error: `pose must be one of ${ALL_POSES.join(', ')}` },
        { status: 400 },
      );
    }
    updates.pose = body.pose;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }

  const photo = await updateProjectionPhoto(uuid, updates);
  if (!photo) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(photo);
}
