'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Sparkles, Upload } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { uploadBlobToVercel, isLocalStub } from '@/lib/photo-upload-queue';
import { apiBase, fetchJsonAuthed } from '@/lib/api/client';
import { useProgressPhotos } from '@/lib/useLocalDB-measurements';
import type { ProgressPhotoPose, ProjectionPhoto } from '@/types';

const HORIZON_OPTIONS = ['3mo', '6mo', '12mo'] as const;
type Horizon = (typeof HORIZON_OPTIONS)[number] | null;

interface Props {
  open: boolean;
  onClose: () => void;
  onUploaded: (photo: ProjectionPhoto) => void;
}

export function ProjectionUploadSheet({ open, onClose, onUploaded }: Props) {
  const [pose, setPose] = useState<ProgressPhotoPose>('front');
  const [horizon, setHorizon] = useState<Horizon>('6mo');
  const [notes, setNotes] = useState('');
  const [sourceUuid, setSourceUuid] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Source-photo picker shows recent progress photos at the chosen pose so Lou
  // can link the projection to the source it was generated from. Filter out
  // local: stubs — those aren't on Vercel Blob yet, so the comparison viewer
  // can't render them on a different device.
  const allProgress = useProgressPhotos(30) ?? [];
  const sourceCandidates = allProgress
    .filter((p) => p.pose === pose && !isLocalStub(p.blob_url))
    .slice(0, 6);

  useEffect(() => {
    if (open) {
      setPose('front');
      setHorizon('6mo');
      setNotes('');
      setSourceUuid(null);
      setError(null);
    }
  }, [open]);

  // If the chosen source no longer matches the current pose (Lou switched
  // poses after picking), clear the selection so we don't link a mismatched pair.
  useEffect(() => {
    if (sourceUuid && !sourceCandidates.some((p) => p.uuid === sourceUuid)) {
      setSourceUuid(null);
    }
  }, [pose, sourceUuid, sourceCandidates]);

  const handleFile = async (file: File) => {
    setSaving(true);
    setError(null);
    try {
      const filename = `projection-${pose}-${Date.now()}.${
        file.name.split('.').pop() ?? 'jpg'
      }`;
      const url = await uploadBlobToVercel({
        table: 'projection_photos',
        blob: file,
        filename,
        pose,
      });
      const photo = await fetchJsonAuthed<ProjectionPhoto>(
        `${apiBase()}/api/projection-photos`,
        {
          method: 'POST',
          body: JSON.stringify({
            blob_url: url,
            pose,
            notes: notes.trim() || null,
            taken_at: new Date().toISOString(),
            source_progress_photo_uuid: sourceUuid,
            target_horizon: horizon,
          }),
        },
      );
      onUploaded(photo);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add Projection" height="auto">
      <div className="p-4 space-y-3">
        <div className="ios-section">
          {/* Pose selector */}
          <div className="ios-row gap-2">
            {(['front', 'side', 'back'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPose(p)}
                className={`flex-1 py-2 text-sm font-medium rounded-lg border capitalize transition-colors ${
                  pose === p
                    ? 'bg-primary text-white border-primary'
                    : 'border-border text-muted-foreground'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Source photo picker (optional) */}
          <div className="ios-row flex-col items-stretch py-2">
            <p className="text-xs text-muted-foreground mb-2">
              Generated from (optional)
            </p>
            {sourceCandidates.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                No {pose} progress photos uploaded yet to link to.
              </p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {sourceCandidates.map((photo) => {
                  const selected = sourceUuid === photo.uuid;
                  return (
                    <button
                      key={photo.uuid}
                      onClick={() =>
                        setSourceUuid(selected ? null : photo.uuid)
                      }
                      className={`relative flex-none w-16 aspect-[3/4] rounded-lg overflow-hidden border-2 transition-colors ${
                        selected ? 'border-trans-blue' : 'border-transparent'
                      }`}
                    >
                      <Image
                        src={photo.blob_url}
                        alt={`${pose} ${photo.taken_at}`}
                        fill
                        sizes="64px"
                        className="object-cover"
                        unoptimized
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Horizon */}
          <div className="ios-row flex-col items-stretch py-2">
            <p className="text-xs text-muted-foreground mb-2">Target horizon</p>
            <div className="flex gap-2">
              {HORIZON_OPTIONS.map((h) => (
                <button
                  key={h}
                  onClick={() => setHorizon(horizon === h ? null : h)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                    horizon === h
                      ? 'bg-trans-blue/10 text-trans-blue border-trans-blue'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="ios-row">
            <input
              type="text"
              placeholder="Note (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none min-h-[44px] text-muted-foreground"
            />
          </div>

          {error && (
            <div className="ios-row">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          <div className="ios-row justify-end">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-trans-blue text-white text-sm font-medium rounded-lg disabled:opacity-40"
            >
              {saving ? (
                <>
                  <Sparkles className="h-4 w-4 animate-pulse" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Choose Image
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
