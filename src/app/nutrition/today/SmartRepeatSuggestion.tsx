'use client';

import { useEffect, useState } from 'react';
import { Repeat } from 'lucide-react';
import { db } from '@/db/local';
import { logMeal } from '@/lib/mutations-nutrition';
import { offsetDate } from '@/lib/nutrition-time';
import type { LocalNutritionLog } from '@/db/local';
import type { MealSlot } from './MealSection';

interface Props {
  date: string;
  slot: MealSlot;
  /** True when this slot has no logs today. */
  empty: boolean;
}

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};

export function SmartRepeatSuggestion({ date, slot, empty }: Props) {
  const [yesterdayLogs, setYesterdayLogs] = useState<LocalNutritionLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!empty || hidden) {
      setYesterdayLogs([]);
      return;
    }
    const yesterday = offsetDate(date, -1);
    let cancelled = false;
    db.nutrition_logs
      .filter((l) => !l._deleted && l.meal_type === slot && l.logged_at.slice(0, 10) === yesterday)
      .toArray()
      .then((logs) => {
        if (!cancelled) setYesterdayLogs(logs);
      });
    return () => {
      cancelled = true;
    };
  }, [date, slot, empty, hidden]);

  if (!empty || yesterdayLogs.length === 0 || hidden) return null;

  async function copyForward() {
    setBusy(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const isToday = date === today;
      for (const src of yesterdayLogs) {
        await logMeal({
          meal_type: slot,
          meal_name: src.meal_name,
          calories: src.calories,
          protein_g: src.protein_g,
          carbs_g: src.carbs_g,
          fat_g: src.fat_g,
          status: 'added',
          logged_at: isToday ? new Date().toISOString() : new Date(date + 'T12:00:00').toISOString(),
        });
      }
      setHidden(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copyForward}
      disabled={busy}
      className="w-full mx-4 mt-2 flex items-center gap-2 rounded-lg bg-amber-500/10 text-amber-500 px-3 py-2 text-xs hover:bg-amber-500/15 transition-colors disabled:opacity-60"
      style={{ width: 'calc(100% - 2rem)' }}
    >
      <Repeat className="size-3.5" />
      <span className="flex-1 text-left">
        {busy ? 'Copying…' : `Log ${SLOT_LABELS[slot]} from yesterday (${yesterdayLogs.length} ${yesterdayLogs.length === 1 ? 'item' : 'items'})`}
      </span>
    </button>
  );
}
