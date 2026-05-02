'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { X, ChevronLeft, ChevronRight, Sparkles, Plus } from 'lucide-react';
import type { ProjectionPhoto, ProgressPhotoPose } from '@/types';
import { apiBase, fetchJsonAuthed } from '@/lib/api/client';

interface ProgressPhotoLike {
  uuid: string;
  blob_url: string;
  pose: ProgressPhotoPose;
  taken_at: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** The progress photo Lou tapped Compare on. Drives default pose + framing. */
  source: ProgressPhotoLike | null;
}

const POSE_ORDER: ProgressPhotoPose[] = ['front', 'side', 'back'];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Draggable before/after divider over a single image-stack. Real (source)
 *  on the left under the "before" half, projection on the right under the
 *  "after" half. Pinch-zoom is left to the browser default; the slider is
 *  the primary interaction. */
function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  beforeLabel,
  afterLabel,
}: {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel: string;
  afterLabel: string;
}) {
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

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="relative w-full aspect-[3/4] overflow-hidden rounded-xl bg-zinc-900 select-none touch-none"
    >
      {/* Projection (full, behind) */}
      <Image
        src={afterUrl}
        alt={afterLabel}
        fill
        sizes="(max-width: 768px) 100vw, 600px"
        className="object-cover"
        unoptimized
        draggable={false}
      />
      {/* Real photo (clipped to left half) */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
      >
        <Image
          src={beforeUrl}
          alt={beforeLabel}
          fill
          sizes="(max-width: 768px) 100vw, 600px"
          className="object-cover"
          unoptimized
          draggable={false}
        />
      </div>

      {/* Divider */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none"
        style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center">
          <ChevronLeft className="h-4 w-4 text-zinc-700 -mr-1" />
          <ChevronRight className="h-4 w-4 text-zinc-700 -ml-1" />
        </div>
      </div>

      {/* Labels */}
      <span className="absolute top-2 left-2 text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded bg-black/60 text-white">
        {beforeLabel}
      </span>
      <span className="absolute top-2 right-2 text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded bg-trans-blue/80 text-white">
        {afterLabel}
      </span>
    </div>
  );
}

export function CompareWithProjectionDialog({ open, onClose, source }: Props) {
  const [projections, setProjections] = useState<ProjectionPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pose, setPose] = useState<ProgressPhotoPose | null>(source?.pose ?? null);
  const [activeUuid, setActiveUuid] = useState<string | null>(null);

  // Load all projections once on open. Pose-mismatch UX needs visibility into
  // what poses DO exist when the requested pose has none.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setProjections(null);
    fetchJsonAuthed<ProjectionPhoto[]>(`${apiBase()}/api/projection-photos?limit=100`)
      .then(setProjections)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [open]);

  // Reset pose to the source's pose whenever a new source is opened.
  useEffect(() => {
    if (open) setPose(source?.pose ?? null);
  }, [open, source]);

  // Pick the projection to show. Prefer:
  //   1. The projection whose source_progress_photo_uuid === source.uuid
  //   2. The newest projection at the active pose
  // Lou can swipe through alternates via the strip below.
  const visible = useMemo(() => {
    if (!projections || !pose) return [];
    return projections
      .filter((p) => p.pose === pose)
      .sort((a, b) => {
        const aLink = source && a.source_progress_photo_uuid === source.uuid ? -1 : 0;
        const bLink = source && b.source_progress_photo_uuid === source.uuid ? -1 : 0;
        if (aLink !== bLink) return aLink - bLink;
        return b.taken_at.localeCompare(a.taken_at);
      });
  }, [projections, pose, source]);

  const active = visible.find((p) => p.uuid === activeUuid) ?? visible[0] ?? null;

  // When the visible list changes, default activeUuid to the first one.
  useEffect(() => {
    if (visible.length > 0 && (!activeUuid || !visible.some((p) => p.uuid === activeUuid))) {
      setActiveUuid(visible[0].uuid);
    }
  }, [visible, activeUuid]);

  const otherPosesWithProjections: ProgressPhotoPose[] = useMemo(() => {
    if (!projections) return [];
    const withAny = new Set<ProgressPhotoPose>();
    for (const p of projections) withAny.add(p.pose);
    return POSE_ORDER.filter((x) => x !== pose && withAny.has(x));
  }, [projections, pose]);

  if (!open || !source) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-white/10"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      >
        <div>
          <h2 className="text-sm font-semibold text-white">Compare with Projection</h2>
          <p className="text-[11px] text-white/60">
            {source.pose} · {formatDate(source.taken_at)}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-white/80 p-2 -mr-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Pose chip strip — switching pose shows a different projection at
            that pose. Source pose stays highlighted as the "matched" one. */}
        <div className="flex gap-2">
          {POSE_ORDER.map((p) => {
            const count = projections?.filter((x) => x.pose === p).length ?? 0;
            const isSource = p === source.pose;
            const isActive = p === pose;
            return (
              <button
                key={p}
                onClick={() => setPose(p)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize border transition-colors ${
                  isActive
                    ? 'bg-trans-blue/20 text-trans-blue border-trans-blue'
                    : 'border-white/15 text-white/70'
                }`}
              >
                {p}
                {isSource && <span className="ml-1 text-[9px] opacity-60">(source)</span>}
                <span className="ml-1 text-[10px] opacity-60">{count}</span>
              </button>
            );
          })}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {projections === null && !error && (
          <div className="aspect-[3/4] rounded-xl bg-zinc-900 animate-pulse" />
        )}

        {projections !== null && active ? (
          <>
            <BeforeAfterSlider
              beforeUrl={source.blob_url}
              afterUrl={active.blob_url}
              beforeLabel="Now"
              afterLabel={active.target_horizon ?? 'Projection'}
            />

            {/* Metadata */}
            <div className="text-xs text-white/70 space-y-0.5">
              {active.notes && <p>{active.notes}</p>}
              <p className="text-white/40">
                Projection {formatDate(active.taken_at)}
                {active.source_progress_photo_uuid === source.uuid && (
                  <span className="ml-2 text-trans-blue">· linked to this photo</span>
                )}
              </p>
            </div>

            {/* Carousel of alternate projections at this pose */}
            {visible.length > 1 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-white/50 mb-1.5">
                  Other {pose} projections
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                  {visible.map((p) => {
                    const isActive = p.uuid === active.uuid;
                    return (
                      <button
                        key={p.uuid}
                        onClick={() => setActiveUuid(p.uuid)}
                        className={`relative flex-none w-16 aspect-[3/4] rounded-lg overflow-hidden border-2 transition-colors ${
                          isActive ? 'border-trans-blue' : 'border-transparent'
                        }`}
                      >
                        <Image
                          src={p.blob_url}
                          alt={p.notes ?? 'Projection'}
                          fill
                          sizes="64px"
                          className="object-cover"
                          unoptimized
                        />
                        {p.target_horizon && (
                          <span className="absolute bottom-0.5 left-0.5 text-[8px] uppercase font-semibold px-1 py-0.5 rounded bg-black/60 text-white">
                            {p.target_horizon}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          projections !== null && (
            <PoseMismatchEmptyState
              pose={pose ?? source.pose}
              otherPoses={otherPosesWithProjections}
              onSwitchPose={setPose}
            />
          )
        )}
      </div>
    </div>
  );
}

function PoseMismatchEmptyState({
  pose,
  otherPoses,
  onSwitchPose,
}: {
  pose: ProgressPhotoPose;
  otherPoses: ProgressPhotoPose[];
  onSwitchPose: (pose: ProgressPhotoPose) => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-white/15 p-6 flex flex-col items-center gap-3 text-white/80">
      <Sparkles className="h-8 w-8 text-trans-blue" />
      <p className="text-sm font-medium">No {pose} projection yet</p>
      <p className="text-xs text-white/50 text-center max-w-xs">
        Generate one elsewhere and upload it to compare against this photo.
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        <Link
          href="/projections"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-trans-blue text-white text-xs font-medium rounded-lg"
        >
          <Plus className="h-3.5 w-3.5" />
          Upload projection
        </Link>
        {otherPoses.map((p) => (
          <button
            key={p}
            onClick={() => onSwitchPose(p)}
            className="px-3 py-1.5 border border-white/15 text-white/80 text-xs font-medium rounded-lg capitalize"
          >
            View {p}
          </button>
        ))}
      </div>
    </div>
  );
}
