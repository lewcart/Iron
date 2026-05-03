'use client';

import { offsetTransform } from '@/lib/photo-offset';
import type { BaseCompareProps } from './types';

/** Two full images side-by-side. No information hidden, no slider. The
 *  workhorse mode for "show me my whole transformation" viewing. Both halves
 *  share the same aspect ratio + offsetTransform so heads land at the same y. */
export function SideBySideMode({
  beforeUrl,
  afterUrl,
  beforeOffset,
  afterOffset,
  beforeLabel,
  afterLabel,
  accent,
}: BaseCompareProps) {
  const accentBg = accent === 'trans-blue' ? 'bg-trans-blue/80' : 'bg-trans-pink/80';

  return (
    <div className="grid grid-cols-2 gap-1 w-full aspect-[3/2] rounded-xl overflow-hidden bg-zinc-900">
      <div className="relative overflow-hidden bg-zinc-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={beforeUrl}
          alt={beforeLabel}
          className="absolute inset-0 w-full h-full select-none"
          style={{
            objectFit: 'cover',
            transform: offsetTransform(beforeOffset),
            transformOrigin: 'center',
          }}
          draggable={false}
        />
        <span className="absolute top-2 left-2 text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded bg-black/60 text-white">
          {beforeLabel}
        </span>
      </div>
      <div className="relative overflow-hidden bg-zinc-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={afterUrl}
          alt={afterLabel}
          className="absolute inset-0 w-full h-full select-none"
          style={{
            objectFit: 'cover',
            transform: offsetTransform(afterOffset),
            transformOrigin: 'center',
          }}
          draggable={false}
        />
        <span className={`absolute top-2 right-2 text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded text-white ${accentBg}`}>
          {afterLabel}
        </span>
      </div>
    </div>
  );
}
