import type { Workout } from '@/types';
import type { WorkoutSummary } from '@/app/history/utils';
import { fetchJson } from './client';

export async function fetchWorkoutsList(params: {
  limit?: string;
  from?: string;
  to?: string;
  exerciseUuid?: string;
}): Promise<WorkoutSummary[]> {
  const q = new URLSearchParams({ limit: params.limit ?? '50' });
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.exerciseUuid) q.set('exerciseUuid', params.exerciseUuid);
  return fetchJson<WorkoutSummary[]>(`/api/workouts?${q}`);
}

export function fetchWorkoutDetail(uuid: string): Promise<Workout> {
  return fetchJson<Workout>(`/api/workouts/${uuid}`);
}
