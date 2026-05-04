'use client';

/**
 * Section B of the Week page — 12-week trends.
 *
 * Five rows; the first four are tappable and open a TrendDetailModal with
 * a full-width chart, axis labels, the actual numbers, and the rule that
 * triggered the metric. Each row also surfaces an inline DIRECTION CHIP
 * (↗ +12%, → flat, ↘ -3%) so Lou can read the headline without opening
 * the detail. (This addresses Lou's V1.1 feedback that the bare
 * sparklines were too hard to interpret.)
 *
 * Rows:
 *   (a) priority-muscle effective sets per week
 *   (b) anchor-lift e1RM trends
 *   (c) bodyweight EWMA (90-day)
 *   (d) HRV 7-day mean vs 28-day baseline (band overlay)
 *   (e) weekly compliance % — empty state for now (data not available);
 *       rendered as a non-tappable note instead of an action row.
 */

import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { TrendSparkline } from './TrendSparkline';
import {
  TrendDetailModal,
  summarizeDirection,
  summarizeHrvBand,
  type TrendDetailSeries,
} from './TrendDetailModal';

export interface PriorityMuscleSeries {
  /** Canonical muscle slug (e.g. `delts`, `lats`). */
  slug: string;
  display_name: string;
  /** 12 entries (oldest → newest). Missing weeks are 0. */
  weekly: number[];
}

export interface AnchorLiftSeries {
  /** Anchor-lift display name (e.g. "Hip Thrust"). */
  display_name: string;
  /** Sparse session points keyed by ISO date — at least 4 to render. */
  sessions: { date: string; e1rm: number }[];
}

export interface BodyweightSeries {
  /** EWMA values (oldest → newest). 90-day window. */
  ewma: number[];
  /** Optional ISO YYYY-MM-DD per-point label aligned with `ewma`. */
  dates?: string[];
}

export interface HrvBalanceSeries {
  /** 7-day rolling mean per ISO date (oldest → newest). */
  rolling7: number[];
  /** Optional ISO YYYY-MM-DD per-point label aligned with `rolling7`. */
  dates?: string[];
  /** 28-day baseline mean used for band overlay (single number). */
  baseline28: number | null;
  /** SD of baseline, used to draw the ±1 SD band. */
  baselineSd: number | null;
}

export interface ComplianceSeries {
  /** Per-week % of planned effective sets executed. 12 entries. */
  weekly_pct: number[];
}

export interface TwelveWeekTrendsData {
  priorityMuscles: PriorityMuscleSeries[];
  anchorLifts: AnchorLiftSeries[];
  bodyweight: BodyweightSeries | null;
  hrv: HrvBalanceSeries | null;
  compliance: ComplianceSeries | null;
}

type DetailKey = 'priority' | 'anchor' | 'bodyweight' | 'hrv' | null;

