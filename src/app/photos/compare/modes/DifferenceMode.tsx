'use client';

import { useEffect, useState } from 'react';
import { Info, X } from 'lucide-react';
import { offsetTransform } from '@/lib/photo-offset';
import type { BaseCompareProps } from './types';

const CAVEAT_DISMISSED_KEY = 'photos-compare-difference-caveat-dismissed';

/** CSS mix-blend-mode: difference overlay. Useful for alignment checks
 *  (matched silhouettes go black) but lighting/clothing changes also appear.
 *  Inline info bar above image (dismissible per session) makes the limitation
 *  visible without reading as an apology under the result. */
export function DifferenceMode({
  beforeUrl,
  afterUrl,
  beforeOffset,
  afterOffset,
  beforeLabel,
  afterLabel,
  accent,
}: BaseCompareProps) {
  const [showCaveat, setShowCaveat] = useState(true);
  const accentBg = accent === 'trans-blue' ? 'bg-trans-blue/80' : 'bg-trans-pink/80';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem(CAVEAT_DISMISSED_KEY) === '1') {
      setShowCaveat(false);
    }
  }, []);

  const dismissCaveat = () => {
    setShowCaveat(false);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(CAVEAT_DISMISSED_KEY, '1');
    }
  };

  return (
    <div className="space-y-2">
      {showCaveat && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-white/50" />
          <span className="flex-1">Best for alignment checks. Lighting and clothing changes also appear.</span>
          <button
            onClick={dismissCaveat}
            className="text-white/40 min-h-[44px] min-w-[44px] -m-2 flex items-center justify-center"
            aria-label="Dismiss caveat"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="relative w-full aspect-[3/4] overflow-hidden rounded-xl bg-zinc-900 select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={afterUrl}
          alt={afterLabel}
          className="absolute inset-0 w-full h-full"
          style={{
            objectFit: 'cover',
            transform: offsetTransform(afterOffset),
            transformOrigin: 'center',
          }}
          draggable={false}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={beforeUrl}
          alt={beforeLabel}
          className="absolute inset-0 w-full h-full"
          style={{
            objectFit: 'cover',
            transform: offsetTransform(beforeOffset),
            transformOrigin: 'center',
            mixBlendMode: 'difference',
          }}
          draggable={false}
        />
        <span className="absolute top-2 left-2 text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded bg-black/60 text-white">
          {beforeLabel}
        </span>
        <span className={`absolute top-2 right-2 text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded text-white ${accentBg}`}>
          {afterLabel}
        </span>
      </div>
    </div>
  );
}
