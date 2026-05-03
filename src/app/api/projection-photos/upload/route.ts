import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { requireApiKey } from '@/lib/api-auth';
import { randomUUID } from 'crypto';
import { ALL_POSES, isPose } from '@/lib/poses';

export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const poseRaw = (formData.get('pose') as string) || 'front';
  if (!isPose(poseRaw)) {
    return NextResponse.json(
      { error: `pose must be one of ${ALL_POSES.join(', ')}` },
      { status: 400 },
    );
  }
  const pose = poseRaw;

  if (!file) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  const ext = file.name.split('.').pop() ?? 'jpg';
  const pathname = `projection-photos/${randomUUID()}-${pose}.${ext}`;

  const blob = await put(pathname, file, { access: 'public' });

  return NextResponse.json({ url: blob.url });
}
