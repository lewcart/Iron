import { NextResponse } from 'next/server';
import { getPlan, updatePlan, deletePlan, listRoutines } from '@/db/queries';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  const plan = await getPlan(uuid);
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  const routines = await listRoutines(uuid);
  return NextResponse.json({ ...plan, routines });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  const body = await request.json();
  if (!body.title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  const plan = await updatePlan(uuid, body.title);
  return NextResponse.json(plan);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  await deletePlan(uuid);
  return new NextResponse(null, { status: 204 });
}
