import { NextResponse } from 'next/server';
import { listPlans, createPlan } from '@/db/queries';

export async function GET() {
  const plans = await listPlans();
  return NextResponse.json({ plans });
}

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  const plan = await createPlan(body.title);
  return NextResponse.json(plan, { status: 201 });
}