export function TwelveWeekTrendsSection({ data }: { data: TwelveWeekTrendsData }) {
  const [open, setOpen] = useState<DetailKey>(null);

  // ── Direction summaries (for inline chips) ─────────────────────────
  const priorityDir = useMemo(() => {
    if (data.priorityMuscles.length === 0) return null;
    // Use the headline (first) priority muscle's % change as the section chip.
    return summarizeDirection(data.priorityMuscles[0].weekly);
  }, [data.priorityMuscles]);

  const anchorDir = useMemo(() => {
    if (data.anchorLifts.length === 0) return null;
    const first = data.anchorLifts[0];
    return summarizeDirection(first.sessions.map(s => s.e1rm));
  }, [data.anchorLifts]);

  const bwDir = useMemo(() => {
    if (!data.bodyweight || data.bodyweight.ewma.length === 0) return null;
    return summarizeDirection(data.bodyweight.ewma);
  }, [data.bodyweight]);

  const hrvDir = useMemo(() => {
    if (
      !data.hrv
      || data.hrv.baseline28 == null
      || data.hrv.baselineSd == null
      || data.hrv.rolling7.length < 7
    ) return null;
    return summarizeHrvBand(data.hrv.rolling7, [
      data.hrv.baseline28 - data.hrv.baselineSd,
      data.hrv.baseline28 + data.hrv.baselineSd,
    ]);
  }, [data.hrv]);

  // ── Modal series builders (only computed when modal opens) ──────────
  const priorityModalSeries = useMemo<TrendDetailSeries[]>(() => {
    return data.priorityMuscles.map(m => ({
      label: m.display_name,
      values: m.weekly,
      xLabels: m.weekly.map((_, i) => `W-${m.weekly.length - i - 1}`),
      unit: ' sets',
    }));
  }, [data.priorityMuscles]);

  const anchorModalSeries = useMemo<TrendDetailSeries[]>(() => {
    return data.anchorLifts.map(a => ({
      label: a.display_name,
      values: a.sessions.map(s => s.e1rm),
      xLabels: a.sessions.map(s => s.date),
      unit: 'kg',
    }));
  }, [data.anchorLifts]);

  const bwModalSeries = useMemo<TrendDetailSeries[]>(() => {
    if (!data.bodyweight) return [];
    return [{
      label: 'Bodyweight (EWMA)',
      values: data.bodyweight.ewma,
      xLabels: data.bodyweight.dates ?? data.bodyweight.ewma.map((_, i) => `D-${data.bodyweight!.ewma.length - i - 1}`),
      unit: 'kg',
    }];
  }, [data.bodyweight]);

  const hrvModalSeries = useMemo<TrendDetailSeries[]>(() => {
    if (!data.hrv) return [];
    return [{
      label: 'HRV (7-day mean)',
      values: data.hrv.rolling7,
      xLabels: data.hrv.dates ?? data.hrv.rolling7.map((_, i) => `D-${data.hrv!.rolling7.length - i - 1}`),
      unit: 'ms',
    }];
  }, [data.hrv]);

  const hrvBand: [number, number] | null =
    data.hrv && data.hrv.baseline28 != null && data.hrv.baselineSd != null
      ? [data.hrv.baseline28 - data.hrv.baselineSd, data.hrv.baseline28 + data.hrv.baselineSd]
      : null;

  return (
    <section
      className="rounded-2xl bg-card dark:bg-card border border-border dark:border-border shadow-sm p-4"
      aria-label="12-week trends"
    >
      <header className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-primary">
          12-Week Trends
        </span>
        <span className="text-[10px] text-muted-foreground">tap a row for detail</span>
      </header>

      <div className="mt-3 space-y-2">
        {/* (a) Priority muscles */}
        <TrendRow
          label="Priority muscles · sets / week"
          direction={priorityDir ? <DirectionChip {...priorityDir} /> : null}
          spark={data.priorityMuscles.length > 0
            ? <SparkInline values={data.priorityMuscles[0].weekly} ariaLabel={`${data.priorityMuscles[0].display_name} weekly sets sparkline`} minSamples={4} />
            : null}
          empty={data.priorityMuscles.length === 0
            ? 'Trends fill in as you log priority muscles.' : null}
          onTap={data.priorityMuscles.length > 0 ? () => setOpen('priority') : undefined}
        />

        {/* (b) Anchor lifts */}
        <TrendRow
          label="Anchor-lift e1RM"
          direction={anchorDir ? <DirectionChip {...anchorDir} /> : null}
          spark={data.anchorLifts.length > 0
            ? <SparkInline values={data.anchorLifts[0].sessions.map(s => s.e1rm)} ariaLabel={`${data.anchorLifts[0].display_name} e1RM sparkline`} minSamples={4} />
            : null}
          empty={data.anchorLifts.length === 0
            ? 'Log a few sessions on your anchor lifts to see strength trends.' : null}
          onTap={data.anchorLifts.length > 0 ? () => setOpen('anchor') : undefined}
        />

        {/* (c) Bodyweight EWMA 90-day */}
        <TrendRow
          label="Bodyweight EWMA · 90 day"
          direction={bwDir ? <DirectionChip {...bwDir} suffix="kg" /> : null}
          spark={data.bodyweight && data.bodyweight.ewma.length >= 7
            ? <SparkInline values={data.bodyweight.ewma} ariaLabel="Bodyweight EWMA sparkline" minSamples={7} />
            : null}
          empty={!data.bodyweight || data.bodyweight.ewma.length === 0
            ? 'Need more weigh-ins to draw the 90-day curve.' : null}
          onTap={data.bodyweight && data.bodyweight.ewma.length >= 7 ? () => setOpen('bodyweight') : undefined}
        />

        {/* (d) HRV 7-day vs 28-day baseline */}
        <TrendRow
          label="HRV · 7-day mean vs 28-day baseline"
          direction={hrvDir ? <BandChip text={hrvDir.text} tone={hrvDir.tone} /> : null}
          spark={(hrvBand && data.hrv && data.hrv.rolling7.length >= 7)
            ? <SparkInline values={data.hrv.rolling7} band={hrvBand} ariaLabel="HRV vs baseline band sparkline" minSamples={7} />
            : null}
          empty={!hrvBand || !data.hrv || data.hrv.rolling7.length < 7
            ? 'HRV baseline still calibrating — needs more days from Apple Health.' : null}
          onTap={hrvBand && data.hrv && data.hrv.rolling7.length >= 7 ? () => setOpen('hrv') : undefined}
        />

        {/* (e) Weekly compliance — non-tappable note (data not available V1) */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Weekly compliance · sets executed vs plan
          </div>
          <p className="text-[11px] italic text-muted-foreground leading-snug">
            {data.compliance == null || data.compliance.weekly_pct.length === 0
              ? 'Compliance trend will appear once a plan is active and sets are logged.'
              : `Average ${Math.round(data.compliance.weekly_pct.reduce((a, b) => a + b, 0) / data.compliance.weekly_pct.length)}%`}
          </p>
        </div>
      </div>

      {/* ── Detail modals ── */}
      <TrendDetailModal
        open={open === 'priority'}
        onClose={() => setOpen(null)}
        title="Priority muscles · sets / week"
        series={priorityModalSeries}
        rule="Effective working sets per week. Primary muscle credit 1.0, secondary 0.5, then RIR-weighted (RIR 0–3 = 1.0, 4 = 0.5, 5+ = 0.0). Last 12 weeks."
      />
      <TrendDetailModal
        open={open === 'anchor'}
        onClose={() => setOpen(null)}
        title="Anchor-lift e1RM"
        series={anchorModalSeries}
        rule="Estimated 1RM per session, computed via Epley (weight × (1 + reps/30)). Best e1RM across working sets per workout date is the point. Last 12 weeks."
      />
      <TrendDetailModal
        open={open === 'bodyweight'}
        onClose={() => setOpen(null)}
        title="Bodyweight EWMA · 90 day"
        series={bwModalSeries}
        rule="Hacker's Diet 0.1 EWMA. Strips ~0.3–1.5 lb daily noise to expose the true ~0.3 lb/day max fat-change signal. Today's raw number isn't shown — the smoothed curve is the truth."
      />
      <TrendDetailModal
        open={open === 'hrv'}
        onClose={() => setOpen(null)}
        title="HRV · 7-day mean vs 28-day baseline"
        series={hrvModalSeries}
        band={hrvBand}
        rule="HRV 7-day rolling mean (line) vs 28-day baseline ± 1 SD (shaded band). 'In band' = within ±1 SD of personal baseline; below the band for multiple days suggests accumulated fatigue."
      />
    </section>
  );
}

// ─── Row primitives ──────────────────────────────────────────────────

function TrendRow({
  label,
  direction,
  spark,
  empty,
  onTap,
}: {
  label: string;
  direction: React.ReactNode;
  spark: React.ReactNode;
  empty: string | null;
  onTap?: () => void;
}) {
  const labelEl = (
    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
      {label}
    </div>
  );

  if (empty) {
    return (
      <div>
        {labelEl}
        <p className="text-[11px] italic text-muted-foreground leading-snug">{empty}</p>
      </div>
    );
  }

  // Tappable row → button. Aria-label includes the direction chip text.
  return (
    <button
      type="button"
      onClick={onTap}
      className="w-full text-left rounded-lg hover:bg-muted/40 active:bg-muted/60 transition-colors p-2 -m-2 min-h-[44px]"
      aria-label={`${label} — open detail`}
    >
      {labelEl}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-6 min-w-0">{spark}</div>
        <div className="flex items-center gap-1 shrink-0">
          {direction}
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
        </div>
      </div>
    </button>
  );
}

function SparkInline({
  values,
  band,
  ariaLabel,
  minSamples,
}: {
  values: readonly number[];
  band?: [number, number] | null;
  ariaLabel: string;
  minSamples: number;
}) {
  return (
    <TrendSparkline
      values={values}
      band={band ?? null}
      ariaLabel={ariaLabel}
      minSamples={minSamples}
    />
  );
}

function DirectionChip({
  arrow,
  text,
  tone,
  suffix,
}: {
  arrow: '↗' | '↘' | '→';
  text: string;
  tone: 'pos' | 'neg' | 'flat';
  suffix?: string;
}) {
  // For bodyweight rows the suffix renders differently — append to text.
  const display = suffix && text !== 'flat' && text !== '—' ? `${text}${suffix}` : text;
  const cls =
    tone === 'pos'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'neg'
      ? 'text-red-600 dark:text-red-400'
      : 'text-muted-foreground';
  return (
    <span className={`text-[11px] tabular-nums font-medium whitespace-nowrap ${cls}`}>
      {arrow} {display}
    </span>
  );
}

function BandChip({ text, tone }: { text: string; tone: 'pos' | 'neg' | 'flat' }) {
  const cls =
    tone === 'pos'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'neg'
      ? 'text-red-600 dark:text-red-400'
      : 'text-muted-foreground';
  return (
    <span className={`text-[11px] tabular-nums font-medium whitespace-nowrap ${cls}`}>
      {text}
    </span>
  );
}
