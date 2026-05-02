import { NextRequest, NextResponse } from 'next/server';
import { listProjectionPhotos, createProjectionPhoto } from '@/db/queries';
import { requireApiKey } from '@/lib/api-auth';

const VALID_POSES = ['front', 'side', 'back'] as const;
type ValidPose = (typeof VALID_POSES)[number];

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') ?? '50', 10);
  const poseParam = searchParams.get('pose');
  const pose = poseParam && (VALID_POSES as readonly string[]).includes(poseParam)
    ? (poseParam as ValidPose)
    : undefined;
  const photos = await listProjectionPhotos({ pose, limit });
  return NextResponse.json(photos);
}

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const body = await request.json();
  if (!body.blob_url || !body.pose) {
    return NextResponse.json({ error: 'blob_url and pose are required' }, { status: 400 });
  }
  if (!(VALID_POSES as readonly string[]).includes(body.pose)) {
    return NextResponse.json(
      { error: `pose must be one of ${VALID_POSES.join(', ')}` },
      { status: 400 },
    );
  }
  const cropOffsetY =
    typeof body.crop_offset_y === 'number' && body.crop_offset_y >= 0 && body.crop_offset_y <= 100
      ? body.crop_offset_y
      : null;
  const photo = await createProjectionPhoto({
    blob_url: body.blob_url,
    pose: body.pose,
    notes: body.notes ?? null,
    taken_at: body.taken_at,
    source_progress_photo_uuid: body.source_progress_photo_uuid ?? null,
    target_horizon: body.target_horizon ?? null,
    crop_offset_y: cropOffsetY,
  });
  return NextResponse.json(photo, { status: 201 });
}
