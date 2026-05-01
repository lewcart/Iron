'use client';

import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { setDayNote } from '@/lib/mutations-nutrition';
import type { LocalNutritionDayNote } from '@/db/local';

interface Props {
  date: string;
  dayNote: LocalNutritionDayNote | undefined;
}

/**
 * Inline section for free-text day notes. Persists via `setDayNote`
 * (local-first → sync engine) with a debounced auto-save so there's no
 * Save button to remember.
 */
export function DayNoteSection({ date, dayNote }: Props) {
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Debounce auto-save so typing doesn't fire on every keystroke.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from server/Dexie state when the date or row changes.
  useEffect(() => {
    setNotes(dayNote?.notes ?? '');
  }, [date, dayNote?.notes]);

  function scheduleSave(nextNotes: string) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await setDayNote({
          date,
          notes: nextNotes.trim() || null,
        });
      } finally {
        setSaving(false);
      }
    }, 600);
  }

  function updateNotes(next: string) {
    setNotes(next);
    scheduleSave(next);
  }

  return (
    <section className="mt-6 ios-section overflow-hidden">
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
