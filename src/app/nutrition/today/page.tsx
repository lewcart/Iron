'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Calendar, Settings } from 'lucide-react';
import { useNutritionLogsForDate, useDayNote, useNutritionTargets } from '@/lib/useLocalDB-nutrition';
import { useTodayWorkoutCalories } from '@/lib/useTodayWorkouts';
import { deleteMeal } from '@/lib/mutations-nutrition';
import {
  todayLocal,
  offsetDate,
  formatDateLabel,
  deriveDisplayStatus,
} from '@/lib/nutrition-time';
import type { LocalNutritionLog, MacroBands } from '@/db/local';
import { CalorieBalanceCard } from './CalorieBalanceCard';
import { MacroCardScroller } from './MacroCardScroller';
import { MealSection, type MealSlot } from './MealSection';
import { AddFoodSheet } from './AddFoodSheet';
import { EditFoodSheet } from './EditFoodSheet';
import { ApproveDayButton } from './ApproveDayButton';
import { SmartRepeatSuggestion } from './SmartRepeatSuggestion';
import { EntryDock } from './EntryDock';
import { DayNoteSection } from './DayNoteSection';
import { GoalsSheet } from '../goals/GoalsSheet';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

const DEFAULT_BANDS: MacroBands = {
  cal: { low: -0.10, high: 0.10 },
  pro: { low: -0.10, high: null },
  carb: { low: -0.15, high: 0.15 },
  fat: { low: -0.15, high: 0.20 },
};

export default function NutritionTodayPage() {
  return (
    <Suspense fallback={<div className="tab-content max-w-3xl mx-auto px-4 pt-4 text-sm text-muted-foreground">Loading…</div>}>
      <NutritionTodayContent />
    </Suspense>
  );
}

function NutritionTodayContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateParam = searchParams.get('date');

  const [today, setToday] = useState<string>(() => todayLocal());
  const [addSheet, setAddSheet] = useState<MealSlot | null>(null);
  const [editLog, setEditLog] = useState<LocalNutritionLog | null>(null);
  const [showGoals, setShowGoals] = useState(false);

  const date = dateParam ?? today;

  // Re-derive "today" each minute so a page open across midnight rolls over.
  useEffect(() => {
    const tick = () => setToday(todayLocal());
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, []);

  const rawLogs = useNutritionLogsForDate(date);
  const logs = useMemo(() => rawLogs ?? [], [rawLogs]);
  const dayNote = useDayNote(date);
  const targets = useNutritionTargets();
  const workoutKcal = useTodayWorkoutCalories(date);

  const bands = (targets?.bands ?? DEFAULT_BANDS) as MacroBands;

  const totals = useMemo(() => {
    let cal = 0, pro = 0, carb = 0, fat = 0;
    for (const l of logs) {
      cal += l.calories ?? 0;
      pro += l.protein_g ?? 0;
      carb += l.carbs_g ?? 0;
      fat += l.fat_g ?? 0;
    }
    return { cal, pro, carb, fat };
  }, [logs]);

  const logsBySlot = useMemo(() => {
    const map = new Map<MealSlot, LocalNutritionLog[]>();
    for (const slot of SLOTS) map.set(slot, []);
    for (const log of logs) {
      const slot = (log.meal_type === 'other' ? null : log.meal_type) as MealSlot | null;
      if (slot && map.has(slot)) map.get(slot)!.push(log);
    }
    return map;
  }, [logs]);

  const status = deriveDisplayStatus(date, dayNote, today);

  function navigate(days: number) {
    const next = offsetDate(date, days);
    router.replace(next === today ? '/nutrition/today' : `/nutrition/today?date=${next}`);
  }

  return (
    <div className="tab-content max-w-3xl mx-auto px-4 pt-4 pb-24">
      {/* Date nav + Goals */}
      <header className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Previous day"
          className="size-9 inline-flex items-center justify-center rounded-full hover:bg-muted/40"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Calendar className="size-4 text-muted-foreground" />
          <span>{formatDateLabel(date)}</span>
          {status.kind !== 'today' && (
            <span
              className={
                status.kind === 'reviewed'
                  ? 'ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500'
                  : 'ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground'
              }
            >
              {status.label}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => navigate(1)}
          aria-label="Next day"
          className="size-9 inline-flex items-center justify-center rounded-full hover:bg-muted/40"
        >
          <ChevronRight className="size-5" />
        </button>
      </header>

      <div className="flex justify-end mb-2">
        <button
          type="button"
          onClick={() => setShowGoals(true)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Settings className="size-3.5" /> Goals
        </button>
      </div>

      <CalorieBalanceCard
        consumed={totals.cal}
        goal={targets?.calories ?? null}
        workouts={workoutKcal}
        band={bands.cal ?? null}
      />

      <div className="mt-3">
        <MacroCardScroller
          cards={[
            {
              label: 'Protein',
              unit: 'g',
              value: totals.pro,
              goal: targets?.protein_g ?? null,
              band: bands.pro ?? null,
              accent: 'text-rose-400',
            },
            {
              label: 'Carbs',
              unit: 'g',
              value: totals.carb,
              goal: targets?.carbs_g ?? null,
              band: bands.carb ?? null,
              accent: 'text-violet-400',
            },
            {
              label: 'Fat',
              unit: 'g',
              value: totals.fat,
              goal: targets?.fat_g ?? null,
              band: bands.fat ?? null,
              accent: 'text-sky-400',
            },
          ]}
        />
      </div>

      {SLOTS.map((slot) => {
        const slotLogs = logsBySlot.get(slot) ?? [];
        return (
          <div key={slot}>
            <MealSection
              slot={slot}
              logs={slotLogs}
              onAdd={() => setAddSheet(slot)}
              onEditLog={(uuid) => {
                const log = slotLogs.find((l) => l.uuid === uuid);
                if (log) setEditLog(log);
              }}
              onDeleteLog={(uuid) => deleteMeal(uuid)}
            />
            <SmartRepeatSuggestion date={date} slot={slot} empty={slotLogs.length === 0} />
          </div>
        );
      })}

      <DayNoteSection date={date} dayNote={dayNote} />

      <div className="mt-6">
        <ApproveDayButton date={date} status={status} />
      </div>

      <EntryDock onAdd={() => setAddSheet('snack')} />

      {addSheet && (
        <AddFoodSheet
          open={addSheet !== null}
          onClose={() => setAddSheet(null)}
          slot={addSheet}
          date={date}
        />
      )}

      <EditFoodSheet
        open={editLog !== null}
        onClose={() => setEditLog(null)}
        log={editLog}
      />

      <GoalsSheet open={showGoals} onClose={() => setShowGoals(false)} />
    </div>
  );
}
