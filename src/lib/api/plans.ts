import type { WorkoutPlan, WorkoutRoutine } from '@/types';
import { fetchJson } from './client';

export type PlanWithRoutines = WorkoutPlan & { routines: WorkoutRoutine[] };

export async function fetchPlansWithRoutines(): Promise<PlanWithRoutines[]> {
  const data = await fetchJson<{ plans: PlanWithRoutines[] }>('/api/plans');
  return data.plans ?? [];
}
