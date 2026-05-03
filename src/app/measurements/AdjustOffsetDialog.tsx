'use client';

import { useEffect, useState, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, RotateCcw, Sparkles } from 'lucide-react';
import { isLocalStub } from '@/lib/photo-upload-queue';
import { tryDetectFaceCenter } from '@/lib/face-detect';
import { tryDetectBodyCenterX } from '@/lib/body-centroid';
import { offsetTransform } from '@/lib/photo-offset';

export type AdjustablePhotoKind = 'progress' | 'inspo' | 'projection';

export interface SavedOffsets {
  x: number | null;
  y: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  photo: {
    uuid: string;
    blob_url: string;
    crop_offset_y: number | null;
    crop_offset_x: number | null;
  } | null;
  kind: AdjustablePhotoKind;
  /** Locally-held Blob for `local:*` stubs (only for progress photos). */
  blob?: Blob | null;
  /** Cached silhouette mask URL — when present, body-centroid auto-detect
   *  uses it for X. Falls back to face-detect-x otherwise. */
  mask_url?: string | null;
  /** Called after the new offsets are persisted server-side (and synced for
   *  progress photos). The parent should refresh its data. */
  onSaved: (offsets: SavedOffsets) => void;
}

const ROUTES: Record<AdjustablePhotoKind, string> = {
  progress: '/api/progress-photos',
  inspo: '/api/inspo-photos',
  projection: '/api/projection-photos',
};

/** Drag the photo in any direction to align both head-y and body-center-x.
 *  Crosshair guides show the canonical alignment targets (head at 25% from
 *  top, body center at horizontal middle). Auto-detect prefers the silhouette
 *  centroid for X (best signal — works for back/side poses too) and falls
 *  back to face-detect-x; Y always uses face detection.
 *
 *  Stored as crop_offset_x and crop_offset_y (0-100 each). NULL = renderer
 *  defaults to 50 (center). */
export function AdjustOffsetDialog({ open, onClose, photo, kind, blob, mask_url, onSaved }: Props) {
  const [offsetY, setOffsetY] = useState<number>(photo?.crop_offset_y ?? 50);
  const [offsetX, setOffsetX] = useState<number>(photo?.crop_offset_x ?? 50);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    if (open && photo) {
      setOffsetY(photo.crop_offset_y ?? 50);
      setOffsetX(photo.crop_offset_x ?? 50);
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

  // Body scroll lock — without this the page behind the dialog scrolls when
  // the user drags inside the photo frame on iOS.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Auto-detect on open when at least one axis hasn't been set yet.
  // Y always uses face detection. X prefers silhouette centroid (better for
  // back / face_side poses where face detection misses) and falls back to
  // face-x when no mask is cached.
  useEffect(() => {
    if (!open || !photo) return;
    if (typeof photo.crop_offset_y === 'number' && typeof photo.crop_offset_x === 'number') return;
    let cancelled = false;
    (async () => {
      setDetecting(true);
      try {
        // Run both detectors in parallel.
        const facePromise = (async () => {
          let detectionBlob: Blob | null = blob ?? null;
          if (!detectionBlob && !isLocalStub(photo.blob_url)) {
            const res = await fetch(photo.blob_url);
            if (res.ok) detectionBlob = await res.blob();
          }
          if (!detectionBlob) return null;
          return tryDetectFaceCenter(detectionBlob);
        })();
        const centroidPromise = mask_url ? tryDetectBodyCenterX(mask_url) : Promise.resolve(null);

        const [face, centroid] = await Promise.all([facePromise, centroidPromise]);
        if (cancelled) return;

        let updated = false;
        if (typeof photo.crop_offset_y !== 'number' && face?.y != null) {
          setOffsetY(face.y);
          updated = true;
        }
        if (typeof photo.crop_offset_x !== 'number') {
          // Centroid wins; face-x is fallback.
          const x = centroid ?? face?.x ?? null;
          if (x != null) {
            setOffsetX(x);
            updated = true;
          }
        }
        if (updated) setAutoDetected(true);
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, photo, blob, mask_url]);

  if (!open || !photo) return null;

  const src = isLocalStub(photo.blob_url) ? objectUrl : photo.blob_url;

  // Convert pixel drag distance to a 0-100 offset delta on each axis. Frame
  // dimensions are the unit so a full-frame drag moves the offset by 100%.
  // Inverted on both axes: dragging UP shows MORE of the bottom (offset_y
  // grows); dragging LEFT shows MORE of the right (offset_x grows).
  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragStartRef.current = { x: e.clientX, y: e.clientY, offsetX, offsetY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const deltaX = (dx / rect.width) * 100;
    const deltaY = (dy / rect.height) * 100;
    setOffsetX(Math.max(0, Math.min(100, start.offsetX + deltaX)));
    setOffsetY(Math.max(0, Math.min(100, start.offsetY + deltaY)));
  };
  const handlePointerUp = () => {
    dragStartRef.current = null;
  };

  const handleSave = async () => {
    if (!photo) return;
    setSaving(true);
    setError(null);
    try {
      const roundedY = Math.round(offsetY * 10) / 10;
      const roundedX = Math.round(offsetX * 10) / 10;
      const res = await fetch(`${ROUTES[kind]}/${photo.uuid}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.NEXT_PUBLIC_REBIRTH_API_KEY
            ? { 'X-Api-Key': process.env.NEXT_PUBLIC_REBIRTH_API_KEY }
            : {}),
        },
        body: JSON.stringify({ crop_offset_y: roundedY, crop_offset_x: roundedX }),
      });
      if (!res.ok) {
        throw new Error(`Save failed: HTTP ${res.status}`);
      }
      onSaved({ x: roundedX, y: roundedY });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setOffsetX(50);
    setOffsetY(50);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col overscroll-contain">
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
          <p className="text-[11px] text-white/60">Drag in any direction</p>
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
                transform: offsetTransform(offsetX, offsetY),
                transformOrigin: 'center',
              }}
              draggable={false}
            />
          ) : (
            <div className="w-full h-full bg-zinc-900 animate-pulse" />
          )}

          {/* Crosshair guides — head anchor (horizontal) at 25% from top,
              body center (vertical) at 50% across. Drag the photo so the
              face sits on the horizontal line and the body straddles the
              vertical line. */}
          <div
            className="absolute left-0 right-0 border-t-2 border-trans-blue pointer-events-none"
            style={{ top: '25%' }}
          />
          <div
            className="absolute top-0 bottom-0 border-l-2 border-trans-blue pointer-events-none"
            style={{ left: '50%' }}
          />
          <span className="absolute top-[26%] left-2 text-[10px] uppercase tracking-wide text-trans-blue pointer-events-none font-semibold">
            Head anchor
          </span>
          <span className="absolute bottom-2 left-[51%] text-[10px] uppercase tracking-wide text-trans-blue pointer-events-none font-semibold">
            Body center
          </span>

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
            className="flex items-center gap-1.5 px-3 py-2 border border-white/15 text-white/80 text-xs font-medium rounded-lg min-h-[44px]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
          <span className="text-xs text-white/50">x {offsetX.toFixed(1)}% · y {offsetY.toFixed(1)}%</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="ml-auto px-4 py-2 bg-trans-blue text-white text-sm font-medium rounded-lg disabled:opacity-40 min-h-[44px]"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
