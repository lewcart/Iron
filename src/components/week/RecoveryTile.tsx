'use client';

import type { RecoveryTileData } from '@/lib/api/resolveWeekTiles';
import { AlertTriangle } from 'lucide-react';

/** Tile 4 — Recovery: HRV vs personal baseline + sleep avg. */
export function RecoveryTile({ data }: { data: RecoveryTileData }) {
  if (data.hrv.status !== 'ok') {
    // resolveWeekTiles already gates this — defensive fallback only.
    return null;
  }
  const hrv = data.hrv;

  const hrvTone = hrv.state === 'in-band'
    ? 'text-emerald-600 dark:text-emerald-400'
    : hrv.state === 'above'
    ? 'text-trans-blue'
    : 'text-amber-600 dark:text-amber-400';

  const hrvArrow = hrv.state === 'above' ? '↗' : hrv.state === 'below' ? '↘' : '→';

  const sleepAvgHm = data.sleep.avg_min != null ? minToHm(data.sleep.avg_min) : null;
  const sleepBaseHm = data.sleep.baseline_min != null ? minToHm(data.sleep.baseline_min) : null;

  return (
    <section
      className="rounded-2xl bg-card border border-border shadow-sm p-4"
      aria-label={`Recovery: HRV ${hrv.window_mean.toFixed(0)} ms ${stateAriaText(hrv.state)} band, sleep average ${sleepAvgHm ?? 'unavailable'}`}
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-primary">
        Recovery
      </span>

      <div className="mt-3 space-y-2.5">
        <div
          className="flex items-baseline justify-between gap-2"
          aria-label={`HRV 7-day mean ${hrv.window_mean.toFixed(0)} ms vs 28-day baseline ${hrv.baseline_mean.toFixed(0)} ms`}
        >
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="text-xs text-muted-foreground">HRV</span>
            <span className={`text-base font-semibold tabular-nums ${hrvTone}`}>
              {hrv.window_mean.toFixed(0)}
              <span className="text-[10px] text-muted-foreground ml-0.5 font-normal">ms</span>
            </span>
          </div>
          <span className={`text-[11px] tabular-nums ${hrvTone}`}>
            {hrvArrow} {stateLabel(hrv.state)}
          </span>
        </div>

        {sleepAvgHm && (
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-xs text-muted-foreground">Sleep avg</span>
              <span className="text-base font-semibold tabular-nums text-foreground">
                {sleepAvgHm}
              </span>
            </div>
            {sleepBaseHm && data.sleep.delta_min != null && (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                vs {sleepBaseHm} baseline
              </span>
            )}
          </div>
        )}
      </div>

      {data.twoSignalsDown && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" strokeWidth={2} />
          <p className="text-xs text-amber-900 dark:text-amber-100 leading-snug">
            Two signals down → consider an easier session today.
          </p>
        </div>
      )}

      <p className="mt-3 text-[10px] text-muted-foreground leading-snug">
        Your baseline, not Whoop&apos;s. ±1 SD band over {hrv.baseline_days} days.
      </p>
    </section>
  );
}

function minToHm(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function stateLabel(state: 'above' | 'in-band' | 'below'): string {
  switch (state) {
    case 'above':   return 'above band';
    case 'in-band': return 'in band';
    case 'below':   return 'below band';
  }
}

function stateAriaText(state: 'above' | 'in-band' | 'below'): string {
  return state === 'in-band' ? 'within' : state;
}
