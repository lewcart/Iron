import { cn } from '@/lib/utils';

export interface StageSegment {
  label: string;
  minutes: number;
  /** Tailwind background class. */
  color: string;
}

interface StageBarProps {
  segments: StageSegment[];
  /** Pixel height of the bar. */
  height?: number;
  /**
   * Visual hint that this represents proportions, NOT temporal ordering.
   * Default true. Renders a small "Proportions" caption beside an a11y label.
   */
  showCaption?: boolean;
  className?: string;
}

function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Stacked horizontal bar of sleep stages.
 *
 * IMPORTANT: this represents proportions, NOT a hypnogram. The segments are
 * sized by minutes-as-fraction-of-total but their left-to-right order is the
 * order passed in, not when they actually happened. The a11y summary makes
 * this explicit so screen reader users don't infer false temporal ordering.
 */
export function StageBar({
  segments,
  height = 12,
  showCaption = true,
  className,
}: StageBarProps) {
  const total = segments.reduce((acc, s) => acc + s.minutes, 0);
  const summary = total === 0
    ? 'No sleep data'
    : segments.map(s => `${s.label} ${fmt(s.minutes)}`).join(', ');

  if (total === 0) {
    return (
      <div
        className={cn('w-full rounded-full bg-muted/40', className)}
        style={{ height }}
        role="img"
        aria-label="No sleep data"
      />
    );
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div
        className="w-full flex rounded-full overflow-hidden"
        style={{ height }}
        role="img"
        aria-label={`Sleep stage proportions: ${summary}`}
      >
        {segments.map(s => (
          <div
            key={s.label}
            className={cn('h-full', s.color)}
            style={{ width: `${(s.minutes / total) * 100}%` }}
            title={`${s.label} ${fmt(s.minutes)}`}
          />
        ))}
      </div>
      {showCaption && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Proportions, not timeline
        </span>
      )}
    </div>
  );
}
