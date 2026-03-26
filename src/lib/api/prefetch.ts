import type { QueryClient } from '@tanstack/react-query';
import { FEED_QUERY_DEFAULTS, fetchFeedBundle } from '@/lib/api/feed';
import { fetchExerciseCatalog } from '@/lib/api/exercises';
import { fetchPlansWithRoutines } from '@/lib/api/plans';
import { fetchWorkoutsList } from '@/lib/api/workouts-list';
import { queryKeys } from '@/lib/api/query-keys';

/** Prefetch main tab routes — call from TabBar (mount / hover). */
export function prefetchMainTabData(queryClient: QueryClient, href: string): void {
  switch (href) {
    case '/feed':
      void queryClient.prefetchQuery({
        queryKey: queryKeys.feed(FEED_QUERY_DEFAULTS.days, FEED_QUERY_DEFAULTS.timelineLimit),
        queryFn: () =>
          fetchFeedBundle(FEED_QUERY_DEFAULTS.days, FEED_QUERY_DEFAULTS.timelineLimit),
        staleTime: 45_000,
      });
      break;
    case '/history':
      void queryClient.prefetchQuery({
        queryKey: queryKeys.workouts({ limit: '50' }),
        queryFn: () => fetchWorkoutsList({ limit: '50' }),
        staleTime: 30_000,
      });
      break;
    case '/exercises':
      void queryClient.prefetchQuery({
        queryKey: queryKeys.exercises.catalog(),
        queryFn: fetchExerciseCatalog,
        staleTime: 15 * 60 * 1000,
      });
      break;
    case '/plans':
      void queryClient.prefetchQuery({
        queryKey: queryKeys.plans(),
        queryFn: fetchPlansWithRoutines,
        staleTime: 120_000,
      });
      break;
    default:
      break;
  }
}
