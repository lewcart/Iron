'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Trophy, Timer } from 'lucide-react';
import type { Exercise } from '@/types';
import { useUnit } from '@/context/UnitContext';
import { apiBase, fetchJsonAuthed } from '@/lib/api/client';
import type { ContentKind } from '@/lib/exercise-content-prompt';
import { ExerciseDemoStrip } from '@/components/ExerciseDemoStrip';
import { ExerciseImageManager } from '@/components/ExerciseImageManager';
import { EditableTextSection } from '@/components/EditableTextSection';
import { SetActionSheet, type SetActionSheetTarget } from '@/components/SetActionSheet';
import { AdjustPBHistorySheet } from '@/components/AdjustPBHistorySheet';
import { MuscleMap } from '@/components/MuscleMap';
import { MUSCLE_DEFS, normalizeMuscleTags } from '@/lib/muscles';
import { updateExercise } from '@/lib/mutations-exercises';
import {
  getExerciseProgressLocal,
  getExerciseSessionHistoryLocal,
  getExerciseTimePRsLocal,
  type ExerciseSessionGroup,
  type ExerciseTimePRsLocal,
} from '@/lib/useLocalDB';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// ── Types ──────────────────────────────────────────────────────────────────

// Matches PersonalRecord shape from src/types.ts — the API at
// /api/exercises/[uuid]/history returns this snake_case shape via
// calculatePRs in src/lib/pr.ts.
interface PRRecord {
  exercise_uuid: string;
  weight: number;
  repetitions: number;
  estimated_1rm: number;
  date: string;
  workout_uuid: string;
}

interface ProgressPoint {
  date: string;
  workoutUuid: string;
  maxWeight: number;
  totalVolume: number;
  estimated1RM: number;
}

interface VolumeTrendPoint {
  date: string;
  totalVolume: number;
}

interface RecentSet {
  date: string;
  weight: number;
  repetitions: number;
  rpe: number | null;
  workoutUuid: string;
}

interface ProgressData {
  progress: ProgressPoint[];
  prs: {
    estimated1RM: PRRecord | null;
  };
  volumeTrend: VolumeTrendPoint[];
  recentSets: RecentSet[];
}

const SESSIONS_PER_PAGE = 10;

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/** Read an HSL CSS variable and return it as a usable color string for
 *  Recharts. The library can't consume CSS vars directly so we materialize
 *  them at render time, which keeps charts theme-aware. */
function readCssVarColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return fallback;
  return `hsl(${raw})`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

/** Headline 1RM block — promoted from the 3-up secondary row in the
 *  previous layout. Shows the naked Epley estimate (no confidence band — see
 *  /plan-eng-review 2026-04-30 user decision). */
function OneRMHero({
  value,
  unit,
  date,
}: {
  value: string;
  unit: string;
  date: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 flex items-baseline gap-3">
      <div className="flex-1">
        <p className="text-xs uppercase text-muted-foreground tracking-wide">Personal Best</p>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="text-3xl font-bold text-foreground">{value}</span>
          <span className="text-sm text-muted-foreground">{unit}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Est. 1RM · {date}</p>
      </div>
      <Trophy className="h-8 w-8 text-amber-400/80 flex-shrink-0" />
    </div>
  );
}

/** Time-mode counterpart to OneRMHero. Headline number is the longest hold,
 *  date is when it was set. Total time across all sessions appears as a
 *  secondary inline stat — useful as a "tonnage" analogue for time-mode.
 *  When the longest hold was loaded with weight (e.g. weighted plank, dip,
 *  farmer carry), surface it inline so the hero captures both dimensions. */
