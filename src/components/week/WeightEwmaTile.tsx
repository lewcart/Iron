'use client';

import { useState } from 'react';
import type { WeightEwmaTileData } from '@/lib/api/resolveWeekTiles';
import { TrendSparkline } from './TrendSparkline';

/** Tile 5 — Bodyweight EWMA (Hacker's Diet 0.1 alpha). */
export function WeightEwmaTile({ data }: { data: WeightEwmaTileData }) {
  const [showRaw, setShowRaw] = useState(false);

  const sparkValues = data.series.map(p => p.ewma);
  const deltaTone = data.delta_28d_kg == null
    ? 'text-muted-foreground'
    : data.delta_28d_kg < 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : data.delta_28d_kg > 0
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-muted-foreground';

  return (
    <section
      className="rounded-2xl bg-card border border-border shadow-sm p-4"
      aria-label={`Smoothed bodyweight ${data.current_ewma.toFixed(1)} kg, ${data.delta_28d_kg != null ? `${data.delta_28d_kg > 0 ? '+' : ''}${data.delta_28d_kg.toFixed(1)} kg over 28 days` : 'delta unavailable'}`}
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-primary">
        Weight EWMA
      </span>
      <div className="text-[10px] text-muted-foreground mt-0.5">
        10-day smoothed — not today&apos;s number
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="text-3xl font-bold tabular-nums text-foreground">
          {data.current_ewma.toFixed(1)}
          <span className="text-base text-muted-foreground ml-0.5 font-normal">kg</span>
        </span>
        {data.delta_28d_kg != null && (
          <span className={`text-sm tabular-nums ${deltaTone}`}>
            {data.delta_28d_kg > 0 ? '+' : ''}{data.delta_28d_kg.toFixed(1)} kg / 28d
          </span>
        )}
      </div>

      <div className="h-10 w-full mt-3">
        <TrendSparkline
          values={sparkValues}
          ariaLabel="Bodyweight EWMA sparkline"
          minSamples={3}
        />
      </div>

      <button
        onClick={() => setShowRaw(!showRaw)}
        className="mt-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
        aria-expanded={showRaw}
      >
        {showRaw ? 'Hide raw values' : 'Show raw values'}
      </button>

      {showRaw && (
        <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] tabular-nums">
          {data.raw.slice(-10).reverse().map((p, i) => (
            <div key={`${p.date}-${i}`} className="flex justify-between">
              <span className="text-muted-foreground">{p.date.slice(5)}</span>
              <span className="text-foreground">{p.weight.toFixed(1)} kg</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
