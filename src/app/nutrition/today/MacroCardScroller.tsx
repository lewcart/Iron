import { MacroBar } from '@/components/ui/macro-bar';
import type { MacroBand } from '@/db/local';

interface MacroCard {
  label: string;
  unit: string;
  value: number;
  goal: number | null;
  band?: MacroBand | null;
  /** Tailwind text color class for the label. */
  accent: string;
}

interface Props {
  cards: MacroCard[];
}

export function MacroCardScroller({ cards }: Props) {
  return (
    <div className="flex gap-2 pb-1">
      {cards.map((c) => (
        <div
          key={c.label}
          className="flex-1 min-w-0 bg-card border border-border/40 rounded-xl p-3"
        >
          <div className={`text-xs font-medium ${c.accent}`}>{c.label}</div>
          <div className="mt-1 flex items-baseline gap-1">
            <div className="text-base font-semibold tabular-nums">
              {Math.round(c.value)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              /{c.goal != null ? Math.round(c.goal) : '—'}
              {c.unit}
            </div>
          </div>
          <MacroBar
            value={c.value}
            goal={c.goal}
            band={c.band ?? null}
            height={4}
            className="mt-2"
            ariaLabel={`${c.label} ${Math.round(c.value)} of ${c.goal ?? 'no goal'} ${c.unit}`}
          />
        </div>
      ))}
    </div>
  );
}
