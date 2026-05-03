'use client';

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { offsetTransform } from '@/lib/photo-offset';
import type { BaseCompareProps } from './types';

/** Draggable before/after divider — the original CompareDialog interaction
 *  preserved in mode form. Both images render with the same offsetTransform
 *  so heads land at the same y. */
export function SlideMode({
  beforeUrl,
  afterUrl,
  beforeOffsetX,
  beforeOffsetY,
  afterOffsetX,
  afterOffsetY,
  beforeLabel,
  afterLabel,
  accent,
}: BaseCompareProps) {
  const [pct, setPct] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const handleMove = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * 100;
    setPct(Math.max(0, Math.min(100, next)));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    handleMove(e.clientX);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    handleMove(e.clientX);
  };
  const onPointerUp = () => {
    draggingRef.current = false;
  };

  const accentBg = accent === 'trans-blue' ? 'bg-trans-blue/80' : 'bg-trans-pink/80';

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="relative w-full aspect-[3/4] overflow-hidden rounded-xl bg-zinc-900 select-none touch-none"
      role="slider"
      aria-label={`Slide divider between ${beforeLabel} and ${afterLabel}`}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={afterUrl}
        alt={afterLabel}
        className="absolute inset-0 w-full h-full"
        style={{
          objectFit: 'cover',
          transform: offsetTransform(afterOffsetX, afterOffsetY),
          transformOrigin: 'center',
        }}
        draggable={false}
      />
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={beforeUrl}
          alt={beforeLabel}
          className="absolute inset-0 w-full h-full"
          style={{
            objectFit: 'cover',
            transform: offsetTransform(beforeOffsetX, beforeOffsetY),
            transformOrigin: 'center',
          }}
          draggable={false}
        />
      </div>

      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none"
        style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center">
          <ChevronLeft className="h-4 w-4 text-zinc-700 -mr-1" />
          <ChevronRight className="h-4 w-4 text-zinc-700 -ml-1" />
        </div>
      </div>

      <span className="absolute top-2 left-2 text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded bg-black/60 text-white">
        {beforeLabel}
      </span>
      <span className={`absolute top-2 right-2 text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded text-white ${accentBg}`}>
        {afterLabel}
      </span>
    </div>
  );
}