function LongestHoldHero({
  longestSeconds,
  longestDate,
  longestWeight,
  weightLabel,
  totalSeconds,
}: {
  longestSeconds: number | null;
  longestDate: string;
  longestWeight: number | null;
  weightLabel: string;
  totalSeconds: number;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 flex items-baseline gap-3">
      <div className="flex-1">
        <p className="text-xs uppercase text-muted-foreground tracking-wide">Personal Best</p>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="text-3xl font-bold text-foreground">
            {longestSeconds != null ? formatDuration(longestSeconds) : '—'}
          </span>
          {longestWeight != null && longestWeight > 0 && (
            <span className="text-sm text-muted-foreground">
              @ {longestWeight} {weightLabel}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Longest Hold · {longestDate}
          {totalSeconds > 0 && (
            <span className="ml-2 text-muted-foreground/70">
              · {formatDuration(totalSeconds)} total
            </span>
          )}
        </p>
      </div>
      <Timer className="h-8 w-8 text-amber-400/80 flex-shrink-0" />
    </div>
  );
}

/** Compact PB readout sized to fit the demo strip's leading cell
 *  (aspect-[3/4] portrait). Shown when there are <3 demo frames so the
 *  strip's left third stays useful instead of dead air. The standalone
 *  OneRMHero/LongestHoldHero card is hidden when this renders so we
 *  don't show the same number twice. */
function PbStripCell({
  icon,
  label,
  value,
  unit,
  caption,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  caption?: string;
}) {
  return (
    <div className="w-full h-full bg-secondary/40 flex flex-col items-center justify-center px-2 py-3 text-center">
      <div className="text-amber-400/80 mb-1" aria-hidden>
        {icon}
      </div>
      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground leading-tight">
        {label}
      </p>
      <div className="flex items-baseline gap-0.5 mt-1">
        <span className="text-2xl font-bold text-foreground tabular-nums leading-none">
          {value}
        </span>
        {unit && (
          <span className="text-[10px] text-muted-foreground">{unit}</span>
        )}
      </div>
      {caption && (
        <p className="text-[9px] text-muted-foreground mt-1.5 leading-tight">
          {caption}
        </p>
      )}
    </div>
  );
}

/** Format a seconds count as the most compact human-readable string.
 *  60 → "1:00", 75 → "1:15", 3600 → "1:00:00", 9 → "9s". */
function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Segmented control for flipping `tracking_mode` between 'reps' (weight ×
 *  repetitions) and 'time' (held duration). Mirrors the create-form toggle
 *  for visual consistency. Saves on tap — no edit/cancel affordance because
 *  flipping is cheap and reversible (per migration 022, mode is freely
 *  mutable; historical sets are reinterpreted under the new mode).
 *
 *  The set logger (`/workout`) and routine builder (`/plans`) both read
 *  `exercise.tracking_mode` to render the right input shape, so flipping
 *  here propagates immediately via Dexie liveQuery. */
function TrackingModeToggle({
  value,
  onChange,
}: {
  value: 'reps' | 'time';
  onChange: (next: 'reps' | 'time') => Promise<void>;
}) {
  const [saving, setSaving] = useState<'reps' | 'time' | null>(null);
  const handleClick = async (next: 'reps' | 'time') => {
    if (next === value || saving) return;
    setSaving(next);
    try {
      await onChange(next);
    } finally {
      setSaving(null);
    }
  };
  return (
    <div>
      <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Tracking</p>
      <div className="flex gap-2 bg-secondary rounded-lg p-1">
        <button
          type="button"
          onClick={() => handleClick('reps')}
          disabled={saving !== null}
          className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
            value === 'reps' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
          } disabled:opacity-60`}
        >
          Reps × Weight
        </button>
        <button
          type="button"
          onClick={() => handleClick('time')}
          disabled={saving !== null}
          className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
            value === 'time' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
          } disabled:opacity-60`}
        >
          Time (held)
        </button>
      </div>
    </div>
  );
}

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div className={`bg-muted rounded-lg animate-pulse ${className ?? ''}`} />
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 px-4 py-4">
      <SkeletonBlock className="h-24" />
      <div className="flex gap-2">
        <SkeletonBlock className="flex-1 h-20" />
        <SkeletonBlock className="flex-1 h-20" />
      </div>
      <SkeletonBlock className="h-48" />
      <SkeletonBlock className="h-48" />
      <SkeletonBlock className="h-32" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Trophy className="h-10 w-10 text-muted-foreground/40 mb-3" />
      <p className="text-foreground font-medium">No workout data yet</p>
      <p className="text-muted-foreground text-sm mt-1">Log this exercise to see your progress</p>
    </div>
  );
}

type Range = '1m' | '3m' | '6m' | 'all';
const RANGES: { label: string; value: Range }[] = [
  { label: '1M', value: '1m' },
  { label: '3M', value: '3m' },
  { label: '6M', value: '6m' },
  { label: 'All', value: 'all' },
];

