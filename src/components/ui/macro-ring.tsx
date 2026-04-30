import { cn } from '@/lib/utils';

interface MacroRingProps {
  /** Current value (numerator). */
  value: number;
  /** Goal (denominator). When null/0, ring renders empty. */
  goal: number | null;
  /** Optional band: low/high are signed fractions (e.g. -0.1, 0.1). */
  band?: { low: number; high: number | null } | null;
  /** Pixel size of the ring's outer box. */
  size?: number;
  /** Stroke thickness. */
  stroke?: number;
  /** Center label override. Default: short numeric (e.g. "76%"). */
  centerTop?: string;
  /** Center sublabel (e.g. "cal", "p"). */
  centerBottom?: string;
  className?: string;
  ariaLabel?: string;
}

/**
 * Returns one of: 'under' | 'in' | 'over' | 'way-over' | 'empty'
 * based on actual vs goal and the configured band.
 */
function classify(
  value: number,
  goal: number | null,
  band: { low: number; high: number | null } | null | undefined
): 'under' | 'in' | 'over' | 'way-over' | 'empty' {
  if (!goal) return 'empty';
  const ratio = value / goal;
  const low = band?.low ?? -0.1;
  const high = band?.high;
  if (ratio < 1 + low) return 'under';
  if (high === null || high === undefined) return 'in';
  if (ratio <= 1 + high) return 'in';
  if (ratio <= 1 + high + 0.1) return 'over';
  return 'way-over';
}

const KIND_CLASSES: Record<ReturnType<typeof classify>, string> = {
  empty: 'text-muted-foreground',
  under: 'text-muted-foreground',
  in: 'text-emerald-500',
  over: 'text-amber-500',
  'way-over': 'text-red-500',
};

export function MacroRing({
  value,
  goal,
  band,
  size = 56,
  stroke = 6,
  centerTop,
  centerBottom,
  className,
  ariaLabel,
}: MacroRingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = goal ? Math.min(value / goal, 1.5) : 0;
  const dash = c * Math.min(pct, 1);
  const kind = classify(value, goal, band);
  const colorClass = KIND_CLASSES[kind];

  const top = centerTop ?? (goal ? `${Math.round(pct * 100)}%` : '–');

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={
          ariaLabel ??
          (goal ? `${Math.round(value)} of ${goal} (${Math.round(pct * 100)}%)` : 'No goal set')
        }
        className={colorClass}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth={stroke}
          fill="none"
        />
        {goal ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${dash} ${c - dash}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        <span className={cn('font-semibold', size >= 80 ? 'text-base' : 'text-xs')}>{top}</span>
        {centerBottom && <span className="text-[10px] text-muted-foreground mt-0.5">{centerBottom}</span>}
      </div>
    </div>
  );
}
