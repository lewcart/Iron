'use client';

import { SwipeToDelete } from '@/components/SwipeToDelete';
import type { LocalNutritionLog } from '@/db/local';

interface Props {
  log: LocalNutritionLog;
  onTap: () => void;
  onDelete: () => void;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function FoodRow({ log, onTap, onDelete }: Props) {
  const name = log.meal_name ?? log.notes ?? '(unnamed)';
  const cal = log.calories != null ? Math.round(log.calories) : null;

  return (
    <SwipeToDelete onDelete={onDelete}>
      <button
        type="button"
        onClick={onTap}
        className="w-full ios-row py-2.5 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3 w-full">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{name}</div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {log.protein_g != null && <span>{Math.round(log.protein_g)}p</span>}
              {log.carbs_g != null && <span>{Math.round(log.carbs_g)}c</span>}
              {log.fat_g != null && <span>{Math.round(log.fat_g)}f</span>}
              {log.logged_at && <span>· {formatTime(log.logged_at)}</span>}
            </div>
          </div>
          <div className="text-sm font-semibold tabular-nums">
            {cal != null ? `${cal} kcal` : '—'}
          </div>
        </div>
      </button>
    </SwipeToDelete>
  );
}
