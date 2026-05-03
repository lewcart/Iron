'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, GitCompare, Move, Play, Plus } from 'lucide-react';
import type { ProjectionPhoto, InspoPhoto, ProgressPhotoPose } from '@/types';
import { apiBase, fetchJsonAuthed } from '@/lib/api/client';
import { COMPARABLE_POSES, POSE_LABELS, isComparablePose } from '@/lib/poses';
import { useProgressPhotos } from '@/lib/useLocalDB-measurements';
import { offsetTransform } from '@/lib/photo-offset';
import { db } from '@/db/local';
import { syncEngine } from '@/lib/sync';
import { AdjustOffsetDialog, type AdjustablePhotoKind } from '@/app/measurements/AdjustOffsetDialog';
import { ModeToggle, type CompareMode, isCompareMode } from './ModeToggle';
import { SlideMode } from './modes/SlideMode';
import { SideBySideMode } from './modes/SideBySideMode';
import { BlendMode } from './modes/BlendMode';
import { DifferenceMode } from './modes/DifferenceMode';
import { SilhouetteMode } from './modes/SilhouetteMode';
import { TimelapseViewer, type TimelapseFrame } from './TimelapseViewer';
import { isPersonSegmentationAvailable } from '@/lib/native/person-segmentation';

// Feature flag — flip to false (NEXT_PUBLIC_SILHOUETTE_ENABLED=false) to
// hide the Outline mode entirely if a Vision API regression appears in
// production without rolling back the route + 4 CSS modes. Default ON.
const SILHOUETTE_ENABLED = process.env.NEXT_PUBLIC_SILHOUETTE_ENABLED !== 'false';

type CompareKind = 'projection' | 'inspo';

interface ActivePhoto {
  uuid: string;
  blob_url: string;
  pose: ProgressPhotoPose;
  taken_at: string;
  notes: string | null;
  crop_offset_y: number | null;
  mask_url: string | null;
  target_horizon?: string | null;
  source_progress_photo_uuid?: string | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: 'Europe/London',
  });
}

function ComparePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sourceUuid = searchParams?.get('source') ?? null;
  const initialKind: CompareKind = (searchParams?.get('kind') as CompareKind) === 'inspo' ? 'inspo' : 'projection';
  const initialTargetUuid = searchParams?.get('target') ?? null;
  const initialMode: CompareMode = isCompareMode(searchParams?.get('mode')) ? (searchParams!.get('mode') as CompareMode) : 'side';

  const [kind, setKind] = useState<CompareKind>(initialKind);
  const [mode, setMode] = useState<CompareMode>(initialMode);
  const [activeUuid, setActiveUuid] = useState<string | null>(initialTargetUuid);
  const [pose, setPose] = useState<ProgressPhotoPose | null>(null);
  const [projections, setProjections] = useState<ProjectionPhoto[] | null>(null);
  const [inspos, setInspos] = useState<InspoPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timelapseOpen, setTimelapseOpen] = useState(false);

  // Source photo derived live from Dexie. Edits from AdjustOffsetDialog flow
  // through Dexie, so source.crop_offset_y refreshes automatically.
  const allProgress = useProgressPhotos(100);
  const source = useMemo(() => allProgress.find((p) => p.uuid === sourceUuid) ?? null, [allProgress, sourceUuid]);

  // Adjust dialog state. onSaved patches local projection/inspo state so the
  // active mode renders the new offset without reopening — same pattern as
  // shipped fix in commit 864ecd3.
  const [adjustState, setAdjustState] = useState<{
    photo: { uuid: string; blob_url: string; crop_offset_y: number | null };
    kind: AdjustablePhotoKind;
    blob?: Blob | null;
    onSaved?: (newOffset: number | null) => void;
  } | null>(null);

  const handleAdjustSaved = useCallback(async (newOffset: number | null) => {
    if (!adjustState) return;
    if (adjustState.kind === 'progress') {
      try {
        await db.progress_photos.update(adjustState.photo.uuid, {
          crop_offset_y: newOffset,
          _synced: false,
          _updated_at: Date.now(),
        });
        syncEngine.schedulePush();
      } catch { /* non-fatal */ }
    }
    adjustState.onSaved?.(newOffset);
  }, [adjustState]);

  // Initialize pose from source as soon as it's available.
  useEffect(() => {
    if (source && pose === null) {
      setPose(source.pose);
    }
  }, [source, pose]);

  // Fetch both target lists once on mount.
  useEffect(() => {
    setError(null);
    Promise.all([
      fetchJsonAuthed<ProjectionPhoto[]>(`${apiBase()}/api/projection-photos?limit=100`),
      fetchJsonAuthed<InspoPhoto[]>(`${apiBase()}/api/inspo-photos?limit=200`),
    ])
      .then(([p, i]) => {
        setProjections(p);
        setInspos(i);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  // Push URL params on state changes so refresh + share-link work.
  useEffect(() => {
    if (!sourceUuid) return;
    const params = new URLSearchParams();
    params.set('source', sourceUuid);
    params.set('kind', kind);
    if (activeUuid) params.set('target', activeUuid);
    params.set('mode', mode);
    router.replace(`/photos/compare?${params.toString()}`, { scroll: false });
  }, [sourceUuid, kind, activeUuid, mode, router]);

  const candidates: ActivePhoto[] = useMemo(() => {
    if (!pose) return [];
    if (kind === 'projection') {
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
          mask_url: p.mask_url,
          target_horizon: p.target_horizon,
          source_progress_photo_uuid: p.source_progress_photo_uuid,
        }));
    }
    if (!inspos) return [];
    return inspos
      .filter((p) => p.pose === pose)
      .sort((a, b) => b.taken_at.localeCompare(a.taken_at))
      .map((p) => ({
        uuid: p.uuid,
        blob_url: p.blob_url,
        pose: pose,
        taken_at: p.taken_at,
        notes: p.notes,
        crop_offset_y: p.crop_offset_y,
        mask_url: p.mask_url,
      }));
  }, [kind, projections, inspos, pose, source]);

  const active = candidates.find((p) => p.uuid === activeUuid) ?? candidates[0] ?? null;

  // Auto-select first candidate when current selection is invalid.
  useEffect(() => {
    if (candidates.length === 0) return;
    if (activeUuid && candidates.some((p) => p.uuid === activeUuid)) return;
    setActiveUuid(candidates[0].uuid);
  }, [candidates, activeUuid]);

  // Reset active when kind changes — uuid is per-list.
  useEffect(() => {
    setActiveUuid(null);
  }, [kind]);

  const counts = useMemo(() => {
    const list = kind === 'projection' ? projections : inspos;
    const out: Partial<Record<ProgressPhotoPose, number>> = {};
    for (const p of list ?? []) {
      if (isComparablePose(p.pose)) {
        out[p.pose] = (out[p.pose] ?? 0) + 1;
      }
    }
    return out;
  }, [kind, projections, inspos]);

  const totalCounts = {
    projection: projections?.filter((p) => isComparablePose(p.pose)).length ?? 0,
    inspo: inspos?.filter((p) => isComparablePose(p.pose)).length ?? 0,
  };

  const accent: 'trans-blue' | 'trans-pink' = kind === 'projection' ? 'trans-blue' : 'trans-pink';
  const targetLabel = kind === 'projection' ? 'Projection' : 'Inspiration';

  // Time-lapse: every progress photo at the active pose, chronological.
  const timelapseFrames: TimelapseFrame[] = useMemo(() => {
    if (!pose) return [];
    return allProgress
      .filter((p) => p.pose === pose && p.uploaded === '1')
      .sort((a, b) => a.taken_at.localeCompare(b.taken_at))
      .map((p) => ({
        uuid: p.uuid,
        url: p.blob_url,
        offset: p.crop_offset_y,
        date: p.taken_at,
      }));
  }, [allProgress, pose]);

  const dataLoaded = projections !== null && inspos !== null;
  const silhouetteAvailable = SILHOUETTE_ENABLED && isPersonSegmentationAvailable();

  // Mask cache patcher — when SilhouetteMode freshly computes a mask, we
  // patch the local projection/inspo array so the next mode-toggle round-trip
  // doesn't re-run the segmentation.
  const handleMaskCached = useCallback((uuid: string, maskUrl: string) => {
    setProjections((prev) => prev?.map((p) => p.uuid === uuid ? { ...p, mask_url: maskUrl } : p) ?? null);
    setInspos((prev) => prev?.map((p) => p.uuid === uuid ? { ...p, mask_url: maskUrl } : p) ?? null);
  }, []);

  if (!sourceUuid) {
    return (
      <div className="min-h-screen bg-black/95 flex flex-col items-center justify-center text-white/70 p-8 gap-3">
        <p className="text-sm">No source photo selected.</p>
        <Link href="/measurements?tab=photos" className="text-trans-blue text-sm">Go to Photos →</Link>
      </div>
    );
  }

  const beforeOffsetForActive = source?.crop_offset_y ?? null;

  return (
    <div className="fixed inset-0 z-30 bg-black/95 flex flex-col overscroll-contain">
      {/* Header — iOS push-nav style. */}
      <div
        className="flex items-center gap-2 px-2 py-3 border-b border-white/10"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      >
        <button
          onClick={() => router.back()}
          className="text-white/90 px-2 -ml-1 min-h-[44px] flex items-center gap-1"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
          <span className="text-sm">Back</span>
        </button>
        <div className="flex-1 text-center -ml-12">
          <h1 className="text-sm font-semibold text-white">Compare with {targetLabel}</h1>
          {source && (
            <p className="text-[11px] text-white/60">
              {POSE_LABELS[source.pose]} · {formatDate(source.taken_at)}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Target-type toggle */}
        <div className="flex gap-1 p-1 bg-white/5 rounded-lg min-h-[48px]">
          {(['projection', 'inspo'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors min-h-[44px] ${
                kind === k
                  ? k === 'projection'
                    ? 'bg-trans-blue/20 text-trans-blue'
                    : 'bg-trans-pink/20 text-trans-pink'
                  : 'text-white/60'
              }`}
            >
              {k === 'projection' ? 'Projection' : 'Inspiration'}
              <span className="ml-1.5 text-[10px] opacity-60">{totalCounts[k]}</span>
            </button>
          ))}
        </div>

        {/* Pose chip strip */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none flex-nowrap -mx-4 px-4">
          {COMPARABLE_POSES.map((p) => {
            const count = counts[p] ?? 0;
            const isSource = source && p === source.pose;
            const isActive = p === pose;
            const activeCls = kind === 'projection'
              ? 'bg-trans-blue/20 text-trans-blue border-trans-blue'
              : 'bg-trans-pink/20 text-trans-pink border-trans-pink';
            return (
              <button
                key={p}
                onClick={() => setPose(p)}
                className={`shrink-0 px-3 min-h-[44px] rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${
                  isActive ? activeCls : 'border-white/15 text-white/70'
                }`}
              >
                {POSE_LABELS[p]}
                {isSource && <span className="ml-1 text-[9px] opacity-60">(source)</span>}
                <span className="ml-1 text-[10px] opacity-60">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Mode toggle + Time-lapse Play in one row */}
        <div className="flex gap-2 items-stretch">
          <div className="flex-1">
            <ModeToggle mode={mode} onChange={setMode} accent={accent} silhouetteAvailable={silhouetteAvailable} />
          </div>
          {timelapseFrames.length >= 2 && (
            <button
              onClick={() => setTimelapseOpen(true)}
              className="px-3 rounded-lg bg-white/10 text-white text-xs font-medium flex items-center gap-1.5 min-h-[48px] min-w-[48px]"
              aria-label="Open time-lapse"
            >
              <Play className="h-4 w-4" />
              <span>Play</span>
            </button>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {!dataLoaded && !error && (
          <div className="aspect-[3/4] rounded-xl bg-zinc-900 animate-pulse" />
        )}

        {dataLoaded && active && source ? (
          <>
            {mode === 'slide' && (
              <SlideMode
                beforeUrl={source.blob_url}
                afterUrl={active.blob_url}
                beforeOffset={beforeOffsetForActive}
                afterOffset={active.crop_offset_y}
                beforeLabel="Now"
                afterLabel={kind === 'projection' ? (active.target_horizon ?? 'Projection') : 'Inspiration'}
                accent={accent}
              />
            )}
            {mode === 'side' && (
              <SideBySideMode
                beforeUrl={source.blob_url}
                afterUrl={active.blob_url}
                beforeOffset={beforeOffsetForActive}
                afterOffset={active.crop_offset_y}
                beforeLabel="Now"
                afterLabel={kind === 'projection' ? (active.target_horizon ?? 'Projection') : 'Inspiration'}
                accent={accent}
              />
            )}
            {mode === 'blend' && (
              <BlendMode
                beforeUrl={source.blob_url}
                afterUrl={active.blob_url}
                beforeOffset={beforeOffsetForActive}
                afterOffset={active.crop_offset_y}
                beforeLabel="Now"
                afterLabel={kind === 'projection' ? (active.target_horizon ?? 'Projection') : 'Inspiration'}
                accent={accent}
              />
            )}
            {mode === 'diff' && (
              <DifferenceMode
                beforeUrl={source.blob_url}
                afterUrl={active.blob_url}
                beforeOffset={beforeOffsetForActive}
                afterOffset={active.crop_offset_y}
                beforeLabel="Now"
                afterLabel={kind === 'projection' ? (active.target_horizon ?? 'Projection') : 'Inspiration'}
                accent={accent}
              />
            )}
            {mode === 'silhouette' && (
              <SilhouetteMode
                beforeUrl={source.blob_url}
                afterUrl={active.blob_url}
                beforeOffset={beforeOffsetForActive}
                afterOffset={active.crop_offset_y}
                beforeLabel="Now"
                afterLabel={kind === 'projection' ? (active.target_horizon ?? 'Projection') : 'Inspiration'}
                accent={accent}
                beforePhoto={{
                  uuid: source.uuid,
                  blob_url: source.blob_url,
                  mask_url: source.mask_url ?? null,
                  kind: 'progress',
                }}
                afterPhoto={{
                  uuid: active.uuid,
                  blob_url: active.blob_url,
                  mask_url: active.mask_url,
                  kind,
                }}
                onMaskCached={handleMaskCached}
              />
            )}

            {/* Adjust controls */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setAdjustState({
                    photo: {
                      uuid: source.uuid,
                      blob_url: source.blob_url,
                      crop_offset_y: source.crop_offset_y,
                    },
                    kind: 'progress',
                    blob: source.blob,
                  });
                }}
                className="flex items-center gap-1.5 px-3 border border-white/15 text-white/80 text-xs font-medium rounded-lg min-h-[44px]"
              >
                <Move className="h-3.5 w-3.5" />
                Adjust source
              </button>
              <button
                onClick={() => {
                  const activeUuidLocal = active.uuid;
                  setAdjustState({
                    photo: { uuid: active.uuid, blob_url: active.blob_url, crop_offset_y: active.crop_offset_y },
                    kind,
                    onSaved: (newOffset) => {
                      if (kind === 'projection') {
                        setProjections((prev) =>
                          prev?.map((p) => p.uuid === activeUuidLocal ? { ...p, crop_offset_y: newOffset } : p) ?? null,
                        );
                      } else {
                        setInspos((prev) =>
                          prev?.map((p) => p.uuid === activeUuidLocal ? { ...p, crop_offset_y: newOffset } : p) ?? null,
                        );
                      }
                    },
                  });
                }}
                className="flex items-center gap-1.5 px-3 border border-white/15 text-white/80 text-xs font-medium rounded-lg min-h-[44px]"
              >
                <Move className="h-3.5 w-3.5" />
                Adjust {kind === 'projection' ? 'projection' : 'inspo'}
              </button>
            </div>

            {/* Metadata + emotional-safety hints */}
            <div className="text-xs text-white/70 space-y-0.5">
              {active.notes && <p>{active.notes}</p>}
              <p className="text-white/40">
                {targetLabel} {formatDate(active.taken_at)}
                {kind === 'projection' && active.source_progress_photo_uuid === source.uuid && (
                  <span className="ml-2 text-trans-blue">· linked to this photo</span>
                )}
              </p>
              {(source.crop_offset_y === null || active.crop_offset_y === null) && (
                <p className="text-amber-400/80 text-[11px]">
                  ⚠ Heads not aligned — Adjust to compare shape accurately.
                </p>
              )}
            </div>

            {/* Carousel of alternates */}
            {candidates.length > 1 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-white/50 mb-1.5">
                  Other {pose ? POSE_LABELS[pose].toLowerCase() : ''} {kind === 'projection' ? 'projections' : 'inspo'}
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                  {candidates.map((p) => {
                    const isActive = p.uuid === active.uuid;
                    const borderCls = isActive
                      ? kind === 'projection' ? 'border-trans-blue' : 'border-trans-pink'
                      : 'border-transparent';
                    return (
                      <button
                        key={p.uuid}
                        onClick={() => setActiveUuid(p.uuid)}
                        className={`relative flex-none w-16 aspect-[3/4] rounded-lg overflow-hidden border-2 transition-colors ${borderCls}`}
                        aria-label={`Select ${formatDate(p.taken_at)}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.blob_url}
                          alt={p.notes ?? targetLabel}
                          className="absolute inset-0 w-full h-full"
                          style={{
                            objectFit: 'cover',
                            transform: offsetTransform(p.crop_offset_y),
                            transformOrigin: 'center',
                          }}
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
        ) : dataLoaded ? (
          <PoseMismatchEmpty kind={kind} pose={pose ?? source?.pose ?? 'front'} onSwitchPose={setPose} />
        ) : null}
      </div>

      <AdjustOffsetDialog
        open={adjustState !== null}
        onClose={() => setAdjustState(null)}
        photo={adjustState?.photo ?? null}
        kind={adjustState?.kind ?? 'progress'}
        blob={adjustState?.blob ?? null}
        onSaved={handleAdjustSaved}
      />

      <TimelapseViewer
        open={timelapseOpen}
        onClose={() => setTimelapseOpen(false)}
        frames={timelapseFrames}
      />
    </div>
  );
}

function PoseMismatchEmpty({
  kind,
  pose,
  onSwitchPose,
}: {
  kind: CompareKind;
  pose: ProgressPhotoPose;
  onSwitchPose: (pose: ProgressPhotoPose) => void;
}) {
  const targetLabel = kind === 'projection' ? 'projection' : 'inspo';
  const uploadHref = kind === 'projection' ? '/projections' : '/inspo';
  const uploadCopy = kind === 'projection' ? 'Upload projection' : 'Capture inspo';
  const accentBg = kind === 'projection' ? 'bg-trans-blue' : 'bg-trans-pink';
  return (
    <div className="rounded-xl border border-dashed border-white/15 p-6 flex flex-col items-center gap-3 text-white/80">
      <GitCompare className="h-8 w-8 text-white/40" />
      <p className="text-sm font-medium">No {POSE_LABELS[pose].toLowerCase()} {targetLabel} yet</p>
      <p className="text-xs text-white/50 text-center max-w-xs">
        {kind === 'projection'
          ? 'Generate one elsewhere and upload it to compare against this photo.'
          : 'Capture an inspo photo at this pose to compare against this photo.'}
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        <Link
          href={uploadHref}
          className={`flex items-center gap-1.5 px-3 ${accentBg} text-white text-xs font-medium rounded-lg min-h-[44px]`}
        >
          <Plus className="h-3.5 w-3.5" />
          {uploadCopy}
        </Link>
        {COMPARABLE_POSES.filter((p) => p !== pose).slice(0, 2).map((p) => (
          <button
            key={p}
            onClick={() => onSwitchPose(p)}
            className="px-3 border border-white/15 text-white/80 text-xs font-medium rounded-lg min-h-[44px]"
          >
            View {POSE_LABELS[p]}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 z-30 bg-black/95" />}>
      <ComparePageInner />
    </Suspense>
  );
}
