'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Link from 'next/link';
import { X, ChevronLeft, ChevronRight, Sparkles, Plus, Move } from 'lucide-react';
import type { ProjectionPhoto, InspoPhoto, ProgressPhotoPose } from '@/types';
import { apiBase, fetchJsonAuthed } from '@/lib/api/client';

export type CompareTarget = 'projection' | 'inspo';

interface ProgressPhotoLike {
  uuid: string;
  blob_url: string;
  pose: ProgressPhotoPose;
  taken_at: string;
  crop_offset_y?: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  source: ProgressPhotoLike | null;
  /** Defaults to 'projection'. */
  defaultTarget?: CompareTarget;
  /** When set + matches a target at the active pose, this specific item is
   *  pre-selected in the carousel. Used when launching from /strategy where
   *  Lou taps a specific projection/inspo thumb. */
  defaultTargetUuid?: string | null;
  /** Open the adjust-offset dialog for this photo. Parent owns the dialog. */
  onAdjust: (
    photo: { uuid: string; blob_url: string; crop_offset_y: number | null },
    kind: 'progress' | 'inspo' | 'projection',
  ) => void;
}

const POSE_ORDER: ProgressPhotoPose[] = ['front', 'side', 'back'];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Draggable before/after divider with per-photo crop_offset_y applied via
 *  CSS object-position so heads line up across the slider. */
function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  beforeOffset,
  afterOffset,
  beforeLabel,
  afterLabel,
  accent,
}: {
  beforeUrl: string;
  afterUrl: string;
  beforeOffset: number | null;
  afterOffset: number | null;
  beforeLabel: string;
  afterLabel: string;
  accent: 'trans-blue' | 'trans-pink';
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

  const beforeY = beforeOffset ?? 50;
  const afterY = afterOffset ?? 50;
  const accentBg = accent === 'trans-blue' ? 'bg-trans-blue/80' : 'bg-trans-pink/80';

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="relative w-full aspect-[3/4] overflow-hidden rounded-xl bg-zinc-900 select-none touch-none"
    >
      {/* Target (full, behind) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={afterUrl}
        alt={afterLabel}
        className="absolute inset-0 w-full h-full"
        style={{ objectFit: 'cover', objectPosition: `center ${afterY}%` }}
        draggable={false}
      />
      {/* Source (clipped to left half) */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={beforeUrl}
          alt={beforeLabel}
          className="absolute inset-0 w-full h-full"
          style={{ objectFit: 'cover', objectPosition: `center ${beforeY}%` }}
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
      <span className={`absolute top-2 right-2 text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded text-white ${accentBg}`}>
        {afterLabel}
      </span>
    </div>
  );
}

interface ActivePhoto {
  uuid: string;
  blob_url: string;
  pose: ProgressPhotoPose;
  taken_at: string;
  notes: string | null;
  crop_offset_y: number | null;
  /** Projection-specific (undefined for inspo). */
  target_horizon?: string | null;
  source_progress_photo_uuid?: string | null;
}

