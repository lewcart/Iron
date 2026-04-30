'use client';

import { useEffect, useRef, useState } from 'react';
import { Droplet, Pencil } from 'lucide-react';
import { setDayNote } from '@/lib/mutations-nutrition';
import { safeParseNumber } from '@/lib/nutrition-time';
import type { LocalNutritionDayNote } from '@/db/local';

interface Props {
  date: string;
  dayNote: LocalNutritionDayNote | undefined;
}

const QUICK_ADDS_ML = [250, 500, 750];

/**
 * Inline section for hydration logging and free-text day notes. Replaces the
 * back-door subtab inside the legacy `/nutrition/week` page. Both fields
 * persist via `setDayNote` (local-first → sync engine).
 *
 * Hydration takes quick-add buttons for the common pour sizes and an exact
 * ml input for explicit overrides. Notes is a small textarea that grows.
 * Both auto-save with a debounce so there's no Save button to remember.
 */
export function DayNoteSection({ date, dayNote }: Props) {
  const [hydration, setHydration] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Debounce auto-save so typing in notes doesn't fire on every keystroke.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from server/Dexie state when the date or row changes.
  useEffect(() => {
    setHydration(dayNote?.hydration_ml != null ? String(dayNote.hydration_ml) : '');
    setNotes(dayNote?.notes ?? '');
  }, [date, dayNote?.hydration_ml, dayNote?.notes]);

  function scheduleSave(nextHydrationStr: string, nextNotes: string) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await setDayNote({
          date,
          hydration_ml: safeParseNumber(nextHydrationStr),
          notes: nextNotes.trim() || null,
        });
      } finally {
        setSaving(false);
      }
    }, 600);
  }

  function updateHydration(next: string) {
    setHydration(next);
    scheduleSave(next, notes);
  }

  function updateNotes(next: string) {
    setNotes(next);
    scheduleSave(hydration, next);
  }

  function addMl(delta: number) {
    const current = safeParseNumber(hydration) ?? 0;
    const next = String(Math.max(0, current + delta));
    updateHydration(next);
  }

  return (
    <section className="mt-6 ios-section overflow-hidden">
      <div className="ios-row gap-3">
        <Droplet className="size-4 text-sky-400" />
        <div className="flex-1 flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={50}
            value={hydration}
            onChange={(e) => updateHydration(e.target.value)}
            placeholder="0"
            className="w-20 bg-transparent text-sm font-medium text-right outline-none tabular-nums"
            aria-label="Hydration in millilitres"
          />
          <span className="text-xs text-muted-foreground">ml water</span>
        </div>
        <div className="flex gap-1">
          {QUICK_ADDS_ML.map((ml) => (
            <button
              key={ml}
              type="button"
              onClick={() => addMl(ml)}
              className="h-7 px-2 rounded-full bg-sky-500/10 text-sky-500 text-[11px] font-semibold hover:bg-sky-500/20 transition-colors"
              aria-label={`Add ${ml} millilitres`}
            >
              +{ml}
            </button>
          ))}
        </div>
      </div>

      <div className="ios-row items-start gap-3 pt-2">
        <Pencil className="size-4 text-muted-foreground mt-2" />
        <textarea
          value={notes}
          onChange={(e) => updateNotes(e.target.value)}
          rows={2}
          placeholder="Notes for the day (felt, slept, training, …)"
          className="flex-1 bg-transparent text-sm outline-none resize-none placeholder:text-muted-foreground"
        />
      </div>

      {saving && (
        <div className="px-4 pb-2 text-[10px] text-muted-foreground text-right">
          Saving…
        </div>
      )}
    </section>
  );
}
