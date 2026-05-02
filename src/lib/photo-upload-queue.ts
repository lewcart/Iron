'use client';

import { db } from '@/db/local';
import { apiBase } from '@/lib/api/client';
import { syncEngine } from '@/lib/sync';

// Shared offline-friendly Blob-upload helper for the photo surfaces.
//
// Pattern (mirrors the inspo-burst capture flow):
//   1. Caller writes a Dexie row with `uploaded='0'` + a `local:<uuid>` stub
//      `blob_url` and the raw JPEG Blob held in `blob`. UI renders from the
//      Blob via URL.createObjectURL.
//   2. Caller calls `queueUpload({ table, uuid, blob, ... })`. The helper
//      tries an immediate POST to the per-domain upload route; on success it
//      rewrites the Dexie row with the real Vercel URL, drops the Blob, and
//      flips `_synced=false` so the sync engine pushes the metadata.
//   3. On failure the row stays `uploaded='0'`. `processPendingUploads()`
//      retries every queued row on app focus / online events with bounded
//      backoff (handled in providers.tsx).
//
// `progress_photos` participates in the change_log sync; we deliberately
// hold `_synced=true` while `uploaded='0'` so a `local:<uuid>` stub never
// reaches the server. Once the upload succeeds we set `_synced=false` to
// queue the row for the next push.
//
// `inspo_photos` is local-only on the client and pushed via a direct REST
// call (`POST /api/inspo-photos`), not the sync engine — see InspoCaptureButton.
// We expose `uploadInspoBlob` here so the inspo path can share retry logic
// without duplicating the FormData+fetch boilerplate.

const UPLOAD_ROUTES = {
  progress_photos: '/api/progress-photos/upload',
  inspo_photos: '/api/inspo-photos/upload',
  projection_photos: '/api/projection-photos/upload',
} as const;

export type PhotoTable = keyof typeof UPLOAD_ROUTES;

/** `local:<uuid>` stub used while the JPEG is still queued for upload. */
export function localStubUrl(uuid: string): string {
  return `local:${uuid}`;
}

export function isLocalStub(url: string | null | undefined): boolean {
  return !!url && url.startsWith('local:');
}

function apiKeyHeader(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_REBIRTH_API_KEY;
  return key ? { 'X-Api-Key': key } : {};
}

/** POST a Blob to the per-domain upload route and return the Vercel Blob URL.
 *  Throws on non-2xx so the caller can mark the row as still-queued. */
export async function uploadBlobToVercel(opts: {
  table: PhotoTable;
  blob: Blob;
  filename: string;
  /** progress_photos accepts an optional `pose` formData field for filename. */
  pose?: string;
}): Promise<string> {
  const formData = new FormData();
  formData.append('file', opts.blob, opts.filename);
  if (opts.pose) formData.append('pose', opts.pose);

  const res = await fetch(`${apiBase()}${UPLOAD_ROUTES[opts.table]}`, {
    method: 'POST',
    headers: apiKeyHeader(),
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`Upload ${res.status} ${res.statusText || ''}`.trim());
  }
  const { url } = (await res.json()) as { url: string };
  return url;
}

/** Try to upload a queued progress-photo row's Blob and, on success, rewrite
 *  the row with the real URL + flip `_synced=false`. Returns true if the
 *  upload completed (or the row no longer exists / already has a real URL). */
export async function uploadProgressPhotoRow(uuid: string): Promise<boolean> {
  const row = await db.progress_photos.get(uuid);
  if (!row || row._deleted) return true;
  if (row.uploaded === '1' && !isLocalStub(row.blob_url)) return true;
  if (!row.blob) {
    // Stuck row — no Blob to upload. Mark uploaded='1' to stop the sweeper
    // from spinning on it forever. Without a Blob there's nothing to retry.
    await db.progress_photos.update(uuid, { uploaded: '1' });
    return true;
  }

  try {
    const url = await uploadBlobToVercel({
      table: 'progress_photos',
      blob: row.blob,
      filename: `progress-${row.pose}-${uuid}.jpg`,
      pose: row.pose,
    });
    await db.progress_photos.update(uuid, {
      blob_url: url,
      blob: null,
      uploaded: '1',
      _synced: false,
      _updated_at: Date.now(),
    });
    syncEngine.schedulePush();
    return true;
  } catch (err) {
    console.warn('[photo-upload] progress_photos retry failed:', uuid, err);
    return false;
  }
}

let _sweeping = false;

/** Retry every queued progress-photo upload. Idempotent + concurrency-safe.
 *  Called on app focus, online, and after capture. Bounded backoff is provided
 *  by the caller (we just attempt every queued row once per invocation). */
export async function processPendingUploads(): Promise<void> {
  if (_sweeping) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  _sweeping = true;
  try {
    const queued = await db.progress_photos
      .where('uploaded').equals('0')
      .toArray();
    // Sequential — keeps the upload route from getting hammered by a backlog.
    for (const row of queued) {
      if (row._deleted) continue;
      await uploadProgressPhotoRow(row.uuid);
    }
  } finally {
    _sweeping = false;
  }
}
