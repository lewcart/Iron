'use client';

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import { rebirthJsonHeaders } from '@/lib/api/headers';
import type { SummaryDay } from '@/lib/nutrition-history-types';
import type { MacroBands } from '@/db/local';

const RANGES = ['week', 'month', 'all'] as const;
type Range = (typeof RANGES)[number];

interface SummaryResponse {
  range: Range;
  days: SummaryDay[];
  targets: {
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    bands: MacroBands;
  } | null;
  derived: {
    adherence_pct: number | null;
    streak_days: number;
    approval_counts: { approved: number; auto_logged: number; missed: number };
  };
}

export default function NutritionSummaryPage() {
  const [range, setRange] = useState<Range>('week');
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/nutrition/summary?range=${range}`, { headers: rebirthJsonHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: SummaryResponse | null) => {
        if (!cancelled) setData(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="tab-content max-w-3xl mx-auto px-4 pt-4 pb-24 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-heading">Summary</h1>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={
                range === r
                  ? 'h-8 px-3 rounded-full bg-foreground text-background text-xs font-semibold capitalize'
                  : 'h-8 px-3 rounded-full bg-muted/40 text-xs hover:bg-muted capitalize'
              }
            >
              {r}
            </button>
          ))}
        </div>
      </header>

      {loading && <div className="text-sm text-muted-foreground">Loading summary…</div>}

      {!loading && data && data.days.filter((d) => d.has_data).length < 1 && (
        <div className="text-center text-sm text-muted-foreground py-12">
          Need data to show summary — log some meals first.
        </div>
      )}

      {!loading && data && data.days.filter((d) => d.has_data).length >= 1 && (
        <>
          <div className="ios-section p-4 grid grid-cols-3 gap-4 text-center">
            <Stat
              label="Adherence"
              value={
                data.derived.adherence_pct != null
                  ? `${data.derived.adherence_pct}%`
                  : '—'
              }
              hint="of days in band"
            />
            <Stat
              label="Streak"
              value={`${data.derived.streak_days}d`}
              hint="consecutive in band"
            />
            <Stat
              label="Approvals"
              value={
                <span className="text-base">
                  <span className="text-emerald-500">{data.derived.approval_counts.approved}</span>
                  {' · '}
                  <span className="text-muted-foreground">
                    {data.derived.approval_counts.auto_logged}
                  </span>
                </span>
              }
              hint="reviewed · logged"
            />
          </div>

          <DailyMacrosChart days={data.days} targets={data.targets} />

          {data.targets && (
            <div className="ios-section p-4 grid grid-cols-4 gap-2">
              <MacroAvg
                label="Cal"
                avg={
                  avgOf(
                    data.days.map((d) => d.calories),
                    data.days.map((d) => d.has_data),
                  )
                }
                target={data.targets.calories}
              />
              <MacroAvg
                label="Pro"
                avg={avgOf(data.days.map((d) => d.protein_g), data.days.map((d) => d.has_data))}
                target={data.targets.protein_g}
                unit="g"
              />
              <MacroAvg
                label="Carb"
                avg={avgOf(data.days.map((d) => d.carbs_g), data.days.map((d) => d.has_data))}
                target={data.targets.carbs_g}
                unit="g"
              />
              <MacroAvg
                label="Fat"
                avg={avgOf(data.days.map((d) => d.fat_g), data.days.map((d) => d.has_data))}
                target={data.targets.fat_g}
                unit="g"
              />
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Adherence reflects your <em>current</em> goals. Days with no data are excluded.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums my-0.5">{value}</div>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function MacroAvg({
  label,
  avg,
  target,
  unit,
}: {
  label: string;
  avg: number | null;
  target: number | null;
  unit?: string;
}) {
  return (
    <div className="text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">
        {avg != null ? Math.round(avg) : '—'}
      </div>
      <div className="text-[10px] text-muted-foreground">
        / {target != null ? Math.round(target) : '—'}
        {unit ?? ''}
      </div>
    </div>
  );
}

function avgOf(values: (number | null)[], hasData: boolean[]): number | null {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!hasData[i] || v == null) continue;
    sum += v;
    count++;
  }
  return count === 0 ? null : sum / count;
}

function DailyMacrosChart({
  days,
  targets,
}: {
  days: SummaryDay[];
  targets: SummaryResponse['targets'];
}) {
  // Order chronologically for the chart (response is descending).
  const chronological = [...days].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="ios-section p-3">
      <div className="text-xs font-semibold mb-2 text-muted-foreground px-1">
        Calories vs goal
      </div>
      <div className="h-48">
        <ResponsiveContainer>
          <LineChart data={chronological}>
            <CartesianGrid stroke="rgba(127,127,127,0.15)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(s: string) => s.slice(5)}
              fontSize={10}
              stroke="currentColor"
              opacity={0.5}
            />
            <YAxis
              fontSize={10}
              stroke="currentColor"
              opacity={0.5}
              width={32}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--background, #111)',
                border: '1px solid rgba(127,127,127,0.3)',
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Line
              type="monotone"
              dataKey="calories"
              stroke="rgb(16,185,129)"
              dot={false}
              strokeWidth={2}
              name="Calories"
            />
            {targets?.calories != null && (
              <ReferenceLine
                y={targets.calories}
                stroke="rgba(16,185,129,0.5)"
                strokeDasharray="3 3"
                label={{ value: 'Goal', fontSize: 10, fill: 'rgba(16,185,129,0.7)' }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
