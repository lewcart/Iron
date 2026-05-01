'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
  LineChart, Line,
} from 'recharts';
import { fetchJson } from '@/lib/api/client';
import { StageBar } from '@/components/ui/stage-bar';
import { RangeTabs, type RangeKey } from '@/components/ui/range-tabs';
import type { SleepSummaryResult, SleepSummaryError } from '@/lib/health-sleep-summary';

// ── Constants for verdict + stage colors ────────────────────────────────────

const STAGE_COLORS = {
  deep: 'bg-indigo-600',
  rem: 'bg-violet-500',
  core: 'bg-sky-400',
  awake: 'bg-zinc-300 dark:bg-zinc-700',
} as const;

// recharts wants raw color values; mirror the tailwind pals.
const STAGE_FILLS = {
  deep: '#4f46e5',
  rem: '#8b5cf6',
  core: '#38bdf8',
  awake: '#9ca3af',
} as const;

type Verdict = 'solid' | 'ok' | 'light' | 'restless';

const VERDICT_LABEL: Record<Verdict, string> = {
  solid: 'Solid',
  ok: 'OK',
  light: 'Light',
  restless: 'Restless',
};

// Verdict from stage minutes. Heuristics, not science:
//   <5h asleep → Light (independent of stage mix — duration trumps)
//   deep_pct < 13% AND asleep < 6.5h → Restless
//   deep_pct >= 13% AND asleep >= 7h → Solid
//   else → OK
function verdictFor(asleepMin: number, deepMin: number): Verdict {
  if (asleepMin < 5 * 60) return 'light';
  const deepPct = asleepMin > 0 ? (deepMin / asleepMin) * 100 : 0;
  if (deepPct < 13 && asleepMin < 6.5 * 60) return 'restless';
  if (deepPct >= 13 && asleepMin >= 7 * 60) return 'solid';
  return 'ok';
}

// "Solid" if score >= 75; "Drifting" if 60..74; "Erratic" otherwise.
function consistencyLabel(score: number): string {
  if (score >= 90) return 'Exceptional';
  if (score >= 75) return 'Solid';
  if (score >= 60) return 'Drifting';
  return 'Erratic';
}

