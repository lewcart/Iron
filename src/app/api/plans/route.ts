import { NextRequest, NextResponse } from 'next/server';
import { listPlans, listRoutines, createPlan } from '@/db/queries';

export async function GET() {
  try {
    const plans = await listPlans();
    const plansWithRoutines = await Promise.all(
      plans.map(async (plan) => {
        const routines = await listRoutines(plan.uuid);
        return { ...plan, routines };
      })
    );
    return NextResponse.json({ plans: plansWithRoutines });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }
    const plan = await createPlan(body.title);
    return NextResponse.json(plan, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
