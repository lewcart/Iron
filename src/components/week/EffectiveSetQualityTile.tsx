'use client';

import type { EffectiveSetQualityTileData } from '@/lib/api/resolveWeekTiles';
import { TrendSparkline } from './TrendSparkline';

/** Tile 2 — Effective-Set Quality (% of sets at RIR ≤ 3 this week). */
export function EffectiveSetQualityTile({ data }: { data: EffectiveSetQualityTileData }) {
  const tone = data.quality_pct >= 70
    ? 'text-emerald-600 dark:text-emerald-400'
    : data.quality_pct >= 50
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-red-600 dark:text-red-400';

  const sparkValues = data.history.map(h => h.quality_pct);

  return (
    <section
      className="rounded-2xl bg-card border border-border shadow-sm p-4"
      aria-label={`Effective set quality: ${data.quality_pct}% of sets at RIR 3 or less, ${data.rir_logged_sets} of ${data.total_sets} sets logged`}
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-primary">
        Effective-Set Quality
      </span>

      <div className="mt-2 flex items-baseline gap-2">
        <span className={`text-3xl font-bold tabular-nums ${tone}`}>
          {data.quality_pct}%
        </span>
        <span className="text-xs text-muted-foreground">at RIR ≤ 3</span>
      </div>
      <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
        {data.rir_quality_sets} of {data.rir_logged_sets} logged sets
        {data.total_sets > data.rir_logged_sets && (
          <> · {data.total_sets - data.rir_logged_sets} unlogged</>
        )}
      </div>

      {sparkValues.length >= 2 && (
        <div className="h-8 w-full mt-3">
          <TrendSparkline
            values={sparkValues}
            ariaLabel={`Effective set quality over last ${sparkValues.length} weeks`}
            minSamples={2}
          />
        </div>
      )}

      <p className="mt-3 text-[10px] text-muted-foreground leading-snug">
        When this drops, your &quot;volume&quot; overstates your actual hypertrophy stimulus.
      </p>
    </section>
  );
}
