/**
 * silhouette — orchestrates lazy person-segmentation mask creation + caching
 * for the /photos/compare Silhouette mode.
 *
 * Flow per photo:
 *   1. If `mask_url` is already set → return it (cache hit, skip everything).
 *   2. Fetch the source JPEG as a Blob → base64.
 *   3. Call PersonSegmentation.segment() — runs Vision on-device on iOS.
 *   4. POST the mask PNG (multipart/form-data) to /api/{kind}-photos/{uuid}/mask.
 *   5. Server uploads to Vercel Blob, sets mask_url, returns the URL.
 *   6. Return the URL; caller caches in component state.
 *
 * Concurrency safety:
 *   - In-flight Map keyed by uuid dedupes simultaneous requests for the same
 *     photo. Two render passes that both call ensureMasks(photoA) share one
 *     Vision request, one upload, one DB write.
 *
 * Mask alignment invariant:
 *   - The mask is generated at the source image's pixel dimensions.
 *   - Both source <img> AND mask <img> in SilhouetteMode render with the
 *     SAME `offsetTransform(crop_offset_y)` + `object-fit: cover` on the
 *     SAME aspect-ratio frame. They co-align IFF those CSS values match.
 *   - Lou can edit `crop_offset_y` post-cache. The mask BYTES don't move
 *     (they're in source pixel coords), only the CSS transform changes,
 *     and both layers receive the new transform together. No invalidation
 *     needed — the cached mask remains valid forever.
 */

import { isPersonSegmentationAvailable, segmentPerson } from './native/person-segmentation';

export type PhotoKind = 'progress' | 'projection' | 'inspo';

export interface MaskablePhoto {
  uuid: string;
  blob_url: string;
  mask_url?: string | null;
}

export interface EnsureMasksResult {
  /** Vercel Blob URL of the mask PNG. */
  maskUrl: string;
  /** True when mask was newly computed (not loaded from cache). */
  computed: boolean;
}

const ROUTES: Record<PhotoKind, string> = {
  progress: '/api/progress-photos',
  projection: '/api/projection-photos',
  inspo: '/api/inspo-photos',
};

/** Per-uuid dedupe — prevents two callers from generating the same mask
 *  twice in parallel. Cleared once the request settles. */
const inflight = new Map<string, Promise<EnsureMasksResult>>();

/** Read a remote JPEG into base64 (no data: prefix). */
async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const blob = await res.blob();
  const buf = await blob.arrayBuffer();
  return arrayBufferToBase64(buf);
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, mime = 'image/png'): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Core: ensure the mask exists on the server for a given photo. */
export async function ensureMask(
  photo: MaskablePhoto,
  kind: PhotoKind,
  signal?: AbortSignal,
): Promise<EnsureMasksResult> {
  if (photo.mask_url) {
    return { maskUrl: photo.mask_url, computed: false };
  }

  // Dedupe — second caller waits on the first.
  const existing = inflight.get(photo.uuid);
  if (existing) return existing;

  const promise = (async () => {
    if (!isPersonSegmentationAvailable()) {
      throw new Error('Silhouette compare requires the iOS app');
    }

    const imageBase64 = await fetchAsBase64(photo.blob_url);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const { maskPngBase64 } = await segmentPerson({ imageBase64 });
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const maskBlob = base64ToBlob(maskPngBase64, 'image/png');
    const formData = new FormData();
    formData.append('file', maskBlob, `${photo.uuid}-mask.png`);

    const headers: HeadersInit = {};
    if (process.env.NEXT_PUBLIC_REBIRTH_API_KEY) {
      headers['X-Api-Key'] = process.env.NEXT_PUBLIC_REBIRTH_API_KEY;
    }

    const res = await fetch(`${ROUTES[kind]}/${photo.uuid}/mask`, {
      method: 'POST',
      body: formData,
      headers,
      signal,
    });
    if (!res.ok) throw new Error(`mask upload HTTP ${res.status}`);
    const { mask_url } = (await res.json()) as { mask_url: string };
    return { maskUrl: mask_url, computed: true };
  })();

  inflight.set(photo.uuid, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(photo.uuid);
  }
}
