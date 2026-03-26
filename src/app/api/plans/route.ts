import { NextRequest, NextResponse } from 'next/server';
import { listPlans, listRoutines, listRoutineExercises, listRoutineSets, createPlan } from '@/db/queries';

export async function GET(request: NextRequest) {
  try {
    const full = request.nextUrl.searchParams.get('full') === '1';
    const plans = await listPlans();
    const plansWithRoutines = await Promise.all(
      plans.map(async (plan) => {
        const routines = await listRoutines(plan.uuid);
        if (!full) return { ...plan, routines };
        // Include exercises + sets for each routine (for local-first workout creation)
        const routinesWithExercises = await Promise.all(
          routines.map(async (routine) => {
            const exercises = await listRoutineExercises(routine.uuid);
            const exercisesWithSets = await Promise.all(
              exercises.map(async (ex) => ({
                ...ex,
                sets: await listRoutineSets(ex.uuid),
              }))
            );
            return { ...routine, exercises: exercisesWithSets };
          })
        );
        return { ...plan, routines: routinesWithExercises };
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
