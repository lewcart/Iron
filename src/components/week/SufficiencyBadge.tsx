'use client';

/**
 * SufficiencyBadge — small "[N wks]" pill rendered next to a priority
 * muscle row when data history is below the personalization threshold
 * (8 weeks). Goes silent (returns null) once the muscle accumulates
 * enough history.
 *
 * Per /autoplan design spec:
 *   - Single tier only (the original two-tier orange/neutral was dropped
 *     as visual noise).
 *   - 0 weeks → renders [no data] with distinct copy.
 *   - 1..7 weeks → renders [N wks].
 *   - ≥8 weeks → returns null (silent — ready for future personalization).
 *   - iOS PWA reality: tap (not hover) opens a small sheet with the
 *     full explanation. Tooltip would never be discovered on touch.
 */

import { useState } from 'react';
import { Sheet } from '@/components/ui/sheet';

export interface SufficiencyBadgeProps {
  /** Number of recent weeks (out of last 8) with ≥1 effective set. */
  weeks: number | null | undefined;
  /** Display label of the muscle (used in the tap-sheet copy). */
  muscleName: string;
}

export const PERSONALIZATION_THRESHOLD_WEEKS = 8;

export function SufficiencyBadge({ weeks, muscleName }: SufficiencyBadgeProps) {
  const [open, setOpen] = useState(false);

  // Silent when not computed or already past threshold.
  if (weeks == null) return null;
  if (weeks >= PERSONALIZATION_THRESHOLD_WEEKS) return null;

  const label = weeks === 0
    ? 'no data'
    : `${weeks}/${PERSONALIZATION_THRESHOLD_WEEKS} wks`;
  const aria = weeks === 0
    ? `No effective sets logged for ${muscleName} in the last 8 weeks`
    : `${weeks} of last 8 weeks have effective sets for ${muscleName}`;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }}
        className="text-[10px] tabular-nums text-muted-foreground px-1 py-0.5 -my-0.5 rounded hover:bg-muted/40 transition-colors"
        aria-label={aria}
      >
        [{label}]
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Data sufficiency"
        height="auto"
      >
        <div className="px-4 py-4 space-y-3">
          <p className="text-sm text-foreground leading-relaxed">
            <strong>{muscleName}</strong> has logged effective sets in{' '}
            <strong>{weeks}</strong>{' '}
            {weeks === 1 ? 'week' : 'weeks'} out of the last 8.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Personal landmark personalization (overriding RP-2025 defaults
            for this muscle) unlocks at <strong>8 weeks</strong>. Below
            that threshold, your response curve isn{`'`}t stable enough yet
            for personal tuning — RP-2025 defaults are still your best guide.
          </p>
          {weeks === 0 && (
            <p className="text-xs italic text-muted-foreground leading-snug">
              Log a session that targets {muscleName.toLowerCase()} to start
              accumulating data.
            </p>
          )}
        </div>
      </Sheet>
    </>
  );
}
