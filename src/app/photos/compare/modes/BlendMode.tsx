'use client';

import { useState } from 'react';
import { offsetTransform } from '@/lib/photo-offset';
import type { BaseCompareProps } from './types';

/** Onion-skin overlay — both images stacked, slider controls opacity of the
 *  before image over the after. At 50/50 the silhouettes superimpose, making
 *  shape delta visible at a glance. The classic bodybuilder pose-comparison. */
export function BlendMode({
  beforeUrl,
  afterUrl,
  beforeOffset,
  afterOffset,
  beforeLabel,
  afterLabel,
  accent,
}: BaseCompareProps) {
  const [opacity, setOpacity] = useState(50);
  const accentBg = accent === 'trans-blue' ? 'bg-trans-blue/80' : 'bg-trans-pink/80';

  return (
    <div className="space-y-2">
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
            opacity: opacity / 100,
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
      <div className="flex items-center gap-3 px-2 min-h-[44px]">
        <span className="text-[10px] uppercase tracking-wide text-white/50 w-16 text-right">
          {afterLabel}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          className="flex-1 accent-white"
          aria-label={`Blend opacity between ${beforeLabel} and ${afterLabel}`}
          aria-valuetext={`${opacity}% ${beforeLabel}`}
        />
        <span className="text-[10px] uppercase tracking-wide text-white/50 w-16">
          {beforeLabel}
        </span>
      </div>
    </div>
  );
}
