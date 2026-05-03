'use client';

/**
 * Minimal SVG sparkline. Used by all 5 monthly trends + the weekly tiles.
 *
 * Inputs are deliberately raw numbers; the component handles range
 * normalization. Pass `band` to overlay a shaded ±SD region (HRV use case).
 *
 * Renders accessible alt text via `aria-label`.
 */

export interface TrendSparklineProps {
  values: readonly number[];
  /** Width × height in SVG units (CSS controls actual rendered size). */
  width?: number;
  height?: number;
  /** Optional shaded band [lo, hi] in the same units as values. */
  band?: [number, number] | null;
  /** Tailwind color class for the line stroke. Defaults to `text-trans-blue`. */
  stroke?: string;
  /** Tailwind color class for the band fill. Defaults to `text-trans-blue/15`. */
  bandFill?: string;
  /** Accessible label — always required. */
  ariaLabel: string;
  /** Min sample count required to render. Below this, returns the empty
   *  state ("trends fill in as you log…"). */
  minSamples?: number;
  /** Empty-state copy when below minSamples. */
  emptyText?: string;
}

export function TrendSparkline({
  values,
  width = 100,
  height = 32,
  band,
  stroke = 'text-trans-blue',
  bandFill = 'text-trans-blue/15',
  ariaLabel,
  minSamples = 4,
  emptyText,
}: TrendSparklineProps) {
  // Filter to only finite numeric values — guards against upstream NaN/null
  // sneaking into the bounds math (which would emit `NaN` for `y`/`height`
  // attributes and trigger a React warning + a blank chart). Same for band
  // edges below: if either edge is NaN, treat the band as absent rather than
  // attempt to render a `<rect>` with `y="NaN"`.
  const finiteValues = values.filter((v): v is number => Number.isFinite(v));

  if (finiteValues.length < minSamples) {
    return (
      <div
        className="text-[10px] text-muted-foreground italic leading-tight"
        role="img"
        aria-label={ariaLabel}
      >
        {emptyText ?? `Trends fill in as you log — ${finiteValues.length} so far`}
      </div>
    );
  }

  const safeBand: [number, number] | null =
    band && Number.isFinite(band[0]) && Number.isFinite(band[1])
      ? [band[0], band[1]]
      : null;

  // Compute bounds — include band edges if present.
  const allValues = safeBand ? [...finiteValues, safeBand[0], safeBand[1]] : finiteValues;
  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const range = maxV - minV || 1;

  const xStep = finiteValues.length > 1 ? width / (finiteValues.length - 1) : 0;

  const toY = (v: number) => height - ((v - minV) / range) * height;

  const linePath = finiteValues
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * xStep).toFixed(2)},${toY(v).toFixed(2)}`)
    .join(' ');

  const bandTop = safeBand ? toY(safeBand[1]) : 0;
  const bandHeight = safeBand ? toY(safeBand[0]) - toY(safeBand[1]) : 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full h-full"
      role="img"
      aria-label={ariaLabel}
    >
      {safeBand && (
        <rect
          x={0}
          y={bandTop}
          width={width}
          height={bandHeight}
          className={`${bandFill} fill-current`}
        />
      )}
      {/* Baseline */}
      <line
        x1={0}
        x2={width}
        y1={height}
        y2={height}
        className="text-muted-foreground/30 stroke-current"
        strokeWidth={0.5}
      />
      <path
        d={linePath}
        fill="none"
        className={`${stroke} stroke-current`}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
