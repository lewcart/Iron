'use client';

/**
 * PhotoCadenceFooter — small chip that prompts a front-pose progress photo
 * when the cadence (28 days) is overdue or approaching.
 *
 * Per /autoplan design spec:
 *   - Renders ONLY when status is 'soon' | 'overdue' | 'no-photo-ever'.
 *     'fresh' → returns null (silent — no nag).
 *   - Two affordances when a front-pose projection exists:
 *       primary: "Capture →" links to /measurements?tab=photos&compose=front
 *       secondary: "Compare projection" links to the projection compare deep-link
 *   - Touch target ≥44pt (full chip is the tap area).
 *   - 'overdue' and 'no-photo-ever' promote above Section B (urgency overrides
 *     geography). Page-level positioning decides where to render this.
 */

import Link from 'next/link';
import { Camera } from 'lucide-react';
import type { PhotoCadenceState } from '@/lib/training/photo-cadence';

export interface PhotoCadenceFooterProps {
  /** State from photoCadenceState(). Pass null while loading. */
  state: PhotoCadenceState | null;
  /** True when at least one `pose: 'front'` projection_photo exists; enables
   *  the secondary "Compare projection" affordance. */
  hasFrontProjection: boolean;
}

export function PhotoCadenceFooter({ state, hasFrontProjection }: PhotoCadenceFooterProps) {
  if (state == null) return null;
  if (state.status === 'fresh') return null;

  const captureHref = '/measurements?tab=photos&compose=front';
  const compareHref = '/measurements?tab=photos&compare=front';

  const primaryCopy = primaryCopyFor(state);
  const tone = state.status === 'overdue' || state.status === 'no-photo-ever'
    ? 'bg-amber-500/10 border-amber-500/30'
    : 'bg-muted/40 border-border/60';

  return (
    <div
      className={`rounded-2xl border ${tone} px-4 py-3`}
      aria-label={`Photo cadence: ${primaryCopy}`}
    >
      <div className="flex items-start gap-3">
        <Camera className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" strokeWidth={1.75} />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground leading-snug">{primaryCopy}</p>
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <Link
              href={captureHref}
              className="inline-flex items-center text-xs font-medium text-primary hover:underline min-h-[44px] py-2"
            >
              Capture →
            </Link>
            {hasFrontProjection && (
              <>
                <span className="text-muted-foreground/50" aria-hidden>·</span>
                <Link
                  href={compareHref}
                  className="inline-flex items-center text-xs font-medium text-foreground/80 hover:underline min-h-[44px] py-2"
                >
                  Compare projection
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function primaryCopyFor(state: PhotoCadenceState): string {
  if (state.status === 'no-photo-ever') {
    return 'Take your first front-pose photo to start tracking';
  }
  if (state.status === 'overdue') {
    const days = Math.abs(state.dueIn);
    return `Front-pose photo overdue by ${days} ${days === 1 ? 'day' : 'days'}`;
  }
  // soon
  if (state.dueIn === 0) {
    return 'Front-pose photo due today';
  }
  return `Front-pose photo due in ${state.dueIn} ${state.dueIn === 1 ? 'day' : 'days'}`;
}
