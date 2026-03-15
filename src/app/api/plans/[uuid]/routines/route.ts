import { NextResponse } from 'next/server';
import { createRoutine } from '@/db/queries';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  const body = await request.json();
  if (!body.title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  const routine = await createRoutine(uuid, body.title);
  return NextResponse.json(routine, { status: 201 });
}
