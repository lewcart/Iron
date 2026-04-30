import { cn } from '@/lib/utils';

interface MacroBarProps {
  value: number;
  goal: number | null;
  band?: { low: number; high: number | null } | null;
  /** Pixel height of the bar. */
  height?: number;
  className?: string;
  ariaLabel?: string;
}

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

const FILL: Record<ReturnType<typeof classify>, string> = {
  empty: 'bg-muted-foreground/20',
  under: 'bg-muted-foreground/60',
  in: 'bg-emerald-500',
  over: 'bg-amber-500',
  'way-over': 'bg-red-500',
};

export function MacroBar({ value, goal, band, height = 4, className, ariaLabel }: MacroBarProps) {
  const pct = goal ? Math.min((value / goal) * 100, 100) : 0;
  const kind = classify(value, goal, band);

  return (
    <div
      className={cn('relative w-full rounded-full bg-muted/40 overflow-hidden', className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={goal ?? 0}
      aria-label={ariaLabel ?? (goal ? `${Math.round(value)} of ${goal}` : 'No goal set')}
    >
      <div
        className={cn('absolute inset-y-0 left-0 transition-[width] duration-300', FILL[kind])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