function fmt(min: number | null | undefined): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function deltaSign(pct: number | null): string {
  if (pct == null) return '';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct}%`;
}

// ── Range → query params ────────────────────────────────────────────────────

function rangeToWindowDays(range: RangeKey): number {
  switch (range) {
    case 'day':    return 1;
    case 'week':   return 7;
    case 'month':  return 30;
    case '3month': return 90;
  }
}

interface FetchState {
  loading: boolean;
  data: SleepSummaryResult | null;
  notConnected: boolean;
  error: SleepSummaryError | null;
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function SleepPage() {
  const [range, setRange] = useState<RangeKey>('week');
  const [state, setState] = useState<FetchState>({
    loading: true, data: null, notConnected: false, error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState(s => ({ ...s, loading: true }));
    const params = new URLSearchParams();
    params.set('window_days', String(rangeToWindowDays(range)));
    params.set('fields', 'range,averages,consistency,hrv,nights,data_quality');
    fetchJson<SleepSummaryResult | SleepSummaryError | { status: 'not_connected'; reason: string; message: string }>(
      `/api/health/sleep-summary?${params.toString()}`,
    ).then(result => {
      if (cancelled) return;
      if ('status' in result) {
        if (result.status === 'not_connected') {
          setState({ loading: false, data: null, notConnected: true, error: null });
        } else {
          setState({ loading: false, data: null, notConnected: false, error: result as SleepSummaryError });
        }
      } else {
        setState({ loading: false, data: result as SleepSummaryResult, notConnected: false, error: null });
      }
    }).catch(() => {
      if (!cancelled) setState({ loading: false, data: null, notConnected: false, error: null });
    });
    return () => { cancelled = true; };
  }, [range]);

  return (
    <div className="ios-container max-w-2xl mx-auto pb-32">
      <header className="flex items-center justify-between py-4">
        <Link
          href="/"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          aria-label="Back to home"
        >
          <ChevronLeft className="h-5 w-5" />
          <span>Sleep</span>
        </Link>
      </header>

      <div className="space-y-4">
        {state.notConnected && <NotConnectedCard />}
        {state.error && <ErrorCard error={state.error} />}

        {state.loading && !state.data && <SkeletonCards />}

        {state.data && (
          <>
            <LedeCard data={state.data} />
            <WeeklyAveragesCard data={state.data} />
            <StageStackChart data={state.data} />
            <HrvSparkline data={state.data} />
          </>
        )}

        <RangeTabs value={range} onChange={setRange} />

        {state.data?.range && (
          <p className="text-xs text-muted-foreground text-center pt-2">
            {state.data.range.n_nights} of {rangeToWindowDays(range)} nights · {state.data.range.timezone}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Cards ───────────────────────────────────────────────────────────────────

function LedeCard({ data }: { data: SleepSummaryResult }) {
  const lastNight = data.nights?.[0];
  if (!lastNight) {
    return (
      <section className="ios-section">
        <div className="ios-row flex flex-col gap-1 py-6">
          <p className="text-sm text-muted-foreground">No data for last night.</p>
          {data.range && data.range.n_nights > 0 && (
            <p className="text-xs text-muted-foreground">
              Last logged date in window: {data.nights?.[0]?.wake_date ?? '—'}
            </p>
          )}
        </div>
      </section>
    );
  }
  const asleep = Number(lastNight.asleep_min);
  const deep = Number(lastNight.deep_min);
  const verdict = verdictFor(asleep, deep);
  const avgSleep = data.averages?.asleep_min;
  const lightHint = verdict === 'light' && avgSleep
    ? `Light night. Your ${data.range?.n_nights ?? 7}-night average is ${fmt(avgSleep)}.`
    : null;

  return (
    <section className="ios-section">
      <div className="px-4 py-4 space-y-3">
        <div>
          <p className="text-2xl font-semibold">{VERDICT_LABEL[verdict]}</p>
          <p className="text-base text-muted-foreground">{fmt(asleep)} last night</p>
          {lightHint && <p className="mt-1 text-xs text-muted-foreground">{lightHint}</p>}
        </div>
        <StageBar
          segments={[
            { label: 'Deep', minutes: deep, color: STAGE_COLORS.deep },
            { label: 'REM',  minutes: Number(lastNight.rem_min),  color: STAGE_COLORS.rem },
            { label: 'Core', minutes: Number(lastNight.core_min), color: STAGE_COLORS.core },
            { label: 'Awake', minutes: Number(lastNight.awake_min), color: STAGE_COLORS.awake },
          ]}
        />
        <div className="text-sm text-muted-foreground space-y-0.5">
          <div className="flex justify-between">
            <span>Deep</span><span>{fmt(deep)} ({deepPct(asleep, deep)})</span>
          </div>
          <div className="flex justify-between">
            <span>REM</span><span>{fmt(Number(lastNight.rem_min))} ({pct(asleep, Number(lastNight.rem_min))})</span>
          </div>
          {data.hrv && data.hrv.last != null && (
            <div className="flex justify-between pt-1">
              <span>HRV</span>
              <span>
                {Math.round(data.hrv.last)}ms{' '}
                {data.hrv.delta_pct != null && (
                  <span className={data.hrv.delta_pct >= 0 ? 'text-emerald-600' : 'text-amber-600'}>
                    {deltaSign(data.hrv.delta_pct)} vs 30d
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function deepPct(asleep: number, deep: number): string {
  return asleep > 0 ? `${Math.round((deep / asleep) * 100)}%` : '—';
}

function pct(asleep: number, x: number): string {
  return asleep > 0 ? `${Math.round((x / asleep) * 100)}%` : '—';
}

function WeeklyAveragesCard({ data }: { data: SleepSummaryResult }) {
  const a = data.averages;
  const c = data.consistency;
  const showConsistency = c != null;
  return (
    <section className="ios-section">
      <h2 className="px-4 pt-3 pb-1 text-sm font-medium text-muted-foreground">Window averages</h2>
      <div className="px-4 pb-3 text-sm space-y-1">
        <Row label="Avg sleep" value={fmt(a?.asleep_min ?? null)} />
        {showConsistency ? (
          <Row
            label="Consistency"
            value={consistencyLabel(c.score)}
            hint={`bedtime ±${c.bedtime_stdev_min}m · wake ±${c.waketime_stdev_min}m`}
          />
        ) : (
          <Row label="Consistency" value="—" hint="Need 5+ nights" />
        )}
        <Row label="Avg deep" value={a ? `${fmt(a.deep_min)} (${a.deep_pct ?? 0}%)` : '—'} />
        <Row label="Avg REM"  value={a ? `${fmt(a.rem_min)} (${a.rem_pct ?? 0}%)` : '—'} />
        {data.hrv && data.hrv.window_avg != null && (
          <Row
            label={`HRV (${data.hrv.n_days}d)`}
            value={`${Math.round(data.hrv.window_avg)}ms`}
            hint={data.hrv.delta_pct != null ? `${deltaSign(data.hrv.delta_pct)} vs 30d` : undefined}
          />
        )}
      </div>
    </section>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">
        <span>{value}</span>
        {hint && <span className="ml-2 text-xs text-muted-foreground">{hint}</span>}
      </span>
    </div>
  );
}

// ── Charts ──────────────────────────────────────────────────────────────────

function StageStackChart({ data }: { data: SleepSummaryResult }) {
  const nights = (data.nights ?? []).slice().reverse(); // chronological L→R
  if (nights.length === 0) {
    return (
      <section className="ios-section">
        <div className="px-4 py-6 text-sm text-muted-foreground text-center">
          No nights in this window.
        </div>
      </section>
    );
  }
  const chartData = nights.map(n => ({
    date: n.wake_date.slice(5),
    Deep: Number(n.deep_min),
    REM: Number(n.rem_min),
    Core: Number(n.core_min),
    Awake: Number(n.awake_min),
  }));
  return (
    <section className="ios-section">
      <h2 className="px-4 pt-3 pb-1 text-sm font-medium text-muted-foreground">Sleep stages</h2>
      <div className="px-2 pb-3" role="img" aria-label="Daily sleep stage totals chart">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <XAxis dataKey="date" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis hide />
            <Tooltip
              formatter={(value) => fmt(typeof value === 'number' ? value : Number(value))}
              cursor={{ fillOpacity: 0.05 }}
              contentStyle={{ fontSize: 12 }}
            />
            <Bar dataKey="Deep"  stackId="s" fill={STAGE_FILLS.deep} />
            <Bar dataKey="REM"   stackId="s" fill={STAGE_FILLS.rem} />
            <Bar dataKey="Core"  stackId="s" fill={STAGE_FILLS.core} />
            <Bar dataKey="Awake" stackId="s" fill={STAGE_FILLS.awake} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function HrvSparkline({ data }: { data: SleepSummaryResult }) {
  if (!data.hrv || data.hrv.window_avg == null) return null;
  const nights = (data.nights ?? []).slice().reverse();
  // Sparkline is decorative when we don't have per-night HRV; render the
  // window/baseline pair as a degenerate two-point line until we wire daily
  // HRV per wake_date.
  const points = nights.length >= 2
    ? nights.map((_, i) => ({ x: i, hrv: data.hrv!.window_avg! }))
    : [
        { x: 0, hrv: data.hrv.baseline_30d_avg ?? data.hrv.window_avg },
        { x: 1, hrv: data.hrv.window_avg },
      ];
  return (
    <section className="ios-section">
      <h2 className="px-4 pt-3 pb-1 text-sm font-medium text-muted-foreground">HRV trend</h2>
      <div className="px-2 pb-3" role="img" aria-label="HRV trend sparkline">
        <ResponsiveContainer width="100%" height={80}>
          <LineChart data={points} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <Line type="monotone" dataKey="hrv" stroke="#10b981" strokeWidth={2} dot={false} />
            <YAxis hide domain={['dataMin - 5', 'dataMax + 5']} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// ── Side-cards (loading / not-connected / error) ────────────────────────────

function SkeletonCards() {
  return (
    <>
      <section className="ios-section">
        <div className="px-4 py-6 space-y-3 animate-pulse">
          <div className="h-7 w-20 bg-muted rounded" />
          <div className="h-4 w-32 bg-muted rounded" />
          <div className="h-3 w-full bg-muted rounded-full" />
        </div>
      </section>
      <section className="ios-section">
        <div className="px-4 py-6 space-y-2 animate-pulse">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-4 bg-muted rounded" />)}
        </div>
      </section>
    </>
  );
}

function NotConnectedCard() {
  return (
    <section className="ios-section">
      <div className="px-4 py-6 space-y-2">
        <p className="text-sm font-medium">HealthKit isn&apos;t connected</p>
        <p className="text-xs text-muted-foreground">
          Open Rebirth → Settings → Apple Health to connect HealthKit data.
        </p>
        <Link href="/settings" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
          Go to Settings →
        </Link>
      </div>
    </section>
  );
}

function ErrorCard({ error }: { error: SleepSummaryError }) {
  return (
    <section className="ios-section border-amber-500/30">
      <div className="px-4 py-4 space-y-1">
        <p className="text-sm font-medium">{error.message}</p>
        <p className="text-xs text-muted-foreground">{error.hint}</p>
      </div>
    </section>
  );
}
