import { MacroRing } from '@/components/ui/macro-ring';
import type { MacroBand } from '@/db/local';

interface Props {
  consumed: number;
  goal: number | null;
  band?: MacroBand | null;
}

export function CalorieBalanceCard({ consumed, goal, band }: Props) {
  const remaining = goal != null ? Math.max(0, Math.round(goal - consumed)) : null;

  return (
    <div className="ios-section p-4 flex items-center gap-4">
      <div className="flex-1">
        <div className="text-xs font-medium text-emerald-500 mb-1">Remaining</div>
        <div className="flex items-baseline gap-1">
          <div className="text-3xl font-bold tabular-nums">
            {remaining != null ? remaining.toLocaleString() : '—'}
          </div>
          <div className="text-sm text-muted-foreground">cal</div>
        </div>
      </div>

      <MacroRing
        value={Math.max(0, consumed)}
        goal={goal}
        band={band ?? null}
        size={84}
        stroke={8}
        centerTop={goal ? `${Math.round((Math.max(0, consumed) / goal) * 100)}%` : '–'}
        ariaLabel={
          goal
            ? `Consumed ${Math.round(consumed)} of ${goal} calories, ${Math.round((consumed / goal) * 100)} percent`
            : 'No calorie goal set'
        }
      />

      <div className="border-l border-border/50 pl-4 text-right">
        <div className="text-[10px] text-amber-500 font-medium">Consumed</div>
        <div className="text-base font-semibold tabular-nums">
          {Math.round(consumed).toLocaleString()}
          <span className="text-xs text-muted-foreground"> cal</span>
        </div>
      </div>
    </div>
  );
}
