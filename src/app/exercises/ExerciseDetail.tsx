'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Trophy, Medal, Award } from 'lucide-react';
import type { Exercise } from '@/types';
import { useUnit } from '@/context/UnitContext';
import { apiBase } from '@/lib/api/client';
import {
  getExerciseProgressLocal,
  getExerciseSessionHistoryLocal,
  type ExerciseSessionGroup,
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
    heaviestWeight: PRRecord | null;
    mostReps: PRRecord | null;
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

function PRBadge({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex-1 flex flex-col items-center gap-1 bg-card border border-border rounded-xl p-3 min-w-0">
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide text-center">{label}</p>
      <p className="text-base font-bold text-foreground text-center leading-tight">{value}</p>
      <p className="text-[10px] text-muted-foreground text-center">{sub}</p>
    </div>
  );
}

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

// ── Main component ─────────────────────────────────────────────────────────

export default function ExerciseDetail({
  exercise,
  onBack,
  chrome = 'page',
}: {
  exercise: Exercise;
  onBack: () => void;
  /** Render mode: 'page' shows the back-button nav bar; 'modal' assumes
   *  the parent already supplies its own chrome (header bar + close button). */
  chrome?: 'page' | 'modal';
}) {
  const { toDisplay, label } = useUnit();
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>('all');

  // Materialize Recharts colors from CSS vars at render time so charts
  // adapt to light/dark mode along with everything else. range dep means
  // a re-fetch trigger refreshes them — and a theme-toggle within the
  // session would need to also rerender, which existing flows already do.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartTheme = useMemo(() => ({
    grid: readCssVarColor('--border', '#e5e7eb'),
    axis: readCssVarColor('--muted-foreground', '#6b7280'),
    tooltipBg: readCssVarColor('--card', '#ffffff'),
    tooltipBorder: readCssVarColor('--border', '#e5e7eb'),
    tooltipText: readCssVarColor('--foreground', '#111827'),
    line1RM: '#3b82f6',
    lineWeight: '#10b981',
    bar: '#3b82f6',
    pr: '#f59e0b',
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [range]);

  // Session-grouped history, paginated. Lives separately from the chart
  // data so chart-range changes don't invalidate the session list.
  const [sessions, setSessions] = useState<ExerciseSessionGroup[]>([]);
  const [sessionsCursor, setSessionsCursor] = useState<string | null>(null);
  const [sessionsExhaustedLocally, setSessionsExhaustedLocally] = useState(false);
  const [sessionsServerCursor, setSessionsServerCursor] = useState<string | null>(null);
  const [sessionsServerDone, setSessionsServerDone] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

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
        const local = await getExerciseProgressLocal(exercise.uuid, sinceDate);
        if (cancelled) return;

        // Initial first-page session load runs alongside the chart compute.
        const firstPage = await getExerciseSessionHistoryLocal(exercise.uuid, null, SESSIONS_PER_PAGE);
        if (cancelled) return;

        const serialized: ProgressData = {
          progress: local.progress,
          prs: {
            estimated1RM: local.prs.estimated1RM ? { ...local.prs.estimated1RM, exercise_uuid: exercise.uuid } : null,
            heaviestWeight: local.prs.heaviestWeight ? { ...local.prs.heaviestWeight, exercise_uuid: exercise.uuid } : null,
            mostReps: local.prs.mostReps ? { ...local.prs.mostReps, exercise_uuid: exercise.uuid } : null,
          },
          volumeTrend: local.volumeTrend,
          // recentSets retained for legacy shape parity but no longer rendered;
          // session list below replaces the flat table.
          recentSets: [],
        };
        setProgressData(serialized);
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
  }, [exercise.uuid, range]);

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
  // own visibility via the `sessions` array.
  const hasData = progressData && (progressData.progress.length > 0 || sessions.length > 0);
  const prWorkoutUuid = progressData?.prs.estimated1RM?.workout_uuid;

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
      {chrome === 'page' && (
        <div className="flex items-center gap-2 px-4 pt-safe pb-3 border-b border-border">
          <button onClick={onBack} className="flex items-center gap-1 text-primary font-medium text-base">
            <ChevronLeft className="h-5 w-5" />
            Back
          </button>
        </div>
      )}

      <div className="px-4 py-4 space-y-5">
        {chrome === 'page' && (
          <h1 className="text-xl font-bold">{exercise.title}</h1>
        )}

        {loading ? (
          <LoadingSkeleton />
        ) : !hasData ? (
          <EmptyState />
        ) : (
          <>
            <OneRMHero
              value={
                progressData.prs.estimated1RM
                  ? `${Math.round(toDisplay(progressData.prs.estimated1RM.estimated_1rm))}`
                  : '—'
              }
              unit={label}
              date={
                progressData.prs.estimated1RM
                  ? formatDate(progressData.prs.estimated1RM.date)
                  : 'No data'
              }
            />

            <div className="flex gap-2">
              <PRBadge
                icon={<Medal className="h-4 w-4" />}
                label="Heaviest"
                value={
                  progressData.prs.heaviestWeight
                    ? `${toDisplay(progressData.prs.heaviestWeight.weight)} ${label}`
                    : '—'
                }
                sub={
                  progressData.prs.heaviestWeight
                    ? formatDate(progressData.prs.heaviestWeight.date)
                    : 'No data'
                }
              />
              <PRBadge
                icon={<Award className="h-4 w-4" />}
                label="Most Reps"
                value={
                  progressData.prs.mostReps
                    ? `${progressData.prs.mostReps.repetitions}`
                    : '—'
                }
                sub={
                  progressData.prs.mostReps
                    ? `@ ${toDisplay(progressData.prs.mostReps.weight)} ${label}`
                    : 'No data'
                }
              />
            </div>

            {chartData.length > 0 && (
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

            {volumeData.length > 0 && (
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
                        const isTime = set.duration_seconds != null;
                        return (
                          <div
                            key={set.uuid}
                            className={`flex items-baseline gap-3 px-3 py-1.5 ${i % 2 === 0 ? 'bg-card' : 'bg-muted/30'}`}
                          >
                            <span className="text-[10px] text-muted-foreground w-5 text-center flex-shrink-0">{i + 1}</span>
                            {isTime ? (
                              <span className="text-xs text-foreground flex-1">
                                {set.duration_seconds}s
                              </span>
                            ) : (
                              <>
                                <span className="text-xs text-foreground flex-1">
                                  {set.weight != null ? toDisplay(set.weight) : '—'}
                                  <span className="text-muted-foreground ml-0.5">{label}</span>
                                </span>
                                <span className="text-xs text-muted-foreground">×</span>
                                <span className="text-xs text-foreground flex-1">{set.repetitions ?? '—'} reps</span>
                              </>
                            )}
                            <span className="text-[11px] text-muted-foreground w-10 text-right flex-shrink-0">
                              {set.rpe != null ? `RPE ${set.rpe}` : ''}
                            </span>
                          </div>
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

        {exercise.description && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">About</p>
            <div className="ios-section p-4">
              <p className="text-sm text-foreground leading-relaxed">{exercise.description}</p>
            </div>
          </div>
        )}

        {(exercise.primary_muscles.length > 0 || exercise.secondary_muscles.length > 0) && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Muscles</p>
            <div className="ios-section">
              {exercise.primary_muscles.map(m => (
                <div key={m} className="ios-row">
                  <span className="flex-1 text-sm capitalize">{m}</span>
                  <span className="text-xs text-muted-foreground">Primary</span>
                </div>
              ))}
              {exercise.secondary_muscles.map(m => (
                <div key={m} className="ios-row">
                  <span className="flex-1 text-sm capitalize">{m}</span>
                  <span className="text-xs text-muted-foreground">Secondary</span>
                </div>
              ))}
            </div>
          </div>
        )}

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

        {exercise.steps.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Steps</p>
            <div className="ios-section">
              {exercise.steps.map((step, i) => (
                <div key={i} className="ios-row gap-3">
                  <span className="text-xs font-bold text-primary w-5 text-center flex-shrink-0">{i + 1}</span>
                  <p className="text-sm flex-1 leading-snug">{step}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {exercise.tips.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1 px-1">Tips</p>
            <div className="ios-section">
              {exercise.tips.map((tip, i) => (
                <div key={i} className="ios-row">
                  <p className="text-sm flex-1 leading-snug">{tip}</p>
                </div>
              ))}
            </div>
          </div>
        )}

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
    </main>
  );
}
