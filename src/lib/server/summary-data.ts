import {
  getWeekWorkouts,
  getWeekVolume,
  getWorkoutStreak,
  getWeekMuscleFrequency,
  getWeekSetsPerMuscle,
  getLastWorkoutsWithDetails,
  getOffsetWeekSessions,
} from '@/db/queries';
import { muscleStatus, type MuscleStatus } from '@/lib/muscles';
import { APP_TZ } from '@/lib/app-tz';
import type { SetsByMuscleRow } from '@/lib/api/feed-types';

/** Monday-of-this-week in `tz` as a YYYY-MM-DD string. Mirrors the SQL
 *  `date_trunc('week', NOW() AT TIME ZONE $tz)`. */
function localMondayIso(tz: string, now: Date): string {
  // `en-CA` formatter outputs YYYY-MM-DD; locale-aware to the IANA tz.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));
  const wd = get('weekday'); // Mon, Tue, ...
  const wkIdx: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const dow = wkIdx[wd] ?? 1;
  // Subtract (dow-1) days to get Monday — anchor a UTC date and subtract,
  // then format back. The civil date math is safe since we only add/sub days.
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() - (dow - 1));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function computeStreak(weekRows: { week_start: string }[], tz: string): number {
  if (weekRows.length === 0) return 0;

  const weekSet = new Set(weekRows.map(r => String(r.week_start).slice(0, 10)));
  let streak = 0;
  let cursor = localMondayIso(tz, new Date());

  while (weekSet.has(cursor)) {
    streak++;
    // Move cursor back 7 days (UTC-safe arithmetic).
    const [y, m, d] = cursor.split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d));
    utc.setUTCDate(utc.getUTCDate() - 7);
    const yy = utc.getUTCFullYear();
    const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(utc.getUTCDate()).padStart(2, '0');
    cursor = `${yy}-${mm}-${dd}`;
  }

  return streak;
}

function aggregateMuscleFrequency(rows: { primary_muscles: string[] | string }[]): Record<string, number> {
  const freq: Record<string, number> = {};
  for (const row of rows) {
    const muscles = Array.isArray(row.primary_muscles)
      ? row.primary_muscles
      : JSON.parse((row.primary_muscles as string) || '[]');
    for (const muscle of muscles) {
      const key = String(muscle).toLowerCase();
      freq[key] = (freq[key] ?? 0) + 1;
    }
  }
  return freq;
}

export interface SummaryPayload {
  weekWorkouts: number;
  weekVolume: number;
  currentStreak: number;
  lastWorkouts: {
    uuid: string;
    start_time: string;
    end_time: string | null;
    title: string | null;
    exercises: string[];
    volume: number;
  }[];
  /** @deprecated Use setsByMuscle. Kept for one release while UI migrates. */
  muscleFrequency: Record<string, number>;
  setsByMuscle: SetsByMuscleRow[];
  /** Selected week (YYYY-MM-DD Monday) — anchored in the user's TZ. Sent
   *  back so the client can label the week-picker without re-deriving. */
  weekStart: string;
  /** End of the selected week (Sunday inclusive, YYYY-MM-DD). */
  weekEnd: string;
  /** Offset relative to the current local week. 0 = this week, -1 = last. */
  weekOffset: number;
  /** Distinct strength sessions in the selected week — used to compute the
   *  frequency-bound MRV for the priority-muscles tile. */
  weekSessions: number;
}

export interface SummaryDataOpts {
  /** IANA TZ name (e.g. `Europe/London`, `Australia/Sydney`). Used to
   *  compute the "this week" Monday boundary. Defaults to APP_TZ. */
  tz?: string;
  /** 0=current local week, -1=last, etc. */
  weekOffset?: number;
}

export async function getSummaryData(opts: SummaryDataOpts = {}): Promise<SummaryPayload> {
  const tz = opts.tz ?? APP_TZ;
  const weekOffset = opts.weekOffset ?? 0;

  const [weekWorkoutsRows, weekVolume, streakRows, muscleRows, setsRows, lastWorkouts, offsetSessions] = await Promise.all([
    getWeekWorkouts(tz),
    getWeekVolume(tz),
    getWorkoutStreak(tz),
    getWeekMuscleFrequency(tz),
    getWeekSetsPerMuscle(weekOffset, tz),
    getLastWorkoutsWithDetails(3),
    getOffsetWeekSessions(weekOffset, tz),
  ]);

  const currentStreak = computeStreak(streakRows, tz);
  const muscleFrequency = aggregateMuscleFrequency(muscleRows);

  const setsByMuscle: SetsByMuscleRow[] = setsRows.map(r => ({
    slug: r.slug,
    display_name: r.display_name,
    parent_group: r.parent_group,
    set_count: r.set_count,
    effective_set_count: r.effective_set_count,
    optimal_min: r.optimal_sets_min,
    optimal_max: r.optimal_sets_max,
    display_order: r.display_order,
    status: muscleStatus(r.set_count, r.optimal_sets_min, r.optimal_sets_max) as MuscleStatus,
    coverage: r.coverage,
    kg_volume: r.kg_volume,
  }));

  return {
    weekWorkouts: weekWorkoutsRows.length,
    weekVolume,
    currentStreak,
    lastWorkouts,
    muscleFrequency,
    setsByMuscle,
    weekStart: offsetSessions.week_start,
    weekEnd: offsetSessions.week_end,
    weekOffset,
    weekSessions: offsetSessions.session_count,
  };
}
