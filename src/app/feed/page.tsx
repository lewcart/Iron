'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { Settings, Target, Moon, Camera } from 'lucide-react';

import { db } from '@/db/local';
import { queryKeys } from '@/lib/api/query-keys';
import { fetchFeedBundle, FEED_QUERY_DEFAULTS } from '@/lib/api/feed';
import { fetchJsonAuthed, ApiError } from '@/lib/api/client';
import { useActiveVision } from '@/lib/useLocalDB-strategy';

import {
  emptyWeekFacts,
  isoDayOfWeek,
  isoWeekStart,
  type WeekFacts,
  type WeekFactsAnchorSetInput,
} from '@/lib/api/week-facts';
import { resolveWeekTiles, type WeekTile } from '@/lib/api/resolveWeekTiles';
import {
  ANCHOR_LIFTS,
  resolveAnchorLift,
  type ExerciseLogSignal,
} from '@/lib/training/anchor-lifts';

import { PriorityMusclesTile } from '@/components/week/PriorityMusclesTile';
import { EffectiveSetQualityTile } from '@/components/week/EffectiveSetQualityTile';
import { AnchorLiftTrendTile } from '@/components/week/AnchorLiftTrendTile';
import { RecoveryTile } from '@/components/week/RecoveryTile';
import { WeightEwmaTile } from '@/components/week/WeightEwmaTile';
import { TileEmptyState } from '@/components/week/TileEmptyState';
import {
  TwelveWeekTrendsSection,
  type TwelveWeekTrendsData,
} from '@/components/week/TwelveWeekTrendsSection';
// v1.1 surfaces
import { CardioComplianceTile, type CardioTileResponse } from '@/components/week/CardioComplianceTile';
import { PrescriptionCard } from '@/components/week/PrescriptionCard';
import { PhotoCadenceFooter } from '@/components/week/PhotoCadenceFooter';
import { prescriptionsFor, type PrescriptionMuscleFact } from '@/lib/training/prescription-engine';
import { deriveHrtContext, type HrtTimelinePeriodInput } from '@/lib/training/hrt-context';
import { photoCadenceState } from '@/lib/training/photo-cadence';
import { computeEwma } from '@/lib/training/ewma';
import { estimate1RM } from '@/lib/pr';
import { resolveMuscleSlug, MUSCLE_DEFS, type MuscleSlug } from '@/lib/muscles';

const WEEK_MS = 7 * 86400000;
const ANCHOR_WINDOW_MS = 8 * WEEK_MS;
const TWELVE_WEEK_WINDOW_MS = 12 * WEEK_MS;
const BODYWEIGHT_WINDOW_MS = 90 * 86400000;
const HRV_WINDOW_DAYS = 28;
/** Priority muscles surfaced in trend (a). Canonical taxonomy slugs only. */
const TREND_PRIORITY_MUSCLES: MuscleSlug[] = ['glutes', 'lats', 'delts', 'chest'];

interface HealthSnapshotResponse {
  as_of: string;
  range: { start_date: string; end_date: string };
  hrv_daily: { date: string; value_avg: number }[];
  last_night_sleep: {
    date: string;
    asleep_min: number | null;
    in_bed_min: number | null;
  } | null;
}

function fetchHealthSnapshot(daysWindow = HRV_WINDOW_DAYS): Promise<HealthSnapshotResponse | { status: 'not_connected' }> {
  return fetchJsonAuthed<HealthSnapshotResponse>(
    `/api/health/snapshot?days=${daysWindow}`,
  ).catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 503) {
      return { status: 'not_connected' as const };
    }
    throw err;
  });
}

interface SleepSummaryResponse {
  averages?: { asleep_min: number } | null;
  hrv?: { window_avg: number | null; baseline_30d_avg: number | null; n_days: number } | null;
  range?: { n_nights: number };
}

function fetchSleepSummary(): Promise<SleepSummaryResponse | { status: 'not_connected' }> {
  return fetchJsonAuthed<SleepSummaryResponse>(
    `/api/health/sleep-summary?window_days=7&fields=averages,hrv,range`,
  ).catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 503) {
      return { status: 'not_connected' as const };
    }
    throw err;
  });
}

interface SleepBaselineResponse {
  averages?: { asleep_min: number } | null;
}

function fetchSleepBaseline(): Promise<SleepBaselineResponse | { status: 'not_connected' }> {
  return fetchJsonAuthed<SleepBaselineResponse>(
    `/api/health/sleep-summary?window_days=28&fields=averages`,
  ).catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 503) {
      return { status: 'not_connected' as const };
    }
    throw err;
  });
}

// v1.1: cardio compliance fetch for the new tile in slot 4.
function fetchCardioWeek(): Promise<CardioTileResponse> {
  return fetchJsonAuthed<CardioTileResponse>(`/api/health/cardio-week?window_days=7`).catch(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 503) {
        return { status: 'not_connected' as const, reason: 'unknown' };
      }
      throw err;
    },
  );
}

