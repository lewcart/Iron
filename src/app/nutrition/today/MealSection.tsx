'use client';

import { Plus } from 'lucide-react';
import { FoodRow } from './FoodRow';
import type { LocalNutritionLog } from '@/db/local';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};

interface Props {
  slot: MealSlot;
  logs: LocalNutritionLog[];
  onAdd: () => void;
  onEditLog: (uuid: string) => void;
  onDeleteLog: (uuid: string) => void;
}

export function MealSection({ slot, logs, onAdd, onEditLog, onDeleteLog }: Props) {
  const total = logs.reduce((sum, l) => sum + (l.calories ?? 0), 0);
  const hasLogs = logs.length > 0;

  // Empty section: collapse to a thin add-prompt header. Less visual noise on
  // minimal days.
  if (!hasLogs) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="w-full px-4 py-2.5 mt-3 flex items-center justify-between text-sm text-muted-foreground hover:bg-muted/40 rounded-lg transition-colors"
      >
        <span>{SLOT_LABELS[slot]}</span>
        <span className="flex items-center gap-1 text-xs">
          <Plus className="size-3.5" /> Add
        </span>
      </button>
    );
  }

  return (
    <section className="mt-4">
      <header className="flex items-center justify-between px-4 mb-1.5">
        <h3 className="text-sm font-semibold">{SLOT_LABELS[slot]}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {Math.round(total)} cal
        </span>
      </header>
      <div className="ios-section divide-y divide-border/40">
        {logs.map((log) => (
          <FoodRow
            key={log.uuid}
            log={log}
            onTap={() => onEditLog(log.uuid)}
            onDelete={() => onDeleteLog(log.uuid)}
          />
        ))}
        <button
          type="button"
          onClick={onAdd}
          className="w-full ios-row py-2 text-sm text-muted-foreground hover:bg-muted/30 flex items-center gap-2"
        >
          <Plus className="size-4" /> Add to {SLOT_LABELS[slot].toLowerCase()}
        </button>
      </div>
    </section>
  );
}
