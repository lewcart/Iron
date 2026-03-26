import type { Exercise } from '@/types';
import { fetchJson } from './client';

export function fetchExerciseCatalog(): Promise<Exercise[]> {
  return fetchJson<Exercise[]>('/api/exercises');
}

export function fetchExercisesFiltered(params: {
  search?: string;
  muscleGroup?: string;
  equipment?: string;
}): Promise<Exercise[]> {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.muscleGroup) q.set('muscleGroup', params.muscleGroup);
  if (params.equipment) q.set('equipment', params.equipment);
  const suffix = q.toString();
  return fetchJson<Exercise[]>(suffix ? `/api/exercises?${suffix}` : '/api/exercises');
}
