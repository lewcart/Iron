import { NextRequest, NextResponse } from 'next/server';
import { listInspoPhotos, createInspoPhoto } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') ?? '50', 10);
  const photos = await listInspoPhotos(limit);
  return NextResponse.json(photos);
}

const VALID_POSES = ['front', 'side', 'back', 'other'] as const;
type ValidPose = (typeof VALID_POSES)[number];

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const body = await request.json();
  if (!body.blob_url) {
    return NextResponse.json({ error: 'blob_url is required' }, { status: 400 });
  }
  let pose: ValidPose | null = null;
  if (body.pose != null) {
    if (typeof body.pose !== 'string' || !VALID_POSES.includes(body.pose as ValidPose)) {
      return NextResponse.json(
        { error: `pose must be one of ${VALID_POSES.join(', ')} or null` },
        { status: 400 },
      );
    }
    pose = body.pose as ValidPose;
  }
  const cropOffsetY =
    typeof body.crop_offset_y === 'number' && body.crop_offset_y >= 0 && body.crop_offset_y <= 100
      ? body.crop_offset_y
      : null;
  const photo = await createInspoPhoto({
    blob_url: body.blob_url,
    notes: body.notes ?? null,
    taken_at: body.taken_at,
    burst_group_id: body.burst_group_id ?? null,
    pose,
    crop_offset_y: cropOffsetY,
  });
  return NextResponse.json(photo, { status: 201 });
}