export function CompareDialog({ open, onClose, source, defaultTarget = 'projection', defaultTargetUuid, onAdjust }: Props) {
  const [target, setTarget] = useState<CompareTarget>(defaultTarget);
  const [projections, setProjections] = useState<ProjectionPhoto[] | null>(null);
  const [inspos, setInspos] = useState<InspoPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pose, setPose] = useState<ProgressPhotoPose | null>(source?.pose ?? null);
  const [activeUuid, setActiveUuid] = useState<string | null>(null);

  // Fetch both target lists once on open.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setProjections(null);
    setInspos(null);
    Promise.all([
      fetchJsonAuthed<ProjectionPhoto[]>(`${apiBase()}/api/projection-photos?limit=100`),
      fetchJsonAuthed<InspoPhoto[]>(`${apiBase()}/api/inspo-photos?limit=200`),
    ])
      .then(([p, i]) => {
        setProjections(p);
        setInspos(i);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [open]);

  useEffect(() => {
    if (open) {
      setPose(source?.pose ?? null);
      setTarget(defaultTarget);
    }
  }, [open, source, defaultTarget]);

  // Active list of candidate target photos at the chosen pose, ordered with
  // any source-linked projection first, then newest first.
  const candidates: ActivePhoto[] = useMemo(() => {
    if (!pose) return [];
    if (target === 'projection') {
      if (!projections) return [];
      return projections
        .filter((p) => p.pose === pose)
        .sort((a, b) => {
          const aLink = source && a.source_progress_photo_uuid === source.uuid ? -1 : 0;
          const bLink = source && b.source_progress_photo_uuid === source.uuid ? -1 : 0;
          if (aLink !== bLink) return aLink - bLink;
          return b.taken_at.localeCompare(a.taken_at);
        })
        .map((p) => ({
          uuid: p.uuid,
          blob_url: p.blob_url,
          pose: p.pose,
          taken_at: p.taken_at,
          notes: p.notes,
          crop_offset_y: p.crop_offset_y,
          target_horizon: p.target_horizon,
          source_progress_photo_uuid: p.source_progress_photo_uuid,
        }));
    } else {
      if (!inspos) return [];
      return inspos
        .filter((p) => p.pose === pose) // 'other' inspo never matches a progress pose
        .sort((a, b) => b.taken_at.localeCompare(a.taken_at))
        .map((p) => ({
          uuid: p.uuid,
          blob_url: p.blob_url,
          pose: pose,
          taken_at: p.taken_at,
          notes: p.notes,
          crop_offset_y: p.crop_offset_y,
        }));
    }
  }, [target, projections, inspos, pose, source]);

  const active = candidates.find((p) => p.uuid === activeUuid) ?? candidates[0] ?? null;

  useEffect(() => {
    if (candidates.length === 0) return;
    // Prefer the caller-supplied default-target uuid when it lands at the
    // active pose. Otherwise fall through to the first candidate.
    if (defaultTargetUuid && candidates.some((p) => p.uuid === defaultTargetUuid)) {
      if (activeUuid !== defaultTargetUuid) setActiveUuid(defaultTargetUuid);
      return;
    }
    if (!activeUuid || !candidates.some((p) => p.uuid === activeUuid)) {
      setActiveUuid(candidates[0].uuid);
    }
  }, [candidates, activeUuid, defaultTargetUuid]);

  // Clear active selection when target type changes so we don't carry a uuid
  // from one list to the other.
  useEffect(() => {
    setActiveUuid(null);
  }, [target]);

  const otherPosesWithCandidates: ProgressPhotoPose[] = useMemo(() => {
    const list = target === 'projection' ? projections : inspos;
    if (!list) return [];
    const withAny = new Set<ProgressPhotoPose>();
    for (const p of list) {
      if (p.pose === 'front' || p.pose === 'side' || p.pose === 'back') {
        withAny.add(p.pose as ProgressPhotoPose);
      }
    }
    return POSE_ORDER.filter((x) => x !== pose && withAny.has(x));
  }, [target, projections, inspos, pose]);

  const counts = useMemo(() => {
    const list = target === 'projection' ? projections : inspos;
    const out: Record<ProgressPhotoPose, number> = { front: 0, side: 0, back: 0 };
    for (const p of list ?? []) {
      if (p.pose === 'front' || p.pose === 'side' || p.pose === 'back') out[p.pose as ProgressPhotoPose]++;
    }
    return out;
  }, [target, projections, inspos]);

  const totalCounts = {
    projection: projections?.length ?? 0,
    inspo: inspos?.filter((p) => p.pose === 'front' || p.pose === 'side' || p.pose === 'back').length ?? 0,
  };

  const accent: 'trans-blue' | 'trans-pink' = target === 'projection' ? 'trans-blue' : 'trans-pink';
  const targetLabel = target === 'projection' ? 'Projection' : 'Inspiration';

  if (!open || !source) return null;

  const dataLoaded = projections !== null && inspos !== null;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-white/10"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      >
        <div>
          <h2 className="text-sm font-semibold text-white">Compare with {targetLabel}</h2>
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
        {/* Target-type toggle */}
        <div className="flex gap-1 p-1 bg-white/5 rounded-lg">
          {(['projection', 'inspo'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTarget(t)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                target === t
                  ? t === 'projection'
                    ? 'bg-trans-blue/20 text-trans-blue'
                    : 'bg-trans-pink/20 text-trans-pink'
                  : 'text-white/60'
              }`}
            >
              {t === 'projection' ? 'Projection' : 'Inspiration'}
              <span className="ml-1.5 text-[10px] opacity-60">{totalCounts[t]}</span>
            </button>
          ))}
        </div>

        {/* Pose chip strip */}
        <div className="flex gap-2">
          {POSE_ORDER.map((p) => {
            const count = counts[p];
            const isSource = p === source.pose;
            const isActive = p === pose;
            const activeCls = target === 'projection'
              ? 'bg-trans-blue/20 text-trans-blue border-trans-blue'
              : 'bg-trans-pink/20 text-trans-pink border-trans-pink';
            return (
              <button
                key={p}
                onClick={() => setPose(p)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize border transition-colors ${
                  isActive ? activeCls : 'border-white/15 text-white/70'
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

        {!dataLoaded && !error && (
          <div className="aspect-[3/4] rounded-xl bg-zinc-900 animate-pulse" />
        )}

        {dataLoaded && active ? (
          <>
            <BeforeAfterSlider
              beforeUrl={source.blob_url}
              afterUrl={active.blob_url}
              beforeOffset={source.crop_offset_y ?? null}
              afterOffset={active.crop_offset_y}
              beforeLabel="Now"
              afterLabel={
                target === 'projection'
                  ? (active.target_horizon ?? 'Projection')
                  : 'Inspiration'
              }
              accent={accent}
            />

            {/* Adjust controls — one button per side */}
            <div className="flex gap-2">
              <button
                onClick={() => onAdjust({ uuid: source.uuid, blob_url: source.blob_url, crop_offset_y: source.crop_offset_y ?? null }, 'progress')}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-white/15 text-white/80 text-xs font-medium rounded-lg"
              >
                <Move className="h-3.5 w-3.5" />
                Adjust source
              </button>
              <button
                onClick={() => onAdjust({ uuid: active.uuid, blob_url: active.blob_url, crop_offset_y: active.crop_offset_y }, target)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-white/15 text-white/80 text-xs font-medium rounded-lg"
              >
                <Move className="h-3.5 w-3.5" />
                Adjust {target === 'projection' ? 'projection' : 'inspo'}
              </button>
            </div>

            {/* Metadata */}
            <div className="text-xs text-white/70 space-y-0.5">
              {active.notes && <p>{active.notes}</p>}
              <p className="text-white/40">
                {targetLabel} {formatDate(active.taken_at)}
                {target === 'projection' && active.source_progress_photo_uuid === source.uuid && (
                  <span className="ml-2 text-trans-blue">· linked to this photo</span>
                )}
              </p>
            </div>

            {/* Carousel of alternates */}
            {candidates.length > 1 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-white/50 mb-1.5">
                  Other {pose} {target === 'projection' ? 'projections' : 'inspo'}
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                  {candidates.map((p) => {
                    const isActive = p.uuid === active.uuid;
                    const borderCls = isActive
                      ? target === 'projection' ? 'border-trans-blue' : 'border-trans-pink'
                      : 'border-transparent';
                    return (
                      <button
                        key={p.uuid}
                        onClick={() => setActiveUuid(p.uuid)}
                        className={`relative flex-none w-16 aspect-[3/4] rounded-lg overflow-hidden border-2 transition-colors ${borderCls}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.blob_url}
                          alt={p.notes ?? targetLabel}
                          className="absolute inset-0 w-full h-full"
                          style={{ objectFit: 'cover', objectPosition: `center ${p.crop_offset_y ?? 50}%` }}
                          draggable={false}
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
          dataLoaded && (
            <PoseMismatchEmptyState
              target={target}
              pose={pose ?? source.pose}
              otherPoses={otherPosesWithCandidates}
              onSwitchPose={setPose}
            />
          )
        )}
      </div>
    </div>
  );
}

