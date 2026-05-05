'use client';

import { useState } from 'react';
import { Sheet } from '@/components/ui/sheet';
import { excludeSetFromPb, deleteSet } from '@/lib/mutations';

export interface SetActionSheetTarget {
  set_uuid: string;
  is_excluded: boolean;
  weight: number | null;
  repetitions: number | null;
  duration_seconds: number | null;
  /** Optional label used in the sheet title — e.g. "Set 3 of Bench Press". */
  label?: string;
}

interface Props {
  target: SetActionSheetTarget | null;
  onClose: () => void;
  unitLabel: string;
}

/**
 * iOS-style bottom sheet for per-set actions on a logged historical set.
 * Opens on row tap from WorkoutDetail or ExerciseDetail's recent-sets table.
 *
 * Two actions:
 *   1. Toggle "doesn't count for PB" (form was off, partial reps, etc).
 *      The set stays in volume / history but stops anchoring PRs.
 *   2. Delete the set entirely (existing soft-delete behavior).
 *
 * Long-press is intentionally NOT used — it conflicts with iOS caret
 * positioning and with the existing swipe-to-delete on workout/page.tsx.
 * Tap-to-open is the single explicit affordance.
 */
export function SetActionSheet({ target, onClose, unitLabel }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const open = target !== null;
  if (!target) {
    // Sheet is unmounted; useEffect inside Sheet handles transition-out.
    return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  }

  async function handleToggleExclude() {
    if (!target) return;
    setBusy(true);
    try {
      await excludeSetFromPb(target.set_uuid, !target.is_excluded);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!target) return;
    setBusy(true);
    try {
      await deleteSet(target.set_uuid);
      onClose();
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  const setSummary = target.duration_seconds != null
    ? `${target.weight != null && target.weight > 0 ? `${target.weight} ${unitLabel} × ` : ''}${target.duration_seconds}s hold`
    : `${target.weight ?? '—'} ${unitLabel} × ${target.repetitions ?? '—'}`;

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (busy) return;
        setConfirmingDelete(false);
        onClose();
      }}
      title={target.label ?? 'Set actions'}
    >
      <div className="px-4 py-3 space-y-3">
        <p className="text-xs text-muted-foreground">{setSummary}</p>

        <button
          type="button"
          onClick={handleToggleExclude}
          disabled={busy}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-border bg-card text-left active:bg-card/70 disabled:opacity-50"
        >
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold">
              {target.is_excluded ? "Count this for PB again" : "Doesn't count for PB"}
            </span>
            <span className="text-xs text-muted-foreground mt-0.5">
              {target.is_excluded
                ? 'Restores this set as a PB candidate. Workout history is unchanged either way.'
                : 'Form was off, partial reps, etc. Stays in volume + history; just stops anchoring PRs.'}
            </span>
          </div>
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full border whitespace-nowrap ${
            target.is_excluded
              ? 'text-amber-400 bg-amber-400/15 border-amber-400/30'
              : 'text-muted-foreground bg-muted/40 border-border'
          }`}>
            {target.is_excluded ? 'EX' : 'EX off'}
          </span>
        </button>

        {!confirmingDelete ? (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
            className="w-full px-4 py-3 rounded-xl border border-red-500/40 bg-red-500/10 text-sm font-semibold text-red-400 active:bg-red-500/20 disabled:opacity-50"
          >
            Delete set
          </button>
        ) : (
          <div className="flex flex-col gap-2 px-4 py-3 rounded-xl border border-red-500/40 bg-red-500/10">
            <p className="text-sm font-semibold text-red-300">Delete this set permanently?</p>
            <p className="text-xs text-red-300/80">
              Removes it from workout history, volume, and set counts. Use &quot;doesn&apos;t count for PB&quot; instead if the set really happened but the form was off.
            </p>
            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-sm font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="flex-1 px-3 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
