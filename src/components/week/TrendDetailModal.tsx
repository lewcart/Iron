'use client';

/**
 * TrendDetailModal — drill-in for a row in the 12-Week Trends section.
 *
 * Lou's V1.1 feedback: the inline sparklines are hard to interpret. Each
 * trend row now renders a direction chip (↗ +12%, → flat, ↘ -3%) and is
 * tappable; opening the modal shows a full-width chart with axis labels,
 * the actual numbers, and the rule that triggered the metric.
 *
 * Generic so we can reuse it across all four trend rows (priority muscles,
 * anchor lifts, bodyweight EWMA, HRV balance). Compliance is
 * non-tappable for V1 (data not available).
 */

import { Sheet } from '@/components/ui/sheet';

export interface TrendDetailSeries {
  /** Series label rendered in the legend (e.g. "Glutes" or "Hip Thrust"). */
  label: string;
  /** X labels (one per value) — typically week-start ISO dates or
   *  workout-date ISO dates. Must be same length as values. */
  xLabels: string[];
  /** Numeric values, oldest → newest. */
  values: number[];
  /** Optional unit suffix (e.g. "kg", "ms", "sets"). */
  unit?: string;
}

export interface TrendDetailModalProps {
  open: boolean;
  onClose: () => void;
  /** Title rendered at the top of the sheet (e.g. "HRV · 7-day mean"). */
  title: string;
  /** One or more series to overlay/stack. Single-series renders one line;
   *  multi-series renders a stacked legend with each series labelled. */
  series: TrendDetailSeries[];
  /** Optional band overlay [lo, hi] — used for HRV ±1 SD. */
  band?: [number, number] | null;
  /** Plain-language explanation of the metric ("HRV 7-day mean vs 28-day
   *  baseline; in band when within ±1 SD"). Always include — Lou's whole
   *  point is the inline sparkline doesn't say what the line MEANS. */
  rule: string;
}

