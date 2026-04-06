import type { Exercise } from '@/types';
import { fetchJson } from './client';
import { rebirthJsonHeaders } from './headers';

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

export function createExercise(data: {
  title: string;
  primary_muscles: string[];
  secondary_muscles?: string[];
  equipment?: string[];
  movement_pattern?: string;
  description?: string;
}): Promise<Exercise> {
  return fetchJson<Exercise>('/api/exercises', {
    method: 'POST',
    headers: rebirthJsonHeaders(),
    body: JSON.stringify(data),
  });
}