export default function WeekPage() {
  const queryClient = useQueryClient();

  // Week-picker state for the priority-muscles tile. 0 = this week,
  // -1 = last week, etc. Forward weeks are not allowed.
  // Only the priority-muscles tile re-fetches on offset change — every
  // other tile (RIR, anchor lifts, recovery, prescription) intentionally
  // stays anchored to the current week, otherwise PUSH/REDUCE/DELOAD
  // verdicts and 8-week trends would all jump too.
  const [weekOffset, setWeekOffset] = useState(0);

  const feedQueryKey = queryKeys.feed(FEED_QUERY_DEFAULTS.days, FEED_QUERY_DEFAULTS.timelineLimit, 0);

  // ── Server bundle (summary.setsByMuscle, lastWorkouts) — current week ─
  const { data: feedBundle, isPending: feedPending } = useQuery({
    queryKey: feedQueryKey,
    queryFn: () => fetchFeedBundle({
      days: FEED_QUERY_DEFAULTS.days,
      timelineLimit: FEED_QUERY_DEFAULTS.timelineLimit,
      weekOffset: 0,
    }),
    staleTime: 45_000,
    placeholderData: (prev) => prev,
  });

  // ── Picker-driven server bundle — only fetched when offset != 0 ──
  const offsetFeedQueryKey = queryKeys.feed(FEED_QUERY_DEFAULTS.days, FEED_QUERY_DEFAULTS.timelineLimit, weekOffset);
  const { data: offsetFeedBundle } = useQuery({
    queryKey: offsetFeedQueryKey,
    queryFn: () => fetchFeedBundle({
      days: FEED_QUERY_DEFAULTS.days,
      timelineLimit: FEED_QUERY_DEFAULTS.timelineLimit,
      weekOffset,
    }),
    staleTime: 45_000,
    placeholderData: (prev) => prev,
    enabled: weekOffset !== 0,
  });

  // The summary used for the priority-muscles tile: offset bundle if a
  // non-current week is selected, else the live `feedBundle`.
  const priorityWeekSummary = weekOffset === 0 ? feedBundle?.summary : offsetFeedBundle?.summary;

  // ── Health (HRV daily + last-night sleep) ─────────────────────────
  const { data: snapshot } = useQuery({
    queryKey: ['week', 'health-snapshot'],
    queryFn: () => fetchHealthSnapshot(HRV_WINDOW_DAYS),
    staleTime: 5 * 60_000,
  });

  const { data: sleep7 } = useQuery({
    queryKey: ['week', 'sleep-summary-7'],
    queryFn: fetchSleepSummary,
    staleTime: 5 * 60_000,
  });

  const { data: sleep28 } = useQuery({
    queryKey: ['week', 'sleep-summary-28'],
    queryFn: fetchSleepBaseline,
    staleTime: 5 * 60_000,
  });

  // ── v1.1 surfaces ────────────────────────────────────────────────────
  // Cardio compliance for the new tile (slot 4 between Recovery & Weight EWMA).
  const { data: cardioWeek } = useQuery({
    queryKey: ['week', 'cardio-week'],
    queryFn: fetchCardioWeek,
    staleTime: 5 * 60_000,
  });

  // HRT timeline periods — for the prescription engine's HrtContext (suppresses
  // e1RM-stagnation as DELOAD trigger when protocol changed in last 4 weeks).
  // `created_at` isn't on LocalHrtTimelinePeriod (only `_updated_at` from
  // SyncMeta); fall back to `_updated_at` for the tiebreak — fine for this
  // single-user app where overlapping periods at the same started_at are rare.
  const hrtPeriods = useLiveQuery(
    async () => {
      const all = await db.hrt_timeline_periods.filter(p => !p._deleted).toArray();
      return all.map<HrtTimelinePeriodInput>(p => ({
        uuid: p.uuid,
        name: p.name,
        started_at: p.started_at,
        ended_at: p.ended_at,
        // _updated_at is an epoch number on SyncMeta; convert to ISO for the
        // string-comparison tiebreak. Fall back to started_at for first-pull
        // rows where _updated_at hasn't been stamped yet.
        created_at: p._updated_at != null
          ? new Date(p._updated_at).toISOString()
          : `${p.started_at}T00:00:00Z`,
      }));
    },
    [],
    [] as HrtTimelinePeriodInput[],
  );

  // Latest front-pose progress photo — drives photo cadence footer.
  const latestFrontPhoto = useLiveQuery(
    async () => {
      const photos = await db.progress_photos
        .filter(p => !p._deleted && p.pose === 'front')
        .toArray();
      if (photos.length === 0) return null;
      photos.sort((a, b) => (b.taken_at ?? '').localeCompare(a.taken_at ?? ''));
      return photos[0]?.taken_at ?? null;
    },
    [],
    null,
  );

  // projection_photos isn't in the local-first sync set today, so we can't
  // detect front-pose projections from Dexie. v1.1 ships the secondary
  // "Compare projection" affordance dark; v1.2 follow-up: add projection_photos
  // to SYNCED_TABLES then enable a useLiveQuery here.
  const hasFrontProjection = false;

  // ── Vision (Dexie) ─────────────────────────────────────────────────
  const vision = useActiveVision();

  // ── Bodyweight (Dexie, last 90 days, ASC) ──────────────────────────
  const bodyweight = useLiveQuery(
    async () => {
      const cutoff = new Date(Date.now() - BODYWEIGHT_WINDOW_MS).toISOString();
      const all = await db.bodyweight_logs
        .filter(r => !r._deleted && r.logged_at >= cutoff)
        .toArray();
      all.sort((a, b) => a.logged_at.localeCompare(b.logged_at));
      return all;
    },
    [],
    [],
  );

  // ── Catalog of exercises (Dexie). Anchor-lift resolver scans this. ─
  // Includes muscle tags so the v1.1 muscle-tagging-first resolver can pick
  // the exercise Lou actually trains for each priority muscle.
  const catalog = useLiveQuery(
    async () => {
      const visible = await db.exercises.filter(ex => !ex.is_hidden).toArray();
      return visible.map(ex => ({
        uuid: ex.uuid,
        title: ex.title,
        alias: ex.alias,
        primary_muscles: ex.primary_muscles,
        secondary_muscles: ex.secondary_muscles,
      }));
    },
    [],
    [],
  );

  // ── Per-exercise log signals (Dexie, last 8 weeks) ─────────────────
  // Used by the v1.1 anchor-lift resolver to prefer exercises Lou actually
  // trains over name-matched ones. One signal row per exercise_uuid that
  // has at least one completed working set in the window.
  const exerciseLogSignals = useLiveQuery(
    async (): Promise<ExerciseLogSignal[]> => {
      const cutoff = new Date(Date.now() - ANCHOR_WINDOW_MS).toISOString();
      const [workouts, allWE] = await Promise.all([
        db.workouts.filter(w => !w._deleted && w.start_time >= cutoff).toArray(),
        db.workout_exercises.filter(e => !e._deleted).toArray(),
      ]);
      if (workouts.length === 0) return [];

      const workoutDates = new Map<string, string>();
      for (const w of workouts) workoutDates.set(w.uuid, w.start_time.slice(0, 10));

      const weInWindow = allWE.filter(we => workoutDates.has(we.workout_uuid));
      if (weInWindow.length === 0) return [];

      const weUuids = new Set(weInWindow.map(we => we.uuid));
      const sets = await db.workout_sets
        .filter(s => !s._deleted && s.is_completed && weUuids.has(s.workout_exercise_uuid))
        .toArray();

      type Acc = { sets: number; dates: Set<string>; latest: string };
      const acc = new Map<string, Acc>();
      const weByUuid = new Map(weInWindow.map(we => [we.uuid, we]));
      for (const s of sets) {
        const isWorking = (s.repetitions ?? 0) >= 1 || (s.duration_seconds ?? 0) > 0;
        if (!isWorking) continue;
        const we = weByUuid.get(s.workout_exercise_uuid);
        if (!we) continue;
        const date = workoutDates.get(we.workout_uuid);
        if (!date) continue;
        const exId = we.exercise_uuid;
        const cur = acc.get(exId) ?? { sets: 0, dates: new Set(), latest: '' };
        cur.sets += 1;
        cur.dates.add(date);
        if (date > cur.latest) cur.latest = date;
        acc.set(exId, cur);
      }
      return Array.from(acc.entries()).map(([exercise_uuid, a]) => ({
        exercise_uuid,
        session_count: a.dates.size,
        set_count: a.sets,
        last_workout_date: a.latest,
      }));
    },
    [],
    [],
  );

  // ── Anchor-lift sets (Dexie, last 8 weeks across all anchor lifts) ─
  // Returns the flat set list + a workout_exercise_uuid → date map. We
  // resolve each anchor lift via the muscle-tagging-first resolver (using
  // the log signals computed above), then pull all sets that reference any
  // of those UUIDs via the workout_exercises join.
  const anchorSets = useLiveQuery(
    async (): Promise<WeekFactsAnchorSetInput[]> => {
      if (!catalog || catalog.length === 0) return [];

      const signals = exerciseLogSignals ?? [];
      const anchorExerciseUuids = ANCHOR_LIFTS
        .map(cfg => resolveAnchorLift(cfg, catalog, signals))
        .filter((x): x is NonNullable<typeof x> => x != null)
        .map(x => x.uuid);

      if (anchorExerciseUuids.length === 0) return [];

      const cutoff = new Date(Date.now() - ANCHOR_WINDOW_MS).toISOString();
      const [workouts, allWorkoutExercises] = await Promise.all([
        db.workouts.filter(w => !w._deleted && w.start_time >= cutoff).toArray(),
        db.workout_exercises
          .filter(e => !e._deleted && anchorExerciseUuids.includes(e.exercise_uuid))
          .toArray(),
      ]);

      const workoutDates = new Map<string, string>();
      for (const w of workouts) workoutDates.set(w.uuid, w.start_time.slice(0, 10));

      // Filter workout_exercises to those whose workout is within window.
      const relevantWE = allWorkoutExercises.filter(we => workoutDates.has(we.workout_uuid));
      if (relevantWE.length === 0) return [];

      const weUuids = relevantWE.map(we => we.uuid);
      const sets = await db.workout_sets
        .filter(s => !s._deleted && weUuids.includes(s.workout_exercise_uuid))
        .toArray();

      const weByUuid = new Map(relevantWE.map(we => [we.uuid, we]));

      return sets.map(s => {
        const we = weByUuid.get(s.workout_exercise_uuid);
        const workoutDate = we ? workoutDates.get(we.workout_uuid) ?? '' : '';
        return {
          exercise_uuid: we?.exercise_uuid ?? '',
          workout_exercise_uuid: s.workout_exercise_uuid,
          is_completed: s.is_completed,
          weight: s.weight,
          repetitions: s.repetitions,
          rir: s.rir,
          workout_date: workoutDate,
        };
      });
    },
    [catalog, exerciseLogSignals],
    [],
  );

  // ── This-week working sets (Dexie) — for RIR quality + sessions count ─
  const weekSetSummary = useLiveQuery(
    async () => {
      const monday = new Date();
      monday.setHours(0, 0, 0, 0);
      const dow = monday.getDay();
      monday.setDate(monday.getDate() + (dow === 0 ? -6 : 1 - dow));
      const mondayIso = monday.toISOString();

      const workouts = await db.workouts
        .filter(w => !w._deleted && w.start_time >= mondayIso)
        .toArray();
      if (workouts.length === 0) {
        return { total_sets: 0, rir_logged_sets: 0, rir_quality_sets: 0, sessions: 0 };
      }
      const wUuids = new Set(workouts.map(w => w.uuid));
      const wes = await db.workout_exercises
        .filter(e => !e._deleted && wUuids.has(e.workout_uuid))
        .toArray();
      const weUuids = new Set(wes.map(we => we.uuid));
      const sets = await db.workout_sets
        .filter(s => !s._deleted && weUuids.has(s.workout_exercise_uuid))
        .toArray();

      let total = 0, logged = 0, quality = 0;
      for (const s of sets) {
        const isWorking = s.is_completed
          && (((s.repetitions ?? 0) >= 1) || ((s.duration_seconds ?? 0) > 0));
        if (!isWorking) continue;
        total++;
        if (s.rir != null) {
          logged++;
          if (s.rir <= 3) quality++;
        }
      }

      // Distinct strength sessions = workouts with at least 1 working set.
      const sessionUuids = new Set<string>();
      const weByUuid = new Map(wes.map(we => [we.uuid, we]));
      for (const s of sets) {
        if (!s.is_completed) continue;
        const we = weByUuid.get(s.workout_exercise_uuid);
        if (we) sessionUuids.add(we.workout_uuid);
      }

      return { total_sets: total, rir_logged_sets: logged, rir_quality_sets: quality, sessions: sessionUuids.size };
    },
    [],
    { total_sets: 0, rir_logged_sets: 0, rir_quality_sets: 0, sessions: 0 },
  );

  // ── Sessions in last 14 days (Dexie) — drives the RIR-quality wait gate.
  //   A session = a workout that has at least one completed working set.
  //   Below the threshold (RIR_WAIT_MIN_SESSIONS_14D in resolveWeekTiles)
  //   we suppress the RIR-quality empty-state nag entirely.
  const sessionsLast14d = useLiveQuery(
    async () => {
      const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
      const workouts = await db.workouts
        .filter(w => !w._deleted && w.start_time >= cutoff)
        .toArray();
      if (workouts.length === 0) return 0;
      const wUuids = new Set(workouts.map(w => w.uuid));
      const wes = await db.workout_exercises
        .filter(e => !e._deleted && wUuids.has(e.workout_uuid))
        .toArray();
      const weUuids = new Set(wes.map(we => we.uuid));
      const sets = await db.workout_sets
        .filter(s => !s._deleted && s.is_completed && weUuids.has(s.workout_exercise_uuid))
        .toArray();
      const weByUuid = new Map(wes.map(we => [we.uuid, we]));
      const sessionUuids = new Set<string>();
      for (const s of sets) {
        const we = weByUuid.get(s.workout_exercise_uuid);
        if (we) sessionUuids.add(we.workout_uuid);
      }
      return sessionUuids.size;
    },
    [],
    0,
  );

  // ── 8-week RIR quality history (Dexie) — for tile 2 sparkline. ────
  const rirByWeek = useLiveQuery(
    async () => {
      const now = new Date();
      const monday = new Date(now);
      monday.setHours(0, 0, 0, 0);
      const dow = monday.getDay();
      monday.setDate(monday.getDate() + (dow === 0 ? -6 : 1 - dow));

      const eightWeeksAgo = new Date(monday.getTime() - 7 * WEEK_MS);
      const cutoffIso = eightWeeksAgo.toISOString();

      const workouts = await db.workouts
        .filter(w => !w._deleted && w.start_time >= cutoffIso)
        .toArray();
      if (workouts.length === 0) return [];

      const wesByWorkout = new Map<string, string[]>();
      const allWE = await db.workout_exercises
        .filter(e => !e._deleted)
        .toArray();
      for (const e of allWE) {
        if (!wesByWorkout.has(e.workout_uuid)) wesByWorkout.set(e.workout_uuid, []);
        wesByWorkout.get(e.workout_uuid)!.push(e.uuid);
      }
      const weUuids = new Set<string>();
      for (const w of workouts) {
        for (const u of wesByWorkout.get(w.uuid) ?? []) weUuids.add(u);
      }
      const sets = await db.workout_sets
        .filter(s => !s._deleted && weUuids.has(s.workout_exercise_uuid))
        .toArray();

      // Bucket sets by their workout's ISO-week start.
      const weToWorkout = new Map<string, string>();
      for (const e of allWE) weToWorkout.set(e.uuid, e.workout_uuid);
      const workoutWeekStart = new Map<string, string>();
      for (const w of workouts) {
        workoutWeekStart.set(w.uuid, isoWeekStart(new Date(w.start_time)));
      }

      const byWeek = new Map<string, { logged: number; quality: number; total: number }>();
      for (const s of sets) {
        const isWorking = s.is_completed
          && (((s.repetitions ?? 0) >= 1) || ((s.duration_seconds ?? 0) > 0));
        if (!isWorking) continue;
        const wuuid = weToWorkout.get(s.workout_exercise_uuid);
        if (!wuuid) continue;
        const ws = workoutWeekStart.get(wuuid);
        if (!ws) continue;
        if (!byWeek.has(ws)) byWeek.set(ws, { logged: 0, quality: 0, total: 0 });
        const bucket = byWeek.get(ws)!;
        bucket.total++;
        if (s.rir != null) {
          bucket.logged++;
          if (s.rir <= 3) bucket.quality++;
        }
      }

      return Array.from(byWeek.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([week_start, b]) => ({
          week_start,
          quality_pct: b.logged > 0 ? Math.round((b.quality / b.logged) * 100) : 0,
          n_sets: b.total,
        }));
    },
    [],
    [],
  );

  // ── 12-week priority-muscle effective sets (Dexie) ─────────────────
  // For each priority muscle, return a vector of 12 weekly effective-set
  // counts (oldest → newest). Reuses the canonical muscle taxonomy (each
  // exercise tag is normalized via `resolveMuscleSlug`); credits both
  // primary and secondary tags fully (matches `get_sets_per_muscle`).
  const priorityMusclesByWeek = useLiveQuery(
    async () => {
      const now = new Date();
      const monday = new Date(now);
      monday.setHours(0, 0, 0, 0);
      const dow = monday.getDay();
      monday.setDate(monday.getDate() + (dow === 0 ? -6 : 1 - dow));
      const cutoff = new Date(monday.getTime() - 11 * WEEK_MS);
      const cutoffIso = cutoff.toISOString();

      const [workouts, exercises, allWE] = await Promise.all([
        db.workouts.filter(w => !w._deleted && w.start_time >= cutoffIso).toArray(),
        db.exercises.toArray(),
        db.workout_exercises.filter(e => !e._deleted).toArray(),
      ]);
      if (workouts.length === 0) return [];

      // Per-exercise muscle list with primary=1.0 / secondary-only=0.5 credit.
      // Mirrors getWeekSetsPerMuscle's RP/Helms convention. A muscle in BOTH
      // arrays gets primary's 1.0.
      const exerciseMuscles = new Map<string, { slug: MuscleSlug; credit: number }[]>();
      for (const ex of exercises) {
        const creditBySlug = new Map<MuscleSlug, number>();
        for (const v of ex.primary_muscles ?? []) {
          const slug = typeof v === 'string' ? resolveMuscleSlug(v) : null;
          if (slug) creditBySlug.set(slug, 1.0);
        }
        for (const v of ex.secondary_muscles ?? []) {
          const slug = typeof v === 'string' ? resolveMuscleSlug(v) : null;
          if (slug && !creditBySlug.has(slug)) creditBySlug.set(slug, 0.5);
        }
        exerciseMuscles.set(
          ex.uuid,
          [...creditBySlug.entries()].map(([slug, credit]) => ({ slug, credit })),
        );
      }
      const weByUuid = new Map(allWE.map(we => [we.uuid, we]));
      const wUuidByWE = new Map(allWE.map(we => [we.uuid, we.workout_uuid]));
      const workoutWeek = new Map<string, string>();
      for (const w of workouts) workoutWeek.set(w.uuid, isoWeekStart(new Date(w.start_time)));

      const wUuidSet = new Set(workouts.map(w => w.uuid));
      const sets = await db.workout_sets
        .filter(s => !s._deleted && s.is_completed)
        .toArray();

      // Build 12 buckets oldest → newest.
      const weekStarts: string[] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(monday.getTime() - i * WEEK_MS);
        weekStarts.push(isoWeekStart(d));
      }
      const idxByWeek = new Map(weekStarts.map((ws, i) => [ws, i]));

      const perMuscle = new Map<MuscleSlug, number[]>();
      for (const slug of TREND_PRIORITY_MUSCLES) {
        perMuscle.set(slug, new Array(12).fill(0));
      }

      for (const s of sets) {
        const isWorking = (s.repetitions ?? 0) >= 1 || (s.duration_seconds ?? 0) > 0;
        if (!isWorking) continue;
        const we = weByUuid.get(s.workout_exercise_uuid);
        if (!we) continue;
        const wUuid = wUuidByWE.get(we.uuid);
        if (!wUuid || !wUuidSet.has(wUuid)) continue;
        const ws = workoutWeek.get(wUuid);
        if (!ws) continue;
        const idx = idxByWeek.get(ws);
        if (idx == null) continue;

        const muscles = exerciseMuscles.get(we.exercise_uuid) ?? [];
        // Stimulus credit = primary/secondary credit × RIR credit.
        //   primary=1.0, secondary-only=0.5; RIR 0–3=1.0, RIR 4=0.5, RIR 5+=0.0, NULL=1.0.
        let rirCredit = 1.0;
        if (s.rir != null) {
          if (s.rir <= 3) rirCredit = 1.0;
          else if (s.rir === 4) rirCredit = 0.5;
          else rirCredit = 0.0;
        }
        if (rirCredit <= 0) continue;

        for (const m of muscles) {
          const arr = perMuscle.get(m.slug);
          if (arr) arr[idx] += m.credit * rirCredit;
        }
      }

      const result: { slug: MuscleSlug; display_name: string; weekly: number[] }[] = [];
      for (const slug of TREND_PRIORITY_MUSCLES) {
        const weekly = perMuscle.get(slug) ?? new Array(12).fill(0);
        // Drop a series if every week is zero — it'll just be a flat line.
        if (weekly.every(v => v === 0)) continue;
        result.push({
          slug,
          display_name: MUSCLE_DEFS[slug].display_name,
          weekly: weekly.map(v => Math.round(v * 10) / 10),
        });
      }
      return result;
    },
    [],
    [],
  );

  // ── 12-week anchor-lift e1RM trend (Dexie) ─────────────────────────
  // For each anchor lift that resolves to a catalog row, build a flat list
  // of session points (one per workout date) over the last 12 weeks. Uses
  // the same muscle-tagging-first resolver as the weekly tile so the trend
  // sparkline matches what the user sees in Section A.
  const anchorLiftsByWeek = useLiveQuery(
    async () => {
      if (!catalog || catalog.length === 0) return [];

      const signals = exerciseLogSignals ?? [];
      const resolved = ANCHOR_LIFTS
        .map(cfg => ({ cfg, exercise: resolveAnchorLift(cfg, catalog, signals) }))
        .filter(x => x.exercise != null);
      if (resolved.length === 0) return [];

      const cutoff = new Date(Date.now() - TWELVE_WEEK_WINDOW_MS).toISOString();
      const exerciseUuids = resolved.map(r => r.exercise!.uuid);
      const [workouts, allWE] = await Promise.all([
        db.workouts.filter(w => !w._deleted && w.start_time >= cutoff).toArray(),
        db.workout_exercises
          .filter(e => !e._deleted && exerciseUuids.includes(e.exercise_uuid))
          .toArray(),
      ]);
      const workoutDates = new Map<string, string>();
      for (const w of workouts) workoutDates.set(w.uuid, w.start_time.slice(0, 10));

      const weInWindow = allWE.filter(we => workoutDates.has(we.workout_uuid));
      if (weInWindow.length === 0) return [];

      const weUuids = new Set(weInWindow.map(we => we.uuid));
      const sets = await db.workout_sets
        .filter(s => !s._deleted && weUuids.has(s.workout_exercise_uuid))
        .toArray();

      const weByUuid = new Map(weInWindow.map(we => [we.uuid, we]));

      // For each anchor: best e1RM per workout date.
      const out: { display_name: string; sessions: { date: string; e1rm: number }[] }[] = [];
      for (const { cfg, exercise } of resolved) {
        const exUuid = exercise!.uuid;
        const bestPerDate = new Map<string, number>();
        for (const s of sets) {
          if (!s.is_completed) continue;
          const we = weByUuid.get(s.workout_exercise_uuid);
          if (!we || we.exercise_uuid !== exUuid) continue;
          const reps = s.repetitions ?? 0;
          const weight = s.weight ?? 0;
          if (reps < 1 || weight <= 0) continue;
          const date = workoutDates.get(we.workout_uuid);
          if (!date) continue;
          const isoDate = date.slice(0, 10);
          const e1rm = estimate1RM(weight, reps);
          const cur = bestPerDate.get(isoDate);
          if (cur == null || e1rm > cur) bestPerDate.set(isoDate, e1rm);
        }
        const sessions = Array.from(bestPerDate.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([date, e1rm]) => ({ date, e1rm: Math.round(e1rm * 10) / 10 }));
        if (sessions.length > 0) {
          out.push({ display_name: cfg.display_name, sessions });
        }
      }
      return out;
    },
    [catalog, exerciseLogSignals],
    [],
  );

  // ── Cross-page Dexie-watch invalidation ────────────────────────────
  // Watch counts on the relevant Dexie tables; when they change, invalidate
  // the server bundle so the next render pulls fresh setsByMuscle. Prefix
  // invalidation so future feed param changes still refresh.
  const workoutCountWeek = useLiveQuery(async () => {
    const monday = new Date();
    monday.setHours(0, 0, 0, 0);
    const dow = monday.getDay();
    monday.setDate(monday.getDate() + (dow === 0 ? -6 : 1 - dow));
    return db.workouts
      .filter(w => !w._deleted && w.start_time >= monday.toISOString())
      .count();
  }, [], 0);

  const bodyweightCount = useLiveQuery(
    () => db.bodyweight_logs.filter(b => !b._deleted).count(),
    [],
    0,
  );

  // Track previous values so we can skip the first-mount no-op invalidation.
  // useLiveQuery seeds with `0`/`undefined` then transitions to the real value
  // on its first emit; without this guard we'd invalidate `['feed']`/`['week']`
  // on initial render *and* on the first Dexie emit, racing the placeholder
  // fetch and triggering a redundant /api/feed round-trip.
  const prevInvalidationDeps = useRef<{
    workoutCountWeek: number | undefined;
    bodyweightCount: number | undefined;
    visionUpdatedAt: number | undefined;
  } | null>(null);

  useEffect(() => {
    const next = {
      workoutCountWeek,
      bodyweightCount,
      visionUpdatedAt: vision?._updated_at,
    };
    const prev = prevInvalidationDeps.current;
    prevInvalidationDeps.current = next;
    if (prev === null) {
      // First render — skip; the query has its own initial fetch, no need
      // to invalidate it before it has produced a result.
      return;
    }
    if (
      prev.workoutCountWeek === next.workoutCountWeek &&
      prev.bodyweightCount === next.bodyweightCount &&
      prev.visionUpdatedAt === next.visionUpdatedAt
    ) {
      // No-op: useLiveQuery re-emit with the same value (common after sync
      // engine push). Don't churn the query cache.
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['feed'] });
    queryClient.invalidateQueries({ queryKey: ['week'] });
  }, [queryClient, workoutCountWeek, bodyweightCount, vision?._updated_at]);

  // ── Build WeekFacts from all the sources ───────────────────────────
  const facts: WeekFacts = useMemo(() => {
    const base = emptyWeekFacts(new Date());

    const summary = feedBundle?.summary;
    if (summary) base.setsByMuscle = summary.setsByMuscle;

    base.rirThisWeek = {
      total_sets: weekSetSummary?.total_sets ?? 0,
      rir_logged_sets: weekSetSummary?.rir_logged_sets ?? 0,
      rir_quality_sets: weekSetSummary?.rir_quality_sets ?? 0,
    };
    base.sessions_this_week = weekSetSummary?.sessions ?? 0;
    base.sessions_last_14d = sessionsLast14d ?? 0;

    base.rirByWeek = rirByWeek ?? [];
    base.catalog = catalog ?? [];
    base.anchorSets = anchorSets ?? [];
    base.exerciseLogSignals = exerciseLogSignals ?? [];
    base.bodyweight = (bodyweight ?? []).map(b => ({
      date: b.logged_at.slice(0, 10),
      weight: b.weight_kg,
    }));

    if (vision) {
      base.vision = {
        build_emphasis: vision.build_emphasis ?? [],
        deemphasize: vision.deemphasize ?? [],
      };
    }

    // Recovery merge.
    if (snapshot && 'status' in snapshot && snapshot.status === 'not_connected') {
      base.recovery.status = 'not_connected';
    } else if (snapshot && 'hrv_daily' in snapshot) {
      base.recovery.status = 'connected';
      base.recovery.hrv_daily = snapshot.hrv_daily.map(p => ({ date: p.date, value: p.value_avg }));
      if (snapshot.last_night_sleep) {
        base.recovery.last_night_sleep = {
          date: snapshot.last_night_sleep.date,
          asleep_min: snapshot.last_night_sleep.asleep_min,
          in_bed_min: snapshot.last_night_sleep.in_bed_min,
        };
      }
    }
    if (sleep7 && 'averages' in sleep7) {
      base.recovery.sleep_avg_min_7d = sleep7.averages?.asleep_min ?? null;
      base.recovery.sleep_nights_7d = sleep7.range?.n_nights ?? 0;
    }
    if (sleep28 && 'averages' in sleep28) {
      base.recovery.sleep_baseline_min_28d = sleep28.averages?.asleep_min ?? null;
    }

    return base;
  }, [feedBundle, weekSetSummary, sessionsLast14d, rirByWeek, catalog, anchorSets, exerciseLogSignals, bodyweight, vision, snapshot, sleep7, sleep28]);

  const isLoading = feedPending && !feedBundle;
  const tiles = resolveWeekTiles(facts, { loading: isLoading });

  // ── v1.1 prescription engine wiring ───────────────────────────────────
  // Build the engine input from existing facts. Per-muscle 8-week history
  // isn't gathered today (would need a separate Dexie scan); we approximate
  // using rirByWeek.length capped at 8. RIR drift per-muscle is set null for
  // first ship — engine treats null as "no drift" gracefully. Anchor slope
  // per muscle is derived from the existing anchor-lift trend data.
  const hrtContext = useMemo(
    () => deriveHrtContext(hrtPeriods ?? [], facts.today),
    [hrtPeriods, facts.today],
  );

  const prescriptionResult = useMemo(() => {
    if (isLoading) return null;
    const priorityMuscles = facts.vision?.build_emphasis ?? [];
    if (priorityMuscles.length === 0) {
      // No priority muscles defined → engine returns empty card.
      return prescriptionsFor(
        { today: facts.today, hrv: { available: false, sigma_below: 0, baseline_days: 0 }, sessions_last_14d: facts.sessions_last_14d, muscles: [] },
        hrtContext,
      );
    }

    // HRV signal — derive sigma_below from the existing recovery facts.
    const hrvDaily = facts.recovery.hrv_daily;
    let hrvSigmaBelow = 0;
    let hrvBaselineDays = 0;
    let hrvAvailable = false;
    if (facts.recovery.status === 'connected' && hrvDaily.length >= 14) {
      const sorted = [...hrvDaily].sort((a, b) => a.date.localeCompare(b.date));
      const last7 = sorted.slice(-7);
      const last28 = sorted.slice(-28);
      const window7Mean = last7.reduce((s, p) => s + p.value, 0) / last7.length;
      const baselineMean = last28.reduce((s, p) => s + p.value, 0) / last28.length;
      const baselineSd = Math.sqrt(
        last28.reduce((s, p) => s + (p.value - baselineMean) ** 2, 0) / last28.length,
      );
      hrvAvailable = true;
      hrvBaselineDays = last28.length;
      hrvSigmaBelow = baselineSd > 0 ? (baselineMean - window7Mean) / baselineSd : 0;
    }

    // Per-muscle 8-week history approximation: use overall rirByWeek length.
    // Conservative — overcounts for muscles that weren't trained every week.
    // Refined per-muscle history is a v1.2 follow-up.
    const weeksWithDataApprox = Math.min(8, facts.rirByWeek.length);

    // Build per-muscle facts from setsByMuscle, restricted to priority muscles.
    const setsBySlug = new Map(facts.setsByMuscle.map(r => [r.slug, r]));
    const muscles: PrescriptionMuscleFact[] = [];
    priorityMuscles.forEach((slug, rank) => {
      const row = setsBySlug.get(slug);
      // Zone needs to be re-derived (server's status uses raw set_count, not
      // effective). For simplicity: 'in-zone' default; engine still gates on
      // weeks_with_data and requires explicit signals to fire PUSH/REDUCE.
      muscles.push({
        muscle: slug,
        effective_sets: row?.effective_set_count ?? 0,
        zone: 'in-zone', // conservative — gates above prevent false positives
        weeks_with_data: weeksWithDataApprox,
        rir_drift: null,        // v1.2 — per-muscle aggregation
        anchor_slope: null,     // v1.2 — wire from anchor-lift trend
        anchor_lift_name: null,
        build_emphasis_rank: rank,
      });
    });

    return prescriptionsFor(
      {
        today: facts.today,
        hrv: { available: hrvAvailable, sigma_below: hrvSigmaBelow, baseline_days: hrvBaselineDays },
        sessions_last_14d: facts.sessions_last_14d,
        muscles,
      },
      hrtContext,
    );
  }, [isLoading, facts, hrtContext]);

  // Photo cadence state for the footer.
  const photoCadence = useMemo(
    () => photoCadenceState(latestFrontPhoto ?? null, new Date()),
    [latestFrontPhoto],
  );

  // Inject weeks_with_data approximation into PriorityMusclesTile rows so
  // the SufficiencyBadge renders. v1.2 will make this per-muscle.
  // When the user picks a non-current week, swap the priority-muscles
  // tile's data for one resolved against the offset summary — but keep
  // every other tile (RIR, anchor lifts, etc.) anchored to "this week".
  const tilesWithBadges = useMemo(() => {
    const weeksApprox = Math.min(8, facts.rirByWeek.length);

    // Compute the offset-week priority-muscles tile when the picker is
    // moved away from "this week". Reuses the same resolver, fed an
    // overridden facts object (only setsByMuscle + sessions_this_week
    // change so the bar widths and MRV column reflect the picked week).
    let offsetPriorityTile: WeekTile | null = null;
    if (weekOffset !== 0 && priorityWeekSummary) {
      const offsetFacts: WeekFacts = {
        ...facts,
        setsByMuscle: priorityWeekSummary.setsByMuscle,
        sessions_this_week: priorityWeekSummary.weekSessions,
      };
      const resolved = resolveWeekTiles(offsetFacts);
      offsetPriorityTile = resolved.find(t => t.id === 'priority-muscles') ?? null;
    }

    return tiles.map(t => {
      if (t.id !== 'priority-muscles') return t;
      const source = offsetPriorityTile ?? t;
      if (source.state !== 'ok') return source;
      return {
        ...source,
        data: {
          ...source.data,
          rows: source.data.rows.map(r => ({
            ...r,
            weeks_with_data: r.weeks_with_data ?? weeksApprox,
          })),
        },
      };
    });
  }, [tiles, facts, facts.rirByWeek.length, weekOffset, priorityWeekSummary]);

  // ── Section B: 12-Week Trends data assembly ───────────────────────
  const trendsData: TwelveWeekTrendsData = useMemo(() => {
    // Bodyweight EWMA over the available 90-day window (already loaded
    // above by the existing query). Reuses computeEwma from the EWMA
    // helper to avoid recomputation drift.
    const bw = (bodyweight ?? []).map(b => ({
      date: b.logged_at.slice(0, 10),
      weight: b.weight_kg,
    }));
    const bwSeries = bw.length >= 7
      ? (() => {
          const ewmaPoints = computeEwma(bw);
          return {
            ewma: ewmaPoints.map(p => Math.round(p.ewma * 10) / 10),
            dates: ewmaPoints.map(p => p.date),
          };
        })()
      : null;

    // HRV trend: 7-day rolling mean per day from the existing HRV daily
    // points + a single 28-day baseline mean & SD. We reuse `snapshot`
    // (already 28 days) which gives us 28 days of rolling data — the
    // sparkline can plot ~28 - 7 + 1 ≈ 22 points. Acceptable for a v1
    // 12-wk trend (will improve once we expand the snapshot window).
    const hrvDaily = snapshot && 'hrv_daily' in snapshot ? snapshot.hrv_daily : null;
    let hrvSeries: TwelveWeekTrendsData['hrv'] = null;
    if (hrvDaily && hrvDaily.length >= 14) {
      const sorted = [...hrvDaily].sort((a, b) => a.date.localeCompare(b.date));
      const rolling7: number[] = [];
      const rollingDates: string[] = [];
      for (let i = 6; i < sorted.length; i++) {
        const window = sorted.slice(i - 6, i + 1);
        const mean = window.reduce((s, p) => s + p.value_avg, 0) / window.length;
        rolling7.push(Math.round(mean * 10) / 10);
        rollingDates.push(sorted[i].date);
      }
      const last28 = sorted.slice(-28);
      const baseline28 = last28.length >= 14
        ? last28.reduce((s, p) => s + p.value_avg, 0) / last28.length
        : null;
      let baselineSd: number | null = null;
      if (baseline28 != null && last28.length >= 14) {
        const variance = last28.reduce((s, p) => s + (p.value_avg - baseline28) ** 2, 0) / last28.length;
        baselineSd = Math.sqrt(variance);
      }
      hrvSeries = {
        rolling7,
        dates: rollingDates,
        baseline28: baseline28 != null ? Math.round(baseline28 * 10) / 10 : null,
        baselineSd: baselineSd != null ? Math.round(baselineSd * 10) / 10 : null,
      };
    }

    return {
      priorityMuscles: priorityMusclesByWeek ?? [],
      anchorLifts: anchorLiftsByWeek ?? [],
      bodyweight: bwSeries,
      hrv: hrvSeries,
      // Compliance series isn't computable until plan-vs-actual aggregation
      // exists at the data layer (planned routine sets aren't currently
      // tracked weekly). The section degrades to its empty state for now.
      compliance: null,
    };
  }, [bodyweight, snapshot, priorityMusclesByWeek, anchorLiftsByWeek]);

  const today = new Date();
  const dayLabel = today.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
  const dow = isoDayOfWeek(today);

  return (
    <main className="tab-content bg-background text-foreground">
      <header className="px-4 pt-safe pb-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold gradient-brand-text">Week</h1>
          <p className="text-xs text-muted-foreground dark:text-muted-foreground tabular-nums leading-tight">
            {dayLabel} · day {dow} of 7
          </p>
        </div>
        <Link
          href="/settings"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-muted/60 active:scale-95"
          aria-label="Settings"
        >
          <Settings className="h-5 w-5" strokeWidth={1.75} />
        </Link>
      </header>

      {/* Top-of-page entry-points (V1.1: moved up from the footer per Lou's
       *  feedback that they were buried). Compact horizontal chips so they
       *  don't compete with the priority-muscles tile that follows. */}
      <nav
        className="px-4 pb-3 flex items-center gap-2 overflow-x-auto"
        aria-label="Other pages"
      >
        <TopChip href="/strategy" icon={<Target className="h-3.5 w-3.5" />} label="Strategy" />
        <TopChip href="/sleep" icon={<Moon className="h-3.5 w-3.5" />} label="Sleep" />
        <TopChip href="/measurements?tab=log" icon={<Camera className="h-3.5 w-3.5" />} label="Photos" />
      </nav>

      <div className="px-4 space-y-4">
        {/* ── v1.1: Next-week prescription banner (top of Section A) ── */}
        <PrescriptionCard data={prescriptionResult} />

        {/* ── v1.1: Photo cadence prompt — promoted to top when overdue/no-photo,
         *  otherwise renders at the bottom (after Section B) ── */}
        {photoCadence.status !== 'fresh' && (photoCadence.status === 'overdue' || photoCadence.status === 'no-photo-ever') && (
          <PhotoCadenceFooter state={photoCadence} hasFrontProjection={hasFrontProjection} />
        )}

        {/* ── Section A: This Week — v1 tiles + v1.1 cardio inserted at slot 4 ── */}
        {tilesWithBadges.map((tile, index) => {
          // Inject CardioComplianceTile between Recovery (idx 3) and Weight EWMA (idx 4)
          const cardioInsert = tile.id === 'weight-ewma'
            ? <CardioComplianceTile key="cardio" data={cardioWeek ?? null} />
            : null;

          if (tile.state === 'loading') return <>{cardioInsert}<SkeletonTile key={tile.id} /></>;
          if (tile.state === 'needs-data' || tile.state === 'error') {
            return (
              <>
                {cardioInsert}
                <section
                  key={tile.id}
                  className="rounded-2xl bg-card dark:bg-card border border-border dark:border-border shadow-sm p-4"
                  aria-label={`${labelFor(tile.id)} — needs data`}
                >
                  <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                    {labelFor(tile.id)}
                  </div>
                  <div className="mt-2">
                    <TileEmptyState
                      message={tile.message ?? 'No data yet'}
                      fixHref={tile.fixHref}
                      fixLabel={tile.fixLabel}
                    />
                  </div>
                </section>
              </>
            );
          }

          // state === 'ok' or 'partial' — render tile body. We narrow per-id
          // and assert `data` (the discriminated-union ok-branch carries it).
          let body: React.ReactNode = null;
          if (tile.id === 'priority-muscles' && tile.state === 'ok') {
            body = (
              <PriorityMusclesTile
                key={tile.id}
                data={tile.data}
                weekOffset={weekOffset}
                weekStart={priorityWeekSummary?.weekStart}
                weekEnd={priorityWeekSummary?.weekEnd}
                onChangeWeekOffset={setWeekOffset}
              />
            );
          } else if (tile.id === 'effective-set-quality' && tile.state === 'ok') {
            body = <EffectiveSetQualityTile key={tile.id} data={tile.data} />;
          } else if (tile.id === 'anchor-lift-trend' && (tile.state === 'ok' || tile.state === 'partial')) {
            body = <AnchorLiftTrendTile key={tile.id} data={tile.data} />;
          } else if (tile.id === 'recovery' && tile.state === 'ok') {
            body = <RecoveryTile key={tile.id} data={tile.data} />;
          } else if (tile.id === 'weight-ewma' && tile.state === 'ok') {
            body = <WeightEwmaTile key={tile.id} data={tile.data} />;
          }
          if (body == null) return null;
          // Index unused but kept for potential future ordering tweaks.
          void index;
          return <>{cardioInsert}{body}</>;
        })}

        {/* ── Section B: 12-Week Trends ── */}
        <TwelveWeekTrendsSection data={trendsData} />

        {/* ── v1.1: Photo cadence footer — gentle reminder slot when not promoted above ── */}
        {photoCadence.status === 'soon' && (
          <PhotoCadenceFooter state={photoCadence} hasFrontProjection={hasFrontProjection} />
        )}
      </div>
    </main>
  );
}

function TopChip({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card hover:bg-muted/40 active:scale-[0.97] transition-all px-3 py-1.5 min-h-[36px] shrink-0"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs font-medium text-foreground">{label}</span>
    </Link>
  );
}

function SkeletonTile() {
  return (
    <div
      className="rounded-2xl bg-muted/40 dark:bg-muted/20 border border-border dark:border-border h-32 animate-pulse"
      aria-hidden
    />
  );
}

function labelFor(id: string): string {
  // These MUST match the eyebrows rendered by each tile's body so that the
  // needs-data fallback state reads as the same tile, not a different one.
  switch (id) {
    case 'priority-muscles':       return 'Priority Muscles';
    case 'effective-set-quality':  return 'Effective-Set Quality';
    case 'anchor-lift-trend':      return 'Anchor-Lift Trend';
    case 'recovery':               return 'Recovery';
    case 'weight-ewma':            return 'Weight EWMA';
    default:                       return id;
  }
}