export function TrendDetailModal({
  open,
  onClose,
  title,
  series,
  band,
  rule,
}: TrendDetailModalProps) {
  // Compute combined Y bounds across all series + band.
  const allValues: number[] = [];
  for (const s of series) {
    for (const v of s.values) {
      if (Number.isFinite(v)) allValues.push(v);
    }
  }
  if (band && Number.isFinite(band[0]) && Number.isFinite(band[1])) {
    allValues.push(band[0], band[1]);
  }

  const hasData = allValues.length > 0;

  return (
    <Sheet open={open} onClose={onClose} title={title} height="auto">
      <div className="px-4 py-4 space-y-4">
        {/* Rule explanation — the why */}
        <p className="text-xs text-muted-foreground leading-snug">{rule}</p>

        {!hasData ? (
          <p className="text-sm italic text-muted-foreground">
            No data to chart yet.
          </p>
        ) : (
          <>
            {/* Full-width chart */}
            <div className="rounded-xl bg-muted/30 border border-border p-3">
              <FullChart series={series} band={band} />
            </div>

            {/* Per-series numbers panel */}
            <div className="space-y-3">
              {series.map((s, i) => (
                <SeriesNumbers key={i} series={s} />
              ))}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

function FullChart({
  series,
  band,
}: {
  series: TrendDetailSeries[];
  band?: [number, number] | null;
}) {
  // Layout constants — chart fills the modal width via 100% SVG, with a
  // fixed aspect ratio chosen to read well on both phones (375px wide)
  // and desktop (~600px wide).
  const W = 600;
  const H = 200;
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 8;
  const PAD_B = 24;
  const PLOT_W = W - PAD_L - PAD_R;
  const PLOT_H = H - PAD_T - PAD_B;

  const allValues: number[] = [];
  for (const s of series) for (const v of s.values) if (Number.isFinite(v)) allValues.push(v);
  const safeBand: [number, number] | null =
    band && Number.isFinite(band[0]) && Number.isFinite(band[1]) ? [band[0], band[1]] : null;
  if (safeBand) allValues.push(safeBand[0], safeBand[1]);

  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const range = maxV - minV || 1;

  // Y axis: 4 evenly-spaced ticks.
  const ticks = [0, 1, 2, 3].map(i => minV + (range * i) / 3);
  const toY = (v: number) => PAD_T + PLOT_H - ((v - minV) / range) * PLOT_H;

  // X axis: pick at most ~6 evenly-spaced labels from the longest series
  // so it doesn't overflow on mobile.
  const longest = series.reduce(
    (acc, s) => (s.values.length > acc.length ? s.values : acc),
    series[0]?.values ?? [],
  );
  const xLabels = series.find(s => s.values.length === longest.length)?.xLabels ?? [];
  const xStep = longest.length > 1 ? PLOT_W / (longest.length - 1) : 0;

  const labelEvery = Math.max(1, Math.ceil(longest.length / 6));

  // Color palette per series (Tailwind text-* classes used as currentColor).
  const STROKES = [
    'text-trans-blue',
    'text-trans-pink',
    'text-emerald-500',
    'text-amber-500',
  ];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full h-44"
      role="img"
      aria-label="Full trend chart"
    >
      {/* Y axis grid + tick labels */}
      {ticks.map((tv, i) => (
        <g key={i}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={toY(tv)}
            y2={toY(tv)}
            className="stroke-current text-muted-foreground/15"
            strokeWidth={1}
          />
          <text
            x={PAD_L - 4}
            y={toY(tv) + 3}
            textAnchor="end"
            className="fill-current text-muted-foreground"
            fontSize={9}
          >
            {Math.round(tv * 10) / 10}
          </text>
        </g>
      ))}

      {/* Band overlay (HRV ±1 SD) */}
      {safeBand && (
        <rect
          x={PAD_L}
          y={toY(safeBand[1])}
          width={PLOT_W}
          height={toY(safeBand[0]) - toY(safeBand[1])}
          className="fill-current text-trans-blue/10"
        />
      )}

      {/* Series lines */}
      {series.map((s, sIdx) => {
        const color = STROKES[sIdx % STROKES.length];
        const points = s.values.filter(v => Number.isFinite(v));
        if (points.length < 2) return null;
        // Map ALL values, even if the series is shorter than `longest`.
        const seriesXStep = points.length > 1 ? PLOT_W / (points.length - 1) : 0;
        const path = points
          .map((v, i) => `${i === 0 ? 'M' : 'L'}${(PAD_L + i * seriesXStep).toFixed(2)},${toY(v).toFixed(2)}`)
          .join(' ');
        return (
          <path
            key={sIdx}
            d={path}
            fill="none"
            className={`${color} stroke-current`}
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}

      {/* X axis labels */}
      {xLabels.map((lbl, i) => {
        if (i % labelEvery !== 0 && i !== xLabels.length - 1) return null;
        return (
          <text
            key={i}
            x={PAD_L + i * xStep}
            y={H - 6}
            textAnchor="middle"
            className="fill-current text-muted-foreground"
            fontSize={9}
          >
            {formatShortLabel(lbl)}
          </text>
        );
      })}
    </svg>
  );
}

function SeriesNumbers({ series }: { series: TrendDetailSeries }) {
  const finite = series.values.filter(v => Number.isFinite(v));
  if (finite.length === 0) return null;
  const first = finite[0];
  const last = finite[finite.length - 1];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const delta = last - first;
  const deltaPct = first !== 0 ? (delta / first) * 100 : 0;
  const unit = series.unit ?? '';
  const fmt = (n: number) => `${Math.round(n * 10) / 10}${unit}`;
  const tone =
    delta > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : delta < 0
      ? 'text-red-600 dark:text-red-400'
      : 'text-muted-foreground';
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs">
      <div className="font-semibold text-foreground mb-1">{series.label}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums text-muted-foreground">
        <div>First: <span className="text-foreground">{fmt(first)}</span></div>
        <div>Latest: <span className="text-foreground">{fmt(last)}</span></div>
        <div>Min: <span className="text-foreground">{fmt(min)}</span></div>
        <div>Max: <span className="text-foreground">{fmt(max)}</span></div>
        <div className="col-span-2">
          Change: <span className={tone}>
            {delta > 0 ? '+' : ''}{fmt(delta)} ({delta > 0 ? '+' : ''}{deltaPct.toFixed(1)}%)
          </span>
        </div>
      </div>
    </div>
  );
}

function formatShortLabel(s: string): string {
  // ISO date YYYY-MM-DD → "M/d" for axis labels.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return `${month}/${day}`;
}

/** Compute a direction summary for an arbitrary numeric series (oldest →
 *  newest). Returns the % change between the first and last finite value
 *  rounded to 1 decimal, plus an arrow glyph and a tone class for the
 *  caller to render as an inline chip. */
export function summarizeDirection(values: readonly number[]): {
  arrow: '↗' | '↘' | '→';
  pct: number;
  tone: 'pos' | 'neg' | 'flat';
  text: string;
} {
  const finite = values.filter(v => Number.isFinite(v));
  if (finite.length < 2) return { arrow: '→', pct: 0, tone: 'flat', text: '—' };
  const first = finite[0];
  const last = finite[finite.length - 1];
  if (first === 0) {
    // Can't compute %; report absolute direction only.
    if (last > 0) return { arrow: '↗', pct: 0, tone: 'pos', text: `+${(last - first).toFixed(1)}` };
    if (last < 0) return { arrow: '↘', pct: 0, tone: 'neg', text: `${(last - first).toFixed(1)}` };
    return { arrow: '→', pct: 0, tone: 'flat', text: 'flat' };
  }
  const pct = Math.round(((last - first) / Math.abs(first)) * 1000) / 10;
  // 1% deadzone — small drift on noisy series shouldn't read as movement.
  if (Math.abs(pct) < 1) return { arrow: '→', pct, tone: 'flat', text: 'flat' };
  if (pct > 0) return { arrow: '↗', pct, tone: 'pos', text: `+${pct.toFixed(1)}%` };
  return { arrow: '↘', pct, tone: 'neg', text: `${pct.toFixed(1)}%` };
}

/** Direction summary for HRV: "X / 12 wk in band". Argument is the
 *  rolling-7-day series + the band edges. */
export function summarizeHrvBand(
  values: readonly number[],
  band: readonly [number, number],
): { text: string; tone: 'pos' | 'neg' | 'flat' } {
  if (values.length === 0) return { text: '—', tone: 'flat' };
  let inBand = 0;
  for (const v of values) {
    if (Number.isFinite(v) && v >= band[0] && v <= band[1]) inBand++;
  }
  const total = values.filter(v => Number.isFinite(v)).length;
  const pct = total > 0 ? inBand / total : 0;
  return {
    text: `${inBand} / ${total} in band`,
    tone: pct >= 0.7 ? 'pos' : pct <= 0.3 ? 'neg' : 'flat',
  };
}