// ── Magic-content generator ────────────────────────────────────────────────
// Sends the LIVE exercise object (not just the uuid) so the route doesn't
// have to look up Postgres state — Dexie may have unsynced edits.
async function generateContent(
  kind: ContentKind,
  exercise: Exercise,
  signal: AbortSignal,
): Promise<unknown> {
  return fetchJsonAuthed('/api/exercises/generate-content', {
    method: 'POST',
    body: JSON.stringify({
      kind,
      exercise: {
        uuid: exercise.uuid,
        title: exercise.title,
        primary_muscles: exercise.primary_muscles,
        secondary_muscles: exercise.secondary_muscles,
        equipment: exercise.equipment,
        movement_pattern: exercise.movement_pattern,
        tracking_mode: exercise.tracking_mode,
        description: exercise.description,
        steps: exercise.steps,
        tips: exercise.tips,
      },
    }),
    signal,
  });
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ExerciseDetail({
  exercise,
  onBack,
}: {
  exercise: Exercise;
  onBack: () => void;
}) {
  const { toDisplay, label } = useUnit();
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>('all');

  // Materialize Recharts colors from CSS vars on every render so charts
  // pick up theme switches immediately. Cheap: getComputedStyle is sub-ms
  // and there's no need to memoize against a stale dep — the previous
  // [range]-keyed memo missed dark/light toggles, since theme changes
  // don't trigger range to update.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartTheme = {
    grid: readCssVarColor('--border', '#e5e7eb'),
    axis: readCssVarColor('--muted-foreground', '#6b7280'),
    tooltipBg: readCssVarColor('--card', '#ffffff'),
    tooltipBorder: readCssVarColor('--border', '#e5e7eb'),
    tooltipText: readCssVarColor('--foreground', '#111827'),
    line1RM: '#3b82f6',
    lineWeight: '#10b981',
    bar: '#3b82f6',
    pr: '#f59e0b',
  };

  // Session-grouped history, paginated. Lives separately from the chart
  // data so chart-range changes don't invalidate the session list.
  const [sessions, setSessions] = useState<ExerciseSessionGroup[]>([]);
  const [sessionsCursor, setSessionsCursor] = useState<string | null>(null);
  const [sessionsExhaustedLocally, setSessionsExhaustedLocally] = useState(false);
  const [sessionsServerCursor, setSessionsServerCursor] = useState<string | null>(null);
  const [sessionsServerDone, setSessionsServerDone] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [setActionTarget, setSetActionTarget] = useState<SetActionSheetTarget | null>(null);
  const [adjustPbOpen, setAdjustPbOpen] = useState(false);

  // Time-mode PR — only populated for time-mode exercises. Drives the
  // LongestHoldHero block in place of OneRMHero.
  const [timePRs, setTimePRs] = useState<ExerciseTimePRsLocal | null>(null);

  const trackingMode = exercise.tracking_mode ?? 'reps';
  const isTimeMode = trackingMode === 'time';

  // Local-first chart + PR data. Compute from Dexie so the modal works
  // offline at the gym. Fall back to server only if Dexie returns empty
  // (catalog hasn't hydrated, etc.) — that's a rare edge case.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProgressData(null);

    const sinceDate = (() => {
      const now = new Date();
      if (range === '1m') return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      if (range === '3m') return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      if (range === '6m') return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      return undefined;
    })();

    (async () => {
      try {
        // Branch by mode: rep-mode reads chart + 1RM PRs; time-mode reads
        // longest-hold PRs. Session list is mode-agnostic and runs in both.
        const [local, firstPage, time] = await Promise.all([
          isTimeMode ? Promise.resolve(null) : getExerciseProgressLocal(exercise.uuid, sinceDate),
          getExerciseSessionHistoryLocal(exercise.uuid, null, SESSIONS_PER_PAGE),
          isTimeMode ? getExerciseTimePRsLocal(exercise.uuid, sinceDate) : Promise.resolve(null),
        ]);
        if (cancelled) return;

        const serialized: ProgressData = local ? {
          progress: local.progress,
          prs: {
            estimated1RM: local.prs.estimated1RM ? { ...local.prs.estimated1RM, exercise_uuid: exercise.uuid } : null,
          },
          volumeTrend: local.volumeTrend,
          recentSets: [],
        } : {
          // Time-mode: empty rep-shaped fields. The hero + chart branches
          // off `isTimeMode` so this empty payload never gets rendered.
          progress: [],
          prs: { estimated1RM: null },
          volumeTrend: [],
          recentSets: [],
        };
        setProgressData(serialized);
        setTimePRs(time);
        setSessions(firstPage.sessions);
        setSessionsCursor(firstPage.nextCursor);
        setSessionsExhaustedLocally(firstPage.nextCursor === null);
        setSessionsServerCursor(null);
        setSessionsServerDone(false);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          console.warn('[ExerciseDetail] local read failed:', e);
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [exercise.uuid, range, isTimeMode]);

  const loadMoreSessions = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      // Phase 1: drain remaining local sessions.
      if (!sessionsExhaustedLocally && sessionsCursor) {
        const next = await getExerciseSessionHistoryLocal(exercise.uuid, sessionsCursor, SESSIONS_PER_PAGE);
        setSessions(prev => [...prev, ...next.sessions]);
        setSessionsCursor(next.nextCursor);
        if (next.nextCursor === null) setSessionsExhaustedLocally(true);
        setLoadingMore(false);
        return;
      }
      // Phase 2: server backfill for older sessions not in Dexie.
      if (!sessionsServerDone) {
        const seedCursor = sessionsServerCursor
          ?? (sessions.length > 0
                ? `${sessions[sessions.length - 1].date}|${sessions[sessions.length - 1].workout_uuid}`
                : null);
        const url = `${apiBase()}/api/exercises/${exercise.uuid}/sessions?limit=${SESSIONS_PER_PAGE}`
          + (seedCursor ? `&cursor=${encodeURIComponent(seedCursor)}` : '');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data: { sessions: ExerciseSessionGroup[]; nextCursor: string | null } = await res.json();
        // Filter out any session UUIDs already shown (local + server overlap).
        const existing = new Set(sessions.map(s => s.workout_uuid));
        const fresh = data.sessions.filter(s => !existing.has(s.workout_uuid));
        setSessions(prev => [...prev, ...fresh]);
        setSessionsServerCursor(data.nextCursor);
        if (data.nextCursor === null) setSessionsServerDone(true);
      }
    } catch (e) {
      console.warn('[ExerciseDetail] load more failed:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [exercise.uuid, loadingMore, sessions, sessionsCursor, sessionsExhaustedLocally, sessionsServerCursor, sessionsServerDone]);

  const hasMoreSessions = !sessionsExhaustedLocally || !sessionsServerDone;

  // hasData covers the chart/PR section only. The session list manages its
  // own visibility via the `sessions` array. Time-mode uses a different
  // primary-data shape (timePRs.progress) but the same session-list condition.
  const hasData = isTimeMode
    ? ((timePRs?.progress.length ?? 0) > 0 || sessions.length > 0)
    : (progressData != null && (progressData.progress.length > 0 || sessions.length > 0));
  const prWorkoutUuid = progressData?.prs.estimated1RM?.workout_uuid;

  // Compose the demo-strip's leading PB cell + decide whether to hide the
  // standalone hero card below the strip. The strip itself only USES the
  // slot when there are <3 frames; here we only need to compute it once
  // and let the strip drop it for the 3-frame catalog case.
  // Both the cell and the hero share the same data — the cell is a denser
  // representation of the hero, so we render one OR the other, never both.
  const stripFrameCount = (exercise.image_urls && exercise.image_urls.length > 0)
    ? exercise.image_urls.length
    : Math.min(Math.max(exercise.image_count, 0), 3);
  const stripWillUseLeadingSlot = stripFrameCount > 0 && stripFrameCount < 3;
  const pbStripCell: React.ReactNode = stripWillUseLeadingSlot ? (
    isTimeMode ? (
      <PbStripCell
        icon={<Timer className="h-5 w-5" />}
        label="Longest Hold"
        value={
          timePRs?.longestHold?.duration_seconds != null
            ? formatDuration(timePRs.longestHold.duration_seconds)
            : '—'
        }
        caption={
          timePRs?.longestHold
            ? (timePRs.longestHold.weight != null && timePRs.longestHold.weight > 0
                ? `@ ${Math.round(toDisplay(timePRs.longestHold.weight) * 10) / 10} ${label} · ${formatDate(timePRs.longestHold.date)}`
                : formatDate(timePRs.longestHold.date))
            : 'No data yet'
        }
      />
    ) : (
      <PbStripCell
        icon={<Trophy className="h-5 w-5" />}
        label="Personal Best"
        value={
          progressData?.prs.estimated1RM
            ? `${Math.round(toDisplay(progressData.prs.estimated1RM.estimated_1rm))}`
            : '—'
        }
        unit={progressData?.prs.estimated1RM ? label : undefined}
        caption={
          progressData?.prs.estimated1RM
            ? `Est. 1RM · ${formatDate(progressData.prs.estimated1RM.date)}`
            : 'No data yet'
        }
      />
    )
  ) : null;

  const chartData = progressData?.progress.map(p => ({
    date: formatDate(p.date),
    rawDate: p.date,
    workoutUuid: p.workoutUuid,
    estimated1RM: Math.round(toDisplay(p.estimated1RM) * 10) / 10,
    maxWeight: Math.round(toDisplay(p.maxWeight) * 10) / 10,
    // Compare workout_uuid (stable identity), not date strings — ProgressPoint
    // and PR record can hold different time formats and string comparison
    // breaks if either is reformatted.
    isPR: prWorkoutUuid != null && p.workoutUuid === prWorkoutUuid,
  })) ?? [];

  const volumeData = progressData?.volumeTrend.map(v => ({
    date: formatDate(v.date),
    totalVolume: Math.round(toDisplay(v.totalVolume)),
  })) ?? [];

  // Time-mode chart series: longest-hold (seconds) per session, with the
  // PR session highlighted on the matching workout_uuid. Sorted ascending
  // by date in getExerciseTimePRsLocal already.
  const timePrWorkoutUuid = timePRs?.longestHold?.workout_uuid;
  const timeChartData = timePRs?.progress.map(p => ({
    date: formatDate(p.date),
    rawDate: p.date,
    workoutUuid: p.workoutUuid,
    longestHold: p.longestHold,
    totalSeconds: p.totalSeconds,
    isPR: timePrWorkoutUuid != null && p.workoutUuid === timePrWorkoutUuid,
  })) ?? [];

  const tooltipStyle = {
    contentStyle: {
      backgroundColor: chartTheme.tooltipBg,
      border: `1px solid ${chartTheme.tooltipBorder}`,
      borderRadius: '8px',
      fontSize: 12,
      color: chartTheme.tooltipText,
    },
    labelStyle: { color: chartTheme.axis },
    itemStyle: { color: chartTheme.tooltipText },
  };

  return (
    <main ref={rootRef} className="tab-content bg-background">
      <div className="flex items-center gap-2 px-4 pt-safe pb-3 border-b border-border">
        <button onClick={onBack} className="flex items-center gap-1 text-primary font-medium text-base">
          <ChevronLeft className="h-5 w-5" />
          Back
        </button>
      </div>

      <div className="px-4 py-4 space-y-5">
        <h1 className="text-xl font-bold">{exercise.title}</h1>

        {/* Demo strip — renders only when image_count > 0 OR image_urls set.
            Tap → openYouTube when youtube_url present. Always visible at top
            of detail (before stats/chart) so it's the first thing the user
            sees mid-workout. An edit-pencil overlay opens the AI image
            manager (regenerate / pick a previous pair).
            When the strip has fewer than 3 frames (typical for the AI-
            generated pair flow), the leading cell shows a compact PB
            readout — denser than the full-width hero card and avoids the
            empty third we'd otherwise have. The standalone hero card is
            hidden in that case to avoid duplicating the same number. */}
        {(exercise.image_count > 0 || (exercise.image_urls && exercise.image_urls.length > 0)) && (
          <div className="relative">
            <ExerciseDemoStrip
              exerciseUuid={exercise.uuid}
              imageCount={exercise.image_count}
              imageUrls={exercise.image_urls ?? null}
              youtubeUrl={exercise.youtube_url}
              leadingSlot={pbStripCell}
            />
            <ExerciseImageManager variant="overlay" exerciseUuid={exercise.uuid} />
          </div>
        )}

        {/* No demo images yet — offer to generate them. */}
        {exercise.image_count === 0
          && (!exercise.image_urls || exercise.image_urls.length === 0) && (
          <ExerciseImageManager variant="empty" exerciseUuid={exercise.uuid} />
        )}

        {loading ? (
          <LoadingSkeleton />
        ) : !hasData ? (
          <EmptyState />
        ) : (
          <>
            {isTimeMode ? (
              !stripWillUseLeadingSlot && (
                <>
                  <LongestHoldHero
                    longestSeconds={timePRs?.longestHold?.duration_seconds ?? null}
                    longestDate={
                      timePRs?.longestHold
                        ? formatDate(timePRs.longestHold.date)
                        : 'No data'
                    }
                    longestWeight={
                      timePRs?.longestHold?.weight != null
                        ? Math.round(toDisplay(timePRs.longestHold.weight) * 10) / 10
                        : null
                    }
                    weightLabel={label}
                    totalSeconds={timePRs?.totalSeconds ?? 0}
                  />
                  <button
                    type="button"
                    onClick={() => setAdjustPbOpen(true)}
                    className="self-start text-[11px] font-semibold text-muted-foreground hover:text-foreground active:text-foreground -mt-1 px-1"
                  >
                    Set after a form fix? Adjust PB history…
                  </button>
                </>
              )
            ) : (<>
            {!stripWillUseLeadingSlot && (
              <>
                <OneRMHero
                  value={
                    progressData != null && progressData.prs.estimated1RM
                      ? `${Math.round(toDisplay(progressData.prs.estimated1RM.estimated_1rm))}`
                      : '—'
                  }
                  unit={label}
                  date={
                    progressData != null && progressData.prs.estimated1RM
                      ? formatDate(progressData.prs.estimated1RM.date)
                      : 'No data'
                  }
                />
                <button
                  type="button"
                  onClick={() => setAdjustPbOpen(true)}
                  className="self-start text-[11px] font-semibold text-muted-foreground hover:text-foreground active:text-foreground -mt-1 px-1"
                >
                  Set after a form fix? Adjust PB history…
                </button>
              </>
            )}

            </>)}

            {!isTimeMode && chartData.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2 px-1">
                  <p className="text-xs font-semibold text-primary uppercase tracking-wide">Weight Progress</p>
                  <div className="flex gap-1">
                    {RANGES.map(r => (
                      <button
                        key={r.value}
                        onClick={() => setRange(r.value)}
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors ${
                          range === r.value
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bg-card border border-border rounded-xl p-3">
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                      <XAxis dataKey="date" stroke={chartTheme.axis} fontSize={11} tick={{ fill: chartTheme.axis }} />
                      <YAxis stroke={chartTheme.axis} fontSize={11} tick={{ fill: chartTheme.axis }} unit={` ${label}`} />
                      <Tooltip {...tooltipStyle} />
                      <Line
                        type="monotone"
                        dataKey="estimated1RM"
                        name="Est. 1RM"
                        stroke={chartTheme.line1RM}
                        strokeWidth={2}
                        dot={(props: { cx?: number; cy?: number; payload?: { isPR?: boolean } }) => {
                          const { cx, cy, payload } = props;
                          if (!payload?.isPR || cx == null || cy == null) return <g key={`dot-${cx}`} />;
                          return (
                            <g key={`pr-dot-${cx}`}>
                              <circle cx={cx} cy={cy} r={6} fill={chartTheme.pr} stroke={chartTheme.tooltipBg} strokeWidth={2} />
                              <text x={cx} y={cy - 10} textAnchor="middle" fontSize={9} fill={chartTheme.pr} fontWeight="bold">PR</text>
                            </g>
                          );
                        }}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="maxWeight"
                        name="Max Weight"
                        stroke={chartTheme.lineWeight}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                        strokeDasharray="4 2"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="flex gap-4 mt-2 justify-center">
                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-0.5 rounded" style={{ background: chartTheme.line1RM }} />
                      <span className="text-[10px] text-muted-foreground">Est. 1RM</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-0.5 rounded" style={{ background: chartTheme.lineWeight }} />
                      <span className="text-[10px] text-muted-foreground">Max Weight</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: chartTheme.pr }} />
                      <span className="text-[10px] text-muted-foreground">PR</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {isTimeMode && timeChartData.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2 px-1">
                  <p className="text-xs font-semibold text-primary uppercase tracking-wide">Hold Progress</p>
                  <div className="flex gap-1">
                    {RANGES.map(r => (
                      <button
                        key={r.value}
                        onClick={() => setRange(r.value)}
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors ${
                          range === r.value
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bg-card border border-border rounded-xl p-3">
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={timeChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                      <XAxis dataKey="date" stroke={chartTheme.axis} fontSize={11} tick={{ fill: chartTheme.axis }} />
                      <YAxis
                        stroke={chartTheme.axis}
                        fontSize={11}
                        tick={{ fill: chartTheme.axis }}
                        unit="s"
                      />
                      <Tooltip
                        {...tooltipStyle}
                        formatter={((v: unknown) => [
                          typeof v === 'number' ? formatDuration(v) : String(v),
                          'Longest Hold',
                        ]) as never}
                      />
                      <Line
                        type="monotone"
                        dataKey="longestHold"
                        name="Longest Hold"
                        stroke={chartTheme.line1RM}
                        strokeWidth={2}
                        dot={(props: { cx?: number; cy?: number; payload?: { isPR?: boolean } }) => {
                          const { cx, cy, payload } = props;
                          if (!payload?.isPR || cx == null || cy == null) return <g key={`dot-${cx}`} />;
                          return (
                            <g key={`pr-dot-${cx}`}>
                              <circle cx={cx} cy={cy} r={6} fill={chartTheme.pr} stroke={chartTheme.tooltipBg} strokeWidth={2} />
                              <text x={cx} y={cy - 10} textAnchor="middle" fontSize={9} fill={chartTheme.pr} fontWeight="bold">PR</text>
                            </g>
                          );
                        }}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="flex gap-4 mt-2 justify-center">
                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-0.5 rounded" style={{ background: chartTheme.line1RM }} />
                      <span className="text-[10px] text-muted-foreground">Longest Hold</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: chartTheme.pr }} />
                      <span className="text-[10px] text-muted-foreground">PR</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!isTimeMode && volumeData.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2 px-1">Volume Trend</p>
                <div className="bg-card border border-border rounded-xl p-3">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={volumeData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                      <XAxis dataKey="date" stroke={chartTheme.axis} fontSize={11} tick={{ fill: chartTheme.axis }} />
                      <YAxis stroke={chartTheme.axis} fontSize={11} tick={{ fill: chartTheme.axis }} />
                      <Tooltip {...tooltipStyle} />
                      <Bar dataKey="totalVolume" name={`Volume (${label})`} fill={chartTheme.bar} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {sessions.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2 px-1">Session History</p>
                <div className="space-y-2">
                  {sessions.map(s => (
                    <div key={s.workout_uuid} className="bg-card border border-border rounded-xl overflow-hidden">
                      <div className="px-3 py-2 border-b border-border flex items-baseline justify-between">
                        <span className="text-xs font-semibold text-foreground">
                          {formatDate(s.date)}
                        </span>
                        {s.workout_title && (
                          <span className="text-[11px] text-muted-foreground truncate ml-2">{s.workout_title}</span>
                        )}
                      </div>
                      {s.sets.map((set, i) => {
                        // Per migration 022, exercise.tracking_mode is the
                        // source of truth — historical sets are reinterpreted
                        // under the current mode. A time-mode exercise with
                        // an old reps-only set reads `repetitions` as the
                        // held duration (Lou's pre-feature workaround).
                        const isTime = isTimeMode || set.duration_seconds != null;
                        const effectiveSeconds = set.duration_seconds ?? set.repetitions ?? null;
                        const excluded = set.excluded_from_pb;
                        const isPr = set.is_pr && !excluded;
                        return (
                          <button
                            type="button"
                            key={set.uuid}
                            onClick={() => setSetActionTarget({
                              set_uuid: set.uuid,
                              is_excluded: excluded,
                              weight: set.weight,
                              repetitions: set.repetitions,
                              duration_seconds: set.duration_seconds,
                              label: `Set ${i + 1} · ${formatDate(s.date)}`,
                            })}
                            className={`w-full flex items-baseline gap-3 px-3 py-1.5 text-left active:bg-card/70 ${
                              excluded
                                ? 'border-l-2 border-l-slate-500/60 bg-card/40'
                                : isPr
                                ? 'bg-amber-500/10'
                                : i % 2 === 0 ? 'bg-card' : 'bg-muted/30'
                            }`}
                          >
                            <span className={`text-[10px] w-5 text-center flex-shrink-0 ${
                              excluded ? 'text-muted-foreground/60' : 'text-muted-foreground'
                            }`}>{i + 1}</span>
                            {isTime ? (
                              <>
                                <span className={`text-xs flex-1 ${excluded ? 'text-muted-foreground/60 line-through' : 'text-foreground'}`}>
                                  {set.weight != null && set.weight > 0 ? toDisplay(set.weight) : '—'}
                                  <span className="text-muted-foreground ml-0.5">{label}</span>
                                </span>
                                <span className="text-xs text-muted-foreground">×</span>
                                <span className={`text-xs flex-1 ${excluded ? 'text-muted-foreground/60 line-through' : 'text-foreground'}`}>
                                  {effectiveSeconds != null ? `${effectiveSeconds}s` : '—'}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className={`text-xs flex-1 ${excluded ? 'text-muted-foreground/60 line-through' : 'text-foreground'}`}>
                                  {set.weight != null ? toDisplay(set.weight) : '—'}
                                  <span className="text-muted-foreground ml-0.5">{label}</span>
                                </span>
                                <span className="text-xs text-muted-foreground">×</span>
                                <span className={`text-xs flex-1 ${excluded ? 'text-muted-foreground/60 line-through' : 'text-foreground'}`}>{set.repetitions ?? '—'} reps</span>
                              </>
                            )}
                            {excluded ? (
                              <span className="text-[10px] font-bold text-slate-300 bg-slate-500/20 border border-slate-500/30 px-1.5 py-0 rounded-full">
                                EX
                              </span>
                            ) : isPr ? (
                              <span className="text-[10px] font-bold text-amber-400">PR</span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground w-10 text-right flex-shrink-0">
                                {set.rpe != null ? `RPE ${set.rpe}` : ''}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                {hasMoreSessions && (
                  <button
                    onClick={loadMoreSessions}
                    disabled={loadingMore}
                    className="w-full mt-2 py-2 text-sm font-medium text-primary disabled:opacity-50"
                  >
                    {loadingMore ? 'Loading…' : 'View more'}
                  </button>
                )}
                {!hasMoreSessions && sessions.length > SESSIONS_PER_PAGE && (
                  <p className="text-center text-xs text-muted-foreground mt-2">End of history</p>
                )}
              </div>
            )}
          </>
        )}

        <EditableTextSection
          mode="prose"
          label="About"
          value={exercise.description}
          emptyPlaceholder="Describe what this exercise does and what to focus on…"
          editable
          onSave={async (next) => {
            await updateExercise(exercise.uuid, { description: next });
          }}
          onMagicGenerate={async (signal) => {
            const out = await generateContent('description', exercise, signal);
            return (out as { description: string }).description;
          }}
        />

        {(() => {
          const { primary, secondary } = normalizeMuscleTags(
            exercise.primary_muscles,
            exercise.secondary_muscles,
          );
          if (primary.length === 0 && secondary.length === 0) return null;

          return (
            <div>
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">
                Target muscles
              </p>
              <div className="ios-section p-3 space-y-3">
                <MuscleMap primary={primary} secondary={secondary} />
                {/* Per-muscle credit ledger (v1.1). Read-only in v1.1
                    — UI editor lands in v1.2 per gate-locked plan.
                    MCP `update_exercise(secondary_weights)` is the
                    v1.1 write path. */}
                <div className="border-t border-border pt-3 space-y-1">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Muscle credit
                    {exercise.weight_source && exercise.weight_source !== 'default' && (
                      <span className={`ml-2 normal-case font-normal ${
                        exercise.weight_source === 'audited' ? 'text-emerald-400/80'
                        : exercise.weight_source === 'manual-override' ? 'text-amber-400/80'
                        : 'text-muted-foreground/70'
                      }`}>
                        {exercise.weight_source === 'audited' ? 'audited'
                          : exercise.weight_source === 'manual-override' ? 'manual override'
                          : 'inferred'}
                      </span>
                    )}
                  </p>
                  {primary.map((m) => (
                    <div key={`p-${m}`} className="flex items-center justify-between text-xs">
                      <span className="text-foreground">{MUSCLE_DEFS[m].display_name}</span>
                      <span className="text-emerald-400/80 font-mono tabular-nums">primary · 1.0</span>
                    </div>
                  ))}
                  {secondary.map((m) => {
                    const w = exercise.secondary_weights?.[m];
                    const usingDefault = w == null;
                    return (
                      <div key={`s-${m}`} className="flex items-center justify-between text-xs">
                        <span className="text-foreground">{MUSCLE_DEFS[m].display_name}</span>
                        <span className={`font-mono tabular-nums ${
                          usingDefault ? 'text-muted-foreground/70' : 'text-foreground/80'
                        }`}>
                          secondary · {(w ?? 0.5).toFixed(2)}
                          {usingDefault && (
                            <span className="ml-1 text-[9px] text-muted-foreground/60">default</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Tracking mode toggle — flip an exercise between weight × reps and
            held duration. Mirrors the segmented control on CreateExerciseForm
            so the UX is consistent with first-creation. The set logger
            (workout page) and routine builder (plans page) both branch on
            this value to render the right inputs. */}
        <TrackingModeToggle
          value={trackingMode}
          onChange={async (next) => {
            await updateExercise(exercise.uuid, { tracking_mode: next });
          }}
        />

        {/* Has-sides toggle — when on, the in-workout stopwatch enters a 10s
            switch countdown after side 1 stops, then resumes counting up
            for side 2. Wired through to exercises.has_sides via
            updateExercise. */}
        <div className="ios-section">
          <button
            type="button"
            onClick={async () => {
              await updateExercise(exercise.uuid, { has_sides: !exercise.has_sides });
            }}
            className="ios-row flex items-center justify-between w-full"
            aria-pressed={exercise.has_sides}
          >
            <div className="flex flex-col items-start">
              <span className="text-sm">Has sides (each leg / each arm)</span>
              <span className="text-[11px] text-muted-foreground mt-0.5">
                Stopwatch adds a 10s switch between sides
              </span>
            </div>
            <div className={
              'w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ' +
              (exercise.has_sides ? 'bg-primary' : 'bg-secondary')
            }>
              <div className={
                'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ' +
                (exercise.has_sides ? 'translate-x-[22px]' : 'translate-x-0.5')
              } />
            </div>
          </button>
        </div>

        {exercise.equipment.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Equipment</p>
            <div className="ios-section">
              {exercise.equipment.map(eq => (
                <div key={eq} className="ios-row">
                  <span className="text-sm capitalize">{eq}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <EditableTextSection
          mode="numbered-list"
          label="Steps"
          value={exercise.steps}
          emptyPlaceholder="Add a step…"
          editable
          onSave={async (next) => {
            await updateExercise(exercise.uuid, { steps: next });
          }}
          onMagicGenerate={async (signal) => {
            const out = await generateContent('steps', exercise, signal);
            return (out as { steps: string[] }).steps;
          }}
        />

        <EditableTextSection
          mode="bullet-list"
          label="Tips"
          value={exercise.tips}
          emptyPlaceholder="Add a tip or thing to watch out for…"
          editable
          onSave={async (next) => {
            await updateExercise(exercise.uuid, { tips: next });
          }}
          onMagicGenerate={async (signal) => {
            const out = await generateContent('tips', exercise, signal);
            return (out as { tips: string[] }).tips;
          }}
        />

        {exercise.alias.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Also Known As</p>
            <div className="ios-section">
              {exercise.alias.map((a, i) => (
                <div key={i} className="ios-row">
                  <span className="text-sm">{a}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <SetActionSheet
        target={setActionTarget}
        onClose={() => setSetActionTarget(null)}
        unitLabel={label}
      />
      <AdjustPBHistorySheet
        exerciseUuid={exercise.uuid}
        exerciseTitle={exercise.title}
        open={adjustPbOpen}
        onClose={() => setAdjustPbOpen(false)}
      />
    </main>
  );
}
