'use client';

/**
 * CardioComplianceTile (Week page v1.1, slot 4).
 *
 * Renders cardio-week compliance from the `/api/health/cardio-week` route.
 * Self-decides whether to render anything based on:
 *
 *   - response is null (loading)              → skeleton
 *   - response.status === 'not_connected' AND any cardio target IS set on
 *     the active body_plan                    → "Connect HealthKit" CTA
 *   - response.status === 'no_targets'        → render nothing (silent)
 *   - response.status === 'ok' AND targets.split → split rows
 *   - response.status === 'ok' AND umbrella only → single ring
 *
 * HR-zone classification was dropped during /autoplan eng review (workout-
 * avg HR misclassifies HIIT). Activity-type classification is silent — no
 * "estimated" caveat in UI per design spec.
 */

import Link from 'next/link';
import { Activity } from 'lucide-react';

export interface CardioTileResponse {
  status: 'ok' | 'no_targets' | 'not_connected';
  range?: { start_date: string; end_date: string };
  totals?: { zone2: number; intervals: number; total: number };
  targets?: {
    total: number | null;
    zone2: number | null;
    intervals: number | null;
    any_set: boolean;
    split: boolean;
  };
  daily?: { date: string; zone2_minutes: number; intervals_minutes: number }[];
  message?: string;
  reason?: string;
}

export interface CardioComplianceTileProps {
  /** Response from /api/health/cardio-week (null while loading). */
  data: CardioTileResponse | null;
}

export function CardioComplianceTile({ data }: CardioComplianceTileProps) {
  // Loading: skeleton tile sized similar to the rest of Section A.
  if (data === null) {
    return (
      <div
        className="rounded-2xl bg-muted/40 dark:bg-muted/20 border border-border h-32 animate-pulse"
        aria-hidden
      />
    );
  }

  // No targets set on the active body_plan → silent (no tile, no CTA).
  if (data.status === 'no_targets') {
    return null;
  }

  // HealthKit not connected → only render the CTA if the underlying status
  // implies cardio targets MIGHT exist (we can't know for sure when HK is
  // disconnected, so we defensively render the CTA so Lou notices).
  if (data.status === 'not_connected') {
    return (
      <section
        className="rounded-2xl bg-card border border-border shadow-sm p-4"
        aria-label="Cardio: HealthKit not connected"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-primary">
          Cardio
        </span>
        <div className="mt-3 flex items-start gap-3">
          <Activity className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" strokeWidth={1.75} />
          <div className="min-w-0">
            <p className="text-sm text-foreground leading-snug">
              Connect HealthKit to track cardio
            </p>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-primary hover:underline min-h-[44px] py-2"
            >
              Open Settings →
            </Link>
          </div>
        </div>
      </section>
    );
  }

  // status === 'ok' — happy path
  const targets = data.targets!;
  const totals = data.totals!;

  if (targets.split) {
    return <SplitMode totals={totals} targets={targets} />;
  }
  return <SingleMode totals={totals} target={targets.total ?? 0} />;
}

// ── Render modes ─────────────────────────────────────────────────────────

function SplitMode({
  totals,
  targets,
}: {
  totals: { zone2: number; intervals: number; total: number };
  targets: { zone2: number | null; intervals: number | null };
}) {
  // Each row only renders if its target is set. Per design spec: render only
  // the rows whose targets exist; if exactly one sub-target plus umbrella,
  // show the sub-row(s) and ignore umbrella.
  const rows: { label: string; minutes: number; target: number }[] = [];
  if (targets.zone2 != null) {
    rows.push({ label: 'Zone 2', minutes: totals.zone2, target: targets.zone2 });
  }
  if (targets.intervals != null) {
    rows.push({ label: 'Intervals', minutes: totals.intervals, target: targets.intervals });
  }

  return (
    <section
      className="rounded-2xl bg-card border border-border shadow-sm p-4"
      aria-label={`Cardio compliance: ${rows.map(r => `${r.label} ${Math.round(r.minutes)} of ${r.target} minutes`).join(', ')}`}
    >
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-primary">
          Cardio
        </span>
        <span className="text-[10px] text-muted-foreground">this week</span>
      </div>

      <div className="space-y-2.5">
        {rows.map(row => (
          <CardioRow
            key={row.label}
            label={row.label}
            minutes={row.minutes}
            target={row.target}
          />
        ))}
      </div>
    </section>
  );
}

function SingleMode({
  totals,
  target,
}: {
  totals: { zone2: number; intervals: number; total: number };
  target: number;
}) {
  const minutes = Math.round(totals.total);
  const targetMin = target;
  const pct = targetMin > 0 ? Math.min(100, (minutes / targetMin) * 100) : 0;
  const tone = toneFor(minutes, targetMin);

  return (
    <section
      className="rounded-2xl bg-card border border-border shadow-sm p-4"
      aria-label={`Cardio: ${minutes} of ${targetMin} minutes this week`}
    >
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-primary">
          Cardio
        </span>
        <span className="text-[10px] text-muted-foreground">this week</span>
      </div>

      <div className="flex items-center gap-4">
        <Ring pct={pct} tone={tone} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-1">
            <span className={`text-2xl font-semibold tabular-nums ${tone}`}>
              {minutes}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              / {targetMin}
            </span>
            <span className="text-[10px] text-muted-foreground ml-0.5">min</span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-tight">
            {minutes >= targetMin
              ? 'Target hit'
              : `${targetMin - minutes} min to target`}
          </p>
        </div>
      </div>
    </section>
  );
}

// ── Primitives ───────────────────────────────────────────────────────────

function CardioRow({
  label,
  minutes,
  target,
}: {
  label: string;
  minutes: number;
  target: number;
}) {
  const rounded = Math.round(minutes);
  const pct = target > 0 ? Math.min(100, (rounded / target) * 100) : 0;
  const tone = toneFor(rounded, target);

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-[70px] shrink-0">{label}</span>
      <span className={`text-sm font-semibold tabular-nums w-[90px] shrink-0 ${tone}`}>
        {rounded.toString().padStart(3, ' ')}
        <span className="text-muted-foreground font-normal">{` / ${target}`}</span>
        <span className="text-[10px] text-muted-foreground ml-0.5 font-normal">min</span>
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] ${barTone(rounded, target)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Ring({ pct, tone }: { pct: number; tone: string }) {
  // Simple SVG ring. 56pt diameter outer, 8pt stroke.
  const size = 56;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct / 100);
  const strokeColorClass = pct >= 100
    ? 'stroke-emerald-500 dark:stroke-emerald-400'
    : pct >= 60
    ? 'stroke-primary'
    : 'stroke-amber-500 dark:stroke-amber-400';
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      aria-hidden
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        className="stroke-muted"
        strokeWidth={stroke}
        fill="none"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        className={strokeColorClass}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

function toneFor(minutes: number, target: number): string {
  if (target <= 0) return 'text-muted-foreground';
  const pct = (minutes / target) * 100;
  if (pct >= 100) return 'text-emerald-600 dark:text-emerald-400';
  if (pct >= 60) return 'text-foreground';
  return 'text-amber-600 dark:text-amber-400';
}

function barTone(minutes: number, target: number): string {
  if (target <= 0) return 'bg-muted-foreground/40';
  const pct = (minutes / target) * 100;
  if (pct >= 100) return 'bg-emerald-500 dark:bg-emerald-400';
  if (pct >= 60) return 'bg-primary';
  return 'bg-amber-500 dark:bg-amber-400';
}