function PoseMismatchEmptyState({
  target,
  pose,
  otherPoses,
  onSwitchPose,
}: {
  target: CompareTarget;
  pose: ProgressPhotoPose;
  otherPoses: ProgressPhotoPose[];
  onSwitchPose: (pose: ProgressPhotoPose) => void;
}) {
  const targetLabel = target === 'projection' ? 'projection' : 'inspo';
  const uploadHref = target === 'projection' ? '/projections' : '/inspo';
  const uploadCopy = target === 'projection' ? 'Upload projection' : 'Capture inspo';
  const accentText = target === 'projection' ? 'text-trans-blue' : 'text-trans-pink';
  const accentBg = target === 'projection' ? 'bg-trans-blue' : 'bg-trans-pink';
  return (
    <div className="rounded-xl border border-dashed border-white/15 p-6 flex flex-col items-center gap-3 text-white/80">
      <Sparkles className={`h-8 w-8 ${accentText}`} />
      <p className="text-sm font-medium">No {pose} {targetLabel} yet</p>
      <p className="text-xs text-white/50 text-center max-w-xs">
        {target === 'projection'
          ? 'Generate one elsewhere and upload it to compare against this photo.'
          : 'Capture an inspo photo at this pose to compare against this photo.'}
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        <Link
          href={uploadHref}
          className={`flex items-center gap-1.5 px-3 py-1.5 ${accentBg} text-white text-xs font-medium rounded-lg`}
        >
          <Plus className="h-3.5 w-3.5" />
          {uploadCopy}
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
