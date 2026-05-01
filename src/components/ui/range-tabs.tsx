'use client';

import { cn } from '@/lib/utils';

export type RangeKey = 'day' | 'week' | 'month' | '3month';

interface RangeTabsProps {
  value: RangeKey;
  onChange: (next: RangeKey) => void;
  className?: string;
}

const TABS: { key: RangeKey; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: '3month', label: '3-Month' },
];

/**
 * Segmented control for selecting a date-range scope on /sleep. Each tab is
 * a real <button> with a 44px tap target; the active state has both a fill
 * and a `aria-pressed="true"` so VoiceOver announces it correctly.
 */
export function RangeTabs({ value, onChange, className }: RangeTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Sleep range"
      className={cn(
        'inline-flex w-full rounded-full bg-muted/40 p-1 gap-1',
        className,
      )}
    >
      {TABS.map(tab => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-pressed={active}
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={cn(
              'flex-1 min-h-[44px] px-3 rounded-full text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
