'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';
import type { ProjectionPhoto, ProgressPhotoPose } from '@/types';
import { apiBase, fetchJsonAuthed } from '@/lib/api/client';
import { ProjectionUploadSheet } from './ProjectionUploadSheet';
import { ALL_POSES, POSE_LABELS } from '@/lib/poses';

const POSE_FILTERS: ('all' | ProgressPhotoPose)[] = ['all', ...ALL_POSES];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/London',
  });
}

function PhotoCard({
  photo,
  onDelete,
}: {
  photo: ProjectionPhoto;
  onDelete: (uuid: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await fetchJsonAuthed(`${apiBase()}/api/projection-photos/${photo.uuid}`, {
        method: 'DELETE',
      });
      onDelete(photo.uuid);
    } catch {
      setDeleting(false);
      setConfirming(false);
    }
  }, [photo.uuid, onDelete]);

  return (
    <div className="relative group">
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-zinc-800">
        <Image
          src={photo.blob_url}
          alt={photo.notes ?? `Projection ${formatDate(photo.taken_at)}`}
          fill
          sizes="(max-width: 640px) 50vw, 33vw"
          className="object-cover"
          unoptimized
        />
        {/* Pose + horizon badges */}
        <div className="absolute bottom-1 left-1 flex gap-1">
          <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-black/60 text-white">
            {POSE_LABELS[photo.pose] ?? photo.pose}
          </span>
          {photo.target_horizon && (
            <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-trans-blue/80 text-white">
              {photo.target_horizon}
            </span>
          )}
        </div>

        {/* Tap-target delete affordance — iOS WebView has no context menu so
            the long-press fallback was unreachable. ⋯ button mirrors the
            pattern in /measurements PhotoTile. */}
        <button
          onClick={() => setConfirming(true)}
          className="absolute top-1 right-1 h-7 w-7 rounded-full bg-black/70 text-white flex items-center justify-center shadow-md ring-1 ring-white/10 z-10"
          aria-label="Projection actions"
        >
          ⋯
        </button>
      </div>

      {confirming && (
        <div className="absolute inset-0 rounded-xl bg-black/70 flex flex-col items-center justify-center gap-3 z-20">
          <p className="text-white text-xs font-medium text-center px-2">Delete this projection?</p>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1 px-3 py-2 bg-red-600 text-white text-xs rounded-lg disabled:opacity-50 min-h-[44px]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="px-3 py-2 bg-zinc-700 text-white text-xs rounded-lg min-h-[44px]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectionsGalleryPage() {
  const [photos, setPhotos] = useState<ProjectionPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | ProgressPhotoPose>('all');
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    fetchJsonAuthed<ProjectionPhoto[]>(`${apiBase()}/api/projection-photos?limit=100`)
      .then(setPhotos)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = useCallback((uuid: string) => {
    setPhotos((prev) => prev.filter((p) => p.uuid !== uuid));
  }, []);

  const handleUploaded = useCallback((photo: ProjectionPhoto) => {
    setPhotos((prev) => [photo, ...prev]);
  }, []);

  const visible =
    filter === 'all' ? photos : photos.filter((p) => p.pose === filter);

  return (
    <div className="min-h-screen bg-background pb-safe-or-4">
      {/* Header */}
      <div
        className="sticky top-0 z-10 bg-background/95 backdrop-blur-md border-b border-border flex items-center gap-3 px-4 py-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      >
        <Link href="/strategy" className="text-muted-foreground">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-base font-semibold flex-1">Projections</h1>
        <button
          onClick={() => setSheetOpen(true)}
          className="flex items-center justify-center min-h-[44px] min-w-[44px] text-muted-foreground"
          aria-label="Upload projection"
        >
          <Plus className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </div>

      <div className="px-4 pt-4">
        <p className="text-xs text-muted-foreground mb-4">
          AI-generated previews of your future self. Compare them with progress
          photos at the same pose.
        </p>

        {/* Pose filter chips — single-line, scrollable so seven chips
            (all + six poses) don't wrap on phones. */}
        <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-none flex-nowrap -mx-4 px-4">
          {POSE_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-colors ${
                filter === f
                  ? 'bg-trans-blue/10 text-trans-blue border-trans-blue'
                  : 'border-border text-muted-foreground'
              }`}
            >
              {f === 'all' ? 'All' : POSE_LABELS[f]}
              {f !== 'all' && (
                <span className="ml-1 text-[10px] opacity-60">
                  {photos.filter((p) => p.pose === f).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {loading && (
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] rounded-xl bg-zinc-800 animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <p className="text-center text-sm text-muted-foreground mt-8">{error}</p>
        )}

        {!loading && !error && photos.length === 0 && (
          <div className="flex flex-col items-center justify-center mt-12 gap-3 text-muted-foreground">
            <span className="text-5xl">✨</span>
            <p className="text-sm text-center max-w-xs">
              No projections yet.
              <br />
              Generate a future-self preview elsewhere (ChatGPT, Midjourney, etc.)
              and upload it here to compare against your progress photos.
            </p>
            <button
              onClick={() => setSheetOpen(true)}
              className="mt-2 flex items-center gap-2 px-4 py-2 bg-trans-blue text-white text-sm font-medium rounded-lg"
            >
              <Plus className="h-4 w-4" />
              Upload your first
            </button>
          </div>
        )}

        {!loading && photos.length > 0 && visible.length === 0 && (
          <p className="text-center text-sm text-muted-foreground mt-8">
            No {filter} projections yet.
          </p>
        )}

        {!loading && visible.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {visible.map((photo) => (
              <PhotoCard key={photo.uuid} photo={photo} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      <ProjectionUploadSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onUploaded={handleUploaded}
      />
    </div>
  );
}
