'use client';

import Link from 'next/link';
import { ChevronRight, Info } from 'lucide-react';

/**
 * Data-needs flag pattern. Rendered when a Week-page tile can't compute its
 * metric. Shows an icon + message + a tappable "fix this" link.
 *
 * The point: the page is honest about what it knows and tells you exactly
 * what's needed to unlock the next view. Inverted-inbox UX — "give me this
 * data" rather than "act on this rule."
 */
export interface TileEmptyStateProps {
  message: string;
  /** When set, the message becomes a tappable link to this route. */
  fixHref?: string;
  /** Display label for the fix-this link. Defaults to "Fix this". */
  fixLabel?: string;
}

export function TileEmptyState({ message, fixHref, fixLabel = 'Fix this' }: TileEmptyStateProps) {
  return (
    <div
      className="flex items-start gap-3 rounded-xl bg-muted/40 border border-dashed border-border p-3"
      role="status"
    >
      <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" strokeWidth={1.75} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground leading-snug">{message}</p>
        {fixHref && (
          <Link
            href={fixHref}
            className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-trans-blue hover:underline min-h-[44px] min-w-[44px] py-2"
          >
            {fixLabel}
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        )}
      </div>
    </div>
  );
}
