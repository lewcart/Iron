import { NextRequest, NextResponse } from 'next/server';
import { deleteInspoPhoto, updateInspoPhoto } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

const VALID_POSES = ['front', 'side', 'back', 'other'] as const;
type ValidPose = (typeof VALID_POSES)[number];

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

  const updates: { pose?: ValidPose | null; notes?: string | null } = {};
  if ('pose' in body) {
    if (body.pose === null) {
      updates.pose = null;
    } else if (typeof body.pose === 'string' && (VALID_POSES as readonly string[]).includes(body.pose)) {
      updates.pose = body.pose as ValidPose;
    } else {
      return NextResponse.json(
        { error: `pose must be one of ${VALID_POSES.join(', ')} or null` },
        { status: 400 },
      );
    }
  }
  if ('notes' in body) {
    updates.notes = body.notes == null ? null : String(body.notes);
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
