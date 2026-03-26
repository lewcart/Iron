import type { FeedBundle } from './feed-types';
import { fetchJson } from './client';

export type { FeedBundle, StatsData, SummaryData, TimelineEntry, TimelineModule } from './feed-types';

/** Default feed query params — keep in sync with prefetch (`TabBar`) and `queryKeys.feed`. */
export const FEED_QUERY_DEFAULTS = { days: 30, timelineLimit: 20 } as const;

export function fetchFeedBundle(
  days = FEED_QUERY_DEFAULTS.days,
  timelineLimit = FEED_QUERY_DEFAULTS.timelineLimit
): Promise<FeedBundle> {
  const q = new URLSearchParams({
    days: String(days),
    limit: String(timelineLimit),
  });
  return fetchJson<FeedBundle>(`/api/feed?${q}`);
}
