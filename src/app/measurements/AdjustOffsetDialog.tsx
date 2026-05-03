'use client';

import { useEffect, useState, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, RotateCcw, Sparkles } from 'lucide-react';
import { isLocalStub } from '@/lib/photo-upload-queue';
import { tryDetectFaceY } from '@/lib/face-detect';
import { offsetTransform } from '@/lib/photo-offset';

export type AdjustablePhotoKind = 'progress' | 'inspo' | 'projection';

interface Props {
  open: boolean;
  onClose: () => void;
  photo: {
    uuid: string;
    blob_url: string;
    crop_offset_y: number | null;
  } | null;
  kind: AdjustablePhotoKind;
  /** Locally-held Blob for `local:*` stubs (only for progress photos). */
  blob?: Blob | null;
  /** Called after the new offset is persisted server-side (and synced for
   *  progress photos). The parent should refresh its data. */
  onSaved: (newOffset: number | null) => void;
}

const ROUTES: Record<AdjustablePhotoKind, string> = {
  progress: '/api/progress-photos',
  inspo: '/api/inspo-photos',
  projection: '/api/projection-photos',
};

/** Drag the photo up/down to align the head. Stored as CSS object-position
 *  y% (0-100). Lower number = top of source image visible (photo "moves down"
 *  in frame). Higher number = bottom of source visible (photo "moves up").
 *
 *  Unlike the compare slider this is a vertical pan within a fixed frame —
 *  no zoom (beyond the constant 1.3 we apply for headroom), no horizontal
 *  pan; we only need head-y alignment. */
export function AdjustOffsetDialog({ open, onClose, photo, kind, blob, onSaved }: Props) {
  const [offset, setOffset] = useState<number>(photo?.crop_offset_y ?? 50);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ y: number; offset: number } | null>(null);

  useEffect(() => {
    if (open && photo) {
      setOffset(photo.crop_offset_y ?? 50);
      setError(null);
      setAutoDetected(false);
    }
  }, [open, photo]);

  useEffect(() => {
    if (photo && isLocalStub(photo.blob_url) && blob) {
      const url = URL.createObjectURL(blob);
      setObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setObjectUrl(null);
  }, [photo, blob]);

  // Body scroll lock while open — otherwise the page behind the dialog
  // scrolls when the user drags inside the photo frame on iOS.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Auto-detect on open when no offset has been set yet. Fetches the image
  // as a Blob (or uses the local Blob for `local:*` stubs) and runs the
  // FaceDetector → TFJS fallback chain. First successful detection wins.
  // Treat both null and undefined (legacy Dexie rows) as "no offset".
  useEffect(() => {
    if (!open || !photo) return;
    if (typeof photo.crop_offset_y === 'number') return;
    let cancelled = false;
    (async () => {
      setDetecting(true);
      try {
        let detectionBlob: Blob | null = blob ?? null;
        if (!detectionBlob && !isLocalStub(photo.blob_url)) {
          // Fetch the Vercel Blob image. Cross-origin is fine — Vercel Blob
          // serves with permissive CORS.
          const res = await fetch(photo.blob_url);
          if (res.ok) detectionBlob = await res.blob();
        }
        if (!detectionBlob || cancelled) return;
        const detected = await tryDetectFaceY(detectionBlob);
        if (cancelled) return;
        if (detected !== null) {
          setOffset(detected);
          setAutoDetected(true);
        }
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, photo, blob]);

  if (!open || !photo) return null;

  const src = isLocalStub(photo.blob_url) ? objectUrl : photo.blob_url;

  // Convert pixel drag distance to a 0-100 offset delta. Using the frame's
  // own height as the unit means a drag the full height moves the offset
  // by 100% — direct manipulation feel. We invert because dragging UP should
  // INCREASE the offset (showing more of the bottom of the source image).
  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragStartRef.current = { y: e.clientY, offset };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start || !containerRef.current) return;
    const frameH = containerRef.current.getBoundingClientRect().height;
    const dy = e.clientY - start.y;
    // Drag up (dy < 0) → offset up (smaller y%), so subtract.
    // Drag down (dy > 0) → offset down (larger y%), so add.
    const delta = (dy / frameH) * 100;
    const next = Math.max(0, Math.min(100, start.offset + delta));
    setOffset(next);
  };
  const handlePointerUp = () => {
    dragStartRef.current = null;
  };

  const handleSave = async () => {
    if (!photo) return;
    setSaving(true);
    setError(null);
    try {
      const rounded = Math.round(offset * 10) / 10;
      const res = await fetch(`${ROUTES[kind]}/${photo.uuid}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.NEXT_PUBLIC_REBIRTH_API_KEY
            ? { 'X-Api-Key': process.env.NEXT_PUBLIC_REBIRTH_API_KEY }
            : {}),
        },
        body: JSON.stringify({ crop_offset_y: rounded }),
      });
      if (!res.ok) {
        throw new Error(`Save failed: HTTP ${res.status}`);
      }
      onSaved(rounded);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setOffset(50);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col overscroll-contain">
      {/* Header — back button on the left, mirrors iOS push-nav. */}
      <div
        className="flex items-center gap-2 px-2 py-3 border-b border-white/10"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      >
        <button
          onClick={onClose}
          className="text-white/90 px-2 -ml-1 min-h-[44px] flex items-center gap-1"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
          <span className="text-sm">Back</span>
        </button>
        <div className="flex-1 text-center -ml-12">
          <h2 className="text-sm font-semibold text-white">Adjust alignment</h2>
          <p className="text-[11px] text-white/60">Drag to position the head</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div
          ref={containerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="relative w-full aspect-[3/4] overflow-hidden rounded-xl bg-zinc-900 select-none touch-none cursor-grab active:cursor-grabbing"
        >
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt="Adjust"
              className="absolute inset-0 w-full h-full"
              style={{
                objectFit: 'cover',
                transform: offsetTransform(offset),
                transformOrigin: 'center',
              }}
              draggable={false}
            />
          ) : (
            <div className="w-full h-full bg-zinc-900 animate-pulse" />
          )}

          {/* Head anchor guide — a thin line at 25% from top to show where
              the face should land for compare-frame alignment. */}
          <div
            className="absolute left-0 right-0 border-t-2 border-trans-blue pointer-events-none"
            style={{ top: '25%' }}
          />
          <span className="absolute top-[26%] left-2 text-[10px] uppercase tracking-wide text-trans-blue pointer-events-none font-semibold">
            Head anchor
          </span>

          {/* Auto-detection hint — overlay while running, badge when
              the prefilled offset came from detection. */}
          {detecting && (
            <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] uppercase tracking-wide text-trans-blue">
              <Sparkles className="h-3 w-3 animate-pulse" />
              Auto-detecting…
            </div>
          )}
          {!detecting && autoDetected && (
            <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-trans-blue/80 px-2 py-1 text-[10px] uppercase tracking-wide text-white">
              <Sparkles className="h-3 w-3" />
              Auto
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 border border-white/15 text-white/80 text-xs font-medium rounded-lg"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
          <span className="text-xs text-white/50">offset: {offset.toFixed(1)}%</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="ml-auto px-4 py-2 bg-trans-blue text-white text-sm font-medium rounded-lg disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
