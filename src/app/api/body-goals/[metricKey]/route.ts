import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { upsertBodyGoal, deleteBodyGoal } from '@/db/queries';
import type { BodyGoalDirection } from '@/types';

const VALID_DIRECTIONS: readonly BodyGoalDirection[] = ['higher', 'lower', 'match'] as const;

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ metricKey: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const { metricKey } = await params;
  const body = await request.json();
  const target_value = parseFloat(body.target_value);
  const direction = body.direction as BodyGoalDirection;
  const unit = body.unit as string;
  if (!Number.isFinite(target_value)) {
    return NextResponse.json({ error: 'target_value must be numeric' }, { status: 400 });
  }
  if (!unit) {
    return NextResponse.json({ error: 'unit is required' }, { status: 400 });
  }
  if (!VALID_DIRECTIONS.includes(direction)) {
    return NextResponse.json({ error: 'direction must be one of higher|lower|match' }, { status: 400 });
  }
  const goal = await upsertBodyGoal(metricKey, {
    target_value,
    unit,
    direction,
    notes: body.notes ?? null,
  });
  return NextResponse.json(goal);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ metricKey: string }> },
) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const { metricKey } = await params;
  await deleteBodyGoal(metricKey);
  return new NextResponse(null, { status: 204 });
}
