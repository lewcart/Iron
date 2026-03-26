/**
 * TanStack Query key conventions — keep stable tuples for invalidation.
 * - User-specific data: add user id to keys when auth lands.
 */
export const queryKeys = {
  feed: (days: number, timelineLimit: number) =>
    ['feed', { days, timelineLimit }] as const,

  stats: () => ['stats'] as const,
  statsSummary: () => ['statsSummary'] as const,
  timeline: (days: number, limit: number) => ['timeline', { days, limit }] as const,

  exercises: {
    /** Full catalog (no filters) — long staleTime */
    catalog: () => ['exercises', 'catalog'] as const,
    /** Server-filtered list */
    list: (params: { search?: string; muscleGroup?: string; equipment?: string }) =>
      ['exercises', 'list', params.search ?? '', params.muscleGroup ?? '', params.equipment ?? ''] as const,
  },

  plans: () => ['plans'] as const,
  plan: (uuid: string) => ['plans', uuid] as const,
  planRoutineExercises: (planUuid: string, routineUuid: string) =>
    ['planRoutineExercises', planUuid, routineUuid] as const,

  workouts: (params: { limit?: string; from?: string; to?: string; exerciseUuid?: string }) =>
    [
      'workouts',
      params.limit ?? '50',
      params.from ?? '',
      params.to ?? '',
      params.exerciseUuid ?? '',
    ] as const,

  nutrition: {
    weekTemplatesForDay: (dow: number) => ['nutrition', 'weekTemplates', dow] as const,
    logsRange: (from: string, to: string) => ['nutrition', 'logs', from, to] as const,
    dayNote: (date: string) => ['nutrition', 'dayNote', date] as const,
    weekAll: () => ['nutrition', 'weekAll'] as const,
    dayBundle: (date: string) => ['nutrition', 'dayBundle', date] as const,
  },
} as const;
