'use client';

import { useMemo, useState } from 'react';
import { Sheet } from '@/components/ui/sheet';
import {
  excludeSetsForExerciseThroughDate,
  restorePbForSets,
  type BulkPbExclusionResult,
} from '@/lib/mutations';

interface Props {
  exerciseUuid: string;
  exerciseTitle: string;
  open: boolean;
  onClose: () => void;
  /** Optional callback fired after a successful bulk exclusion. The parent
   *  can use this to surface its own snackbar / refresh derived state. The
   *  sheet also surfaces its own confirmation banner with undo. */
  onApplied?: (result: BulkPbExclusionResult) => void;
}

/**
 * Bulk PB adjustment sheet. Lou's mental model: "I was doing this exercise
 * wrong before [date]." Picks a cutoff date (default = today, with quick
 * chips for "Last week" and "2 weeks ago"), confirms, flips every completed
 * set in the canonical exercise group up to and INCLUDING that date to
 * excluded_from_pb=true. Workout history is preserved.
 *
 * Reversible via the inline 10-sec undo banner. Per-set restoration is also
 * always available via the per-set action sheet (slice 5).
 */
export function AdjustPBHistorySheet({ exerciseUuid, exerciseTitle, open, onClose, onApplied }: Props) {
  const [cutoff, setCutoff] = useState<string>(() => localTodayIso());
  const [busy, setBusy] = useState(false);
  const [lastApplied, setLastApplied] = useState<BulkPbExclusionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chips = useMemo(() => buildQuickChips(), []);

  async function handleApply() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await excludeSetsForExerciseThroughDate(exerciseUuid, cutoff, true);
      setLastApplied(result);
      onApplied?.(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to adjust PB history.');
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo() {
    if (!lastApplied || lastApplied.affected_set_uuids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await restorePbForSets(lastApplied.affected_set_uuids);
      setLastApplied(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to undo.');
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    if (busy) return;
    // Reset post-success state so the next open starts fresh.
    setLastApplied(null);
    setError(null);
    onClose();
  }

  return (
    <Sheet open={open} onClose={handleClose} title="I was doing this wrong before…">
      <div className="px-4 py-4 space-y-4">
        <p className="text-xs text-muted-foreground">
          Adjusts PB history for <span className="font-semibold text-foreground">{exerciseTitle}</span>.
          Sets on or before the cutoff stop counting toward PBs. Workout history,
          volume and set counts are unchanged.
        </p>

        {!lastApplied && (
          <>
            <div>
              <p className="text-xs font-semibold text-foreground mb-2">Quick pick</p>
              <div className="flex flex-wrap gap-2">
                {chips.map(chip => (
                  <button
                    key={chip.value}
                    type="button"
                    disabled={busy}
                    onClick={() => setCutoff(chip.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                      cutoff === chip.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-foreground border-border'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-foreground mb-2">Cutoff date</p>
              <input
                type="date"
                value={cutoff}
                max={localTodayIso()}
                onChange={e => setCutoff(e.target.value)}
                disabled={busy}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm font-mono"
              />
              <p className="text-[11px] text-muted-foreground mt-2">
                Sets on <span className="font-semibold">{formatHuman(cutoff)}</span> and earlier
                will be excluded from PB. Sets after that date keep their PB status.
              </p>
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleApply}
              disabled={busy}
              className="w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50"
            >
              {busy ? 'Adjusting…' : 'Exclude prior sets'}
            </button>
          </>
        )}

        {lastApplied && (
          <div className="space-y-3">
            <div className="flex flex-col gap-1 px-4 py-3 rounded-xl border border-border bg-card">
              <p className="text-sm font-semibold">
                {lastApplied.newly_changed_count === 0
                  ? 'Nothing to change'
                  : `Excluded ${lastApplied.newly_changed_count} ${pluralize('set', lastApplied.newly_changed_count)}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {lastApplied.newly_changed_count === 0
                  ? 'No completed sets fell on or before that date that weren’t already excluded.'
                  : `Across ${lastApplied.workouts_affected_count} ${pluralize('workout', lastApplied.workouts_affected_count)}. Workout history is unchanged.`}
              </p>
            </div>

            {lastApplied.newly_changed_count > 0 && (
              <button
                type="button"
                onClick={handleUndo}
                disabled={busy}
                className="w-full px-4 py-2.5 rounded-xl border border-amber-400/40 bg-amber-400/10 text-sm font-semibold text-amber-300 disabled:opacity-50"
              >
                {busy ? 'Restoring…' : 'Undo'}
              </button>
            )}

            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleClose}
              className="w-full px-4 py-2.5 rounded-xl bg-card border border-border text-sm font-semibold"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function localTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface QuickChip { label: string; value: string }

function buildQuickChips(): QuickChip[] {
  const today = new Date();
  const oneWeek = new Date(today); oneWeek.setDate(today.getDate() - 7);
  const twoWeeks = new Date(today); twoWeeks.setDate(today.getDate() - 14);
  const oneMonth = new Date(today); oneMonth.setDate(today.getDate() - 30);
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  return [
    { label: 'Today', value: fmt(today) },
    { label: '1 week ago', value: fmt(oneWeek) },
    { label: '2 weeks ago', value: fmt(twoWeeks) },
    { label: '1 month ago', value: fmt(oneMonth) },
  ];
}

function formatHuman(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!y || !m || !d) return yyyyMmDd;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function pluralize(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}
