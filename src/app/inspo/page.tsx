'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronLeft, Trash2 } from 'lucide-react';
import type { InspoPhoto } from '@/types';
import { apiBase, fetchJsonAuthed } from '@/lib/api/client';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function PhotoCard({
  photo,
  onDelete,
}: {
  photo: InspoPhoto;
  onDelete: (uuid: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await fetchJsonAuthed(`${apiBase()}/api/inspo-photos/${photo.uuid}`, {
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
      <div
        className="relative aspect-[3/4] overflow-hidden rounded-xl bg-zinc-800"
        onContextMenu={(e) => {
          e.preventDefault();
          setConfirming(true);
        }}
      >
        <Image
          src={photo.blob_url}
          alt={photo.notes ?? `Inspo photo ${formatDate(photo.taken_at)}`}
          fill
          sizes="(max-width: 640px) 50vw, 33vw"
          className="object-cover"
          unoptimized
        />
      </div>

      {confirming && (
        <div className="absolute inset-0 rounded-xl bg-black/70 flex flex-col items-center justify-center gap-3 z-10">
          <p className="text-white text-xs font-medium">Delete?</p>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="px-3 py-1.5 bg-zinc-700 text-white text-xs rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BurstGroupRow({
  photos,
  onDelete,
}: {
  photos: InspoPhoto[];
  onDelete: (uuid: string) => void;
}) {
  const [deletingAll, setDeletingAll] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const handleDeleteAll = useCallback(async () => {
    setDeletingAll(true);
    try {
      await Promise.all(
        photos.map((p) =>
          fetchJsonAuthed(`${apiBase()}/api/inspo-photos/${p.uuid}`, { method: 'DELETE' }),
        ),
      );
      photos.forEach((p) => onDelete(p.uuid));
    } catch {
      setDeletingAll(false);
      setConfirmDeleteAll(false);
    }
  }, [photos, onDelete]);

  return (
    <div className="col-span-2 rounded-2xl border border-zinc-700/60 bg-zinc-900/60 p-2.5 space-y-2">
      {/* Burst header */}
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold tracking-widest text-zinc-400 uppercase">
            Burst · {photos.length} shots
          </span>
          <span className="text-[10px] text-zinc-500">{formatDate(photos[0].taken_at)}</span>
        </div>
        <button
          onClick={() => setConfirmDeleteAll(true)}
          className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors px-1.5 py-0.5 rounded"
        >
          Delete all
        </button>
      </div>

      {/* Horizontal scroll strip */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {photos.map((photo) => (
          <div key={photo.uuid} className="flex-none w-28">
            <PhotoCard photo={photo} onDelete={onDelete} />
          </div>
        ))}
      </div>

      {/* Delete all confirmation */}
      {confirmDeleteAll && (
        <div className="rounded-xl bg-black/70 flex items-center justify-center gap-3 py-2 px-3">
          <p className="text-white text-xs font-medium flex-1">Delete all {photos.length} shots?</p>
          <button
            onClick={handleDeleteAll}
            disabled={deletingAll}
            className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete all
          </button>
          <button
            onClick={() => setConfirmDeleteAll(false)}
            className="px-3 py-1.5 bg-zinc-700 text-white text-xs rounded-lg"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// Combine photos into display items: solo photos or burst groups
type GalleryItem =
  | { type: 'solo'; photo: InspoPhoto }
  | { type: 'burst'; burstGroupId: string; photos: InspoPhoto[] };

function buildGalleryItems(photos: InspoPhoto[]): GalleryItem[] {
  const items: GalleryItem[] = [];
  const seenBursts = new Set<string>();

  for (const photo of photos) {
    if (!photo.burst_group_id) {
      items.push({ type: 'solo', photo });
    } else if (!seenBursts.has(photo.burst_group_id)) {
      seenBursts.add(photo.burst_group_id);
      const burst = photos.filter((p) => p.burst_group_id === photo.burst_group_id);
      items.push({ type: 'burst', burstGroupId: photo.burst_group_id, photos: burst });
    }
  }

  return items;
}

export default function InspoGalleryPage() {
  const [photos, setPhotos] = useState<InspoPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJsonAuthed<InspoPhoto[]>(`${apiBase()}/api/inspo-photos?limit=100`)
      .then(setPhotos)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = useCallback((uuid: string) => {
    setPhotos((prev) => prev.filter((p) => p.uuid !== uuid));
  }, []);

  const galleryItems = buildGalleryItems(photos);

  return (
    <div className="min-h-screen bg-background pb-safe-or-4">
      {/* Header */}
      <div
        className="sticky top-0 z-10 bg-background/95 backdrop-blur-md border-b border-border flex items-center gap-3 px-4 py-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      >
        <Link href="/feed" className="text-muted-foreground">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-base font-semibold flex-1">Inspo Gallery</h1>
        <span className="text-xs text-muted-foreground">{photos.length} photos</span>
      </div>

      <div className="px-4 pt-4">
        {loading && (
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] rounded-xl bg-zinc-800 animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <p className="text-center text-sm text-muted-foreground mt-8">{error}</p>
        )}

        {!loading && !error && photos.length === 0 && (
          <div className="flex flex-col items-center justify-center mt-16 gap-3 text-muted-foreground">
            <span className="text-5xl">💪</span>
            <p className="text-sm text-center">
              No inspo photos yet.
              <br />
              Tap the 💪 button to capture one.
            </p>
          </div>
        )}

        {!loading && photos.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {galleryItems.map((item) =>
              item.type === 'solo' ? (
                <PhotoCard key={item.photo.uuid} photo={item.photo} onDelete={handleDelete} />
              ) : (
                <BurstGroupRow
                  key={item.burstGroupId}
                  photos={item.photos}
                  onDelete={handleDelete}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
