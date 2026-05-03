'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { offsetTransform } from '@/lib/photo-offset';
import { ensureMask, type PhotoKind, type MaskablePhoto } from '@/lib/silhouette';
import { isPersonSegmentationAvailable } from '@/lib/native/person-segmentation';
import type { BaseCompareProps } from './types';

export interface SilhouetteModeProps extends BaseCompareProps {
  /** The two photos this mode needs masks for. Caller (page.tsx) provides
   *  uuid + kind + cached mask_url so we can dedupe + persist properly. */
  beforePhoto: MaskablePhoto & { kind: PhotoKind };
  afterPhoto: MaskablePhoto & { kind: PhotoKind };
  /** Called when a mask is freshly computed so the parent can update its
   *  cached photo state (avoids re-running on every re-render). */
  onMaskCached?: (uuid: string, maskUrl: string) => void;
}

type LoadState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; beforeMask: string; afterMask: string }
  | { phase: 'error'; message: string };

/** Outline-only overlay using cached person-segmentation masks. Both image
 *  AND mask render with the SAME offsetTransform so heads stay anchored
 *  identically across the silhouette and the source frame. */
export function SilhouetteMode({
  // beforeUrl is part of BaseCompareProps for symmetry with the other modes,
  // but Silhouette only renders mask layers; image URLs accessed via
  // beforePhoto / afterPhoto.blob_url when needed.
  beforeUrl: _beforeUrl,
  afterUrl,
  beforeOffset,
  afterOffset,
  beforeLabel,
  afterLabel,
  accent,
  beforePhoto,
  afterPhoto,
  onMaskCached,
}: SilhouetteModeProps) {
  const [state, setState] = useState<LoadState>({ phase: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const accentBg = accent === 'trans-blue' ? 'bg-trans-blue/80' : 'bg-trans-pink/80';
  const supported = isPersonSegmentationAvailable();

  // Keep latest prop refs in a ref so the effect can read them without
  // listing the (inline-constructed) objects in deps. Otherwise every parent
  // re-render — Dexie liveQuery tick, router.replace URL sync, etc. —
  // produces new object references, the effect re-fires, aborts the in-flight
  // ensureMask, and the user sees "aborted" forever.
  const propsRef = useRef({ beforePhoto, afterPhoto, onMaskCached });
  propsRef.current = { beforePhoto, afterPhoto, onMaskCached };

  // Effect re-runs only when the IDENTITY of the photo pair or its cached
  // mask state actually changes (primitives), or when iOS support flips.
  useEffect(() => {
    if (!supported) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ phase: 'loading' });

    (async () => {
      const { beforePhoto: bp, afterPhoto: ap, onMaskCached: cb } = propsRef.current;
      try {
        const [b, a] = await Promise.all([
          ensureMask(bp, bp.kind, controller.signal),
          ensureMask(ap, ap.kind, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        if (b.computed) cb?.(bp.uuid, b.maskUrl);
        if (a.computed) cb?.(ap.uuid, a.maskUrl);
        setState({ phase: 'ready', beforeMask: b.maskUrl, afterMask: a.maskUrl });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({
          phase: 'error',
          message: err instanceof Error ? err.message : 'Mask generation failed',
        });
      }
    })();

    return () => controller.abort();
  }, [
    supported,
    beforePhoto.uuid,
    afterPhoto.uuid,
    beforePhoto.mask_url,
    afterPhoto.mask_url,
  ]);

  if (!supported) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 p-6 flex flex-col items-center gap-3 text-white/80 aspect-[3/4]">
        <Sparkles className="h-8 w-8 text-white/40" />
        <p className="text-sm font-medium">Silhouette compare needs the iOS app</p>
        <p className="text-xs text-white/50 text-center max-w-xs">
          On-device person segmentation runs natively on iOS. Web doesn&apos;t
          have a free equivalent yet — switch to Side-by-side or Blend.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-[3/4] overflow-hidden rounded-xl bg-zinc-900 select-none">
      {/* Loading overlay over the dimmed source image (not a skeleton —
          the image bytes are already known, the wait is for processing). */}
      {state.phase === 'loading' && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={afterUrl}
            alt={afterLabel}
            className="absolute inset-0 w-full h-full opacity-30"
            style={{
              objectFit: 'cover',
              transform: offsetTransform(afterOffset),
              transformOrigin: 'center',
            }}
            draggable={false}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-black/70 text-white/90 text-xs">
              <Sparkles className="h-3.5 w-3.5 animate-pulse text-trans-blue" />
              Tracing outlines…
            </div>
          </div>
        </>
      )}

      {state.phase === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="text-xs text-white/70">{state.message}</p>
        </div>
      )}

      {state.phase === 'ready' && (
        <>
          {/* After (background) — dim grayscale fill via the mask. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.afterMask}
            alt={`${afterLabel} silhouette`}
            className="absolute inset-0 w-full h-full"
            style={{
              objectFit: 'cover',
              transform: offsetTransform(afterOffset),
              transformOrigin: 'center',
              filter: accent === 'trans-blue'
                ? 'drop-shadow(0 0 1px #60a5fa) brightness(0.9)'
                : 'drop-shadow(0 0 1px #f9a8d4) brightness(0.9)',
              opacity: 0.85,
            }}
            draggable={false}
          />
          {/* Before (overlay) — second outline at 70% opacity, blended. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.beforeMask}
            alt={`${beforeLabel} silhouette`}
            className="absolute inset-0 w-full h-full mix-blend-screen"
            style={{
              objectFit: 'cover',
              transform: offsetTransform(beforeOffset),
              transformOrigin: 'center',
              filter: 'brightness(0.7)',
              opacity: 0.7,
            }}
            draggable={false}
          />
        </>
      )}

      <span className="absolute top-2 left-2 text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded bg-black/60 text-white">
        {beforeLabel}
      </span>
      <span className={`absolute top-2 right-2 text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded text-white ${accentBg}`}>
        {afterLabel}
      </span>
    </div>
  );
}
