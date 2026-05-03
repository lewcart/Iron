'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Pause, Play, Rewind, FastForward } from 'lucide-react';
import { offsetTransform } from '@/lib/photo-offset';

export interface TimelapseFrame {
  uuid: string;
  url: string;
  offsetY: number | null;
  offsetX: number | null;
  date: string; // ISO
}

const SPEEDS = [
  { ms: 1000, label: '1.0×' },
  { ms: 500,  label: '2.0×' },
  { ms: 250,  label: '4.0×' },
] as const;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: 'Europe/London',
  });
}

interface Props {
  open: boolean;
  onClose: () => void;
  frames: TimelapseFrame[];
}

/** Full-screen overlay that auto-loops through photos at the active pose
 *  chronologically. Head-anchored via offsetTransform so faces stay in roughly
 *  the same y-position frame-to-frame. Scrub bar lets the user stop on any
 *  frame; speed control + Play/Pause give standard transport. */
export function TimelapseViewer({ open, onClose, frames }: Props) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speedMs, setSpeedMs] = useState(500);
  const intervalRef = useRef<number | null>(null);

  // Reset on open / when frame list changes.
  useEffect(() => {
    if (open) {
      setIdx(0);
      setPlaying(true);
    }
  }, [open, frames.length]);

  useEffect(() => {
    if (!open || !playing || frames.length < 2) return;
    intervalRef.current = window.setInterval(() => {
      setIdx((cur) => (cur + 1) % frames.length);
    }, speedMs);
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [open, playing, speedMs, frames.length]);

  // Body scroll lock — same pattern as AdjustOffsetDialog.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  if (frames.length === 0) return null;

  const active = frames[Math.min(idx, frames.length - 1)];

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col overscroll-contain">
      <div
        className="flex items-center gap-2 px-2 py-3 border-b border-white/10"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      >
        <button
          onClick={onClose}
          className="text-white/90 px-2 -ml-1 min-h-[44px] flex items-center gap-1"
          aria-label="Close time-lapse"
        >
          <ChevronLeft className="h-5 w-5" />
          <span className="text-sm">Close</span>
        </button>
        <div className="flex-1 text-center -ml-12">
          <h2 className="text-sm font-semibold text-white">Time-lapse</h2>
          <p className="text-[11px] text-white/60">
            Frame {idx + 1} / {frames.length} · {formatDate(active.date)}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-4 flex items-center justify-center">
        <div className="relative w-full max-w-md aspect-[3/4] overflow-hidden rounded-xl bg-zinc-900 select-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active.url}
            alt={`Frame ${idx + 1}`}
            className="absolute inset-0 w-full h-full"
            style={{
              objectFit: 'cover',
              transform: offsetTransform(active.offsetX, active.offsetY),
              transformOrigin: 'center',
            }}
            draggable={false}
          />
          <span className="absolute bottom-2 left-2 text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded bg-black/70 text-white">
            {formatDate(active.date)}
          </span>
        </div>
      </div>

      <div
        className="px-4 pb-6 space-y-3 border-t border-white/10 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)' }}
      >
        <input
          type="range"
          min={0}
          max={Math.max(0, frames.length - 1)}
          value={idx}
          onChange={(e) => {
            setPlaying(false);
            setIdx(Number(e.target.value));
          }}
          className="w-full accent-white"
          aria-label="Scrub time-lapse"
          aria-valuetext={`Frame ${idx + 1} of ${frames.length}, ${formatDate(active.date)}`}
        />
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => {
              setPlaying(false);
              setIdx((cur) => Math.max(0, cur - 1));
            }}
            className="text-white/80 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Previous frame"
          >
            <Rewind className="h-5 w-5" />
          </button>
          <button
            onClick={() => setPlaying((v) => !v)}
            className="bg-white text-black rounded-full min-h-[48px] min-w-[48px] flex items-center justify-center"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button
            onClick={() => {
              setPlaying(false);
              setIdx((cur) => Math.min(frames.length - 1, cur + 1));
            }}
            className="text-white/80 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Next frame"
          >
            <FastForward className="h-5 w-5" />
          </button>
          <div className="flex gap-1 ml-auto">
            {SPEEDS.map((s) => (
              <button
                key={s.ms}
                onClick={() => setSpeedMs(s.ms)}
                className={`px-2 py-1 text-[11px] font-medium rounded min-h-[44px] min-w-[44px] ${
                  speedMs === s.ms ? 'bg-white/20 text-white' : 'text-white/50'
                }`}
                aria-label={`Playback speed ${s.label}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
