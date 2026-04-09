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

  const handleLongPress = useCallback(() => {
    setConfirming(true);
  }, []);

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
          handleLongPress();
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

      {/* Long-press delete confirmation */}
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
            {photos.map((photo) => (
              <PhotoCard key={photo.uuid} photo={photo} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
