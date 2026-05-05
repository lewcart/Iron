'use client';

interface ChipOption<K extends string = string> {
  key: K;
  label: string;
}

interface ChipGroupProps<K extends string = string> {
  options: ReadonlyArray<ChipOption<K>>;
  selected: K;
  onChange: (key: K) => void;
  /** wrap = multi-row pill strip (good for short lists). scroll = single-row
   *  horizontal scroller (good for 8+ chips on narrow viewports). */
  variant?: 'wrap' | 'scroll';
}

export function ChipGroup<K extends string>({
  options,
  selected,
  onChange,
  variant = 'wrap',
}: ChipGroupProps<K>) {
  const containerCls =
    variant === 'scroll'
      ? 'ios-row gap-2 py-1 overflow-x-auto scrollbar-none flex-nowrap'
      : 'ios-row flex-wrap gap-2 py-1';
  return (
    <div className={containerCls}>
      {options.map(opt => {
        const active = selected === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.key)}
            className={`shrink-0 px-3 py-1 text-xs font-medium rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              active
                ? 'bg-primary text-white border-primary'
                : 'border-border text-muted-foreground'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
