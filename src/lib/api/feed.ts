import type { FeedBundle } from './feed-types';
import { fetchJson } from './client';

export type { FeedBundle, StatsData, SummaryData, TimelineEntry, TimelineModule } from './feed-types';

/** Default feed query params — keep in sync with prefetch (`TabBar`) and `queryKeys.feed`. */
export const FEED_QUERY_DEFAULTS = { days: 30, timelineLimit: 20 } as const;

/** Browser-local IANA TZ. Server uses this to anchor "this week" so the
 *  Monday boundary doesn't drift to UTC. Falls back to APP_TZ server-side
 *  when unset (e.g. SSR / older clients). */
function browserTz(): string | null {
  if (typeof Intl === 'undefined') return null;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export interface FetchFeedBundleOpts {
  days?: number;
  timelineLimit?: number;
  /** 0 (default) = this week, -1 = last week, ... */
  weekOffset?: number;
  /** IANA TZ override; defaults to the browser's resolved TZ. */
  tz?: string;
}

export function fetchFeedBundle(
  daysOrOpts: number | FetchFeedBundleOpts = FEED_QUERY_DEFAULTS.days,
  timelineLimit = FEED_QUERY_DEFAULTS.timelineLimit
): Promise<FeedBundle> {
  // Back-compat overload: positional `(days, limit)` still works.
  const opts: FetchFeedBundleOpts = typeof daysOrOpts === 'number'
    ? { days: daysOrOpts, timelineLimit }
    : daysOrOpts;
  const days = opts.days ?? FEED_QUERY_DEFAULTS.days;
  const limit = opts.timelineLimit ?? FEED_QUERY_DEFAULTS.timelineLimit;
  const tz = opts.tz ?? browserTz();
  const params: Record<string, string> = {
    days: String(days),
    limit: String(limit),
  };
  if (opts.weekOffset != null && opts.weekOffset !== 0) {
    params.week_offset = String(opts.weekOffset);
  }
  if (tz) params.tz = tz;
  const q = new URLSearchParams(params);
  return fetchJson<FeedBundle>(`/api/feed?${q}`);
}
