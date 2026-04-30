'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Dumbbell } from 'lucide-react';
import { apiBase, fetchJsonAuthed } from '@/lib/api/client';
import { onNativeBurstTrigger, savePhotoToLibrary } from '@/lib/inspo-burst-control';
import { db } from '@/db/local';
import { uuid as genUUID } from '@/lib/uuid';

const BURST_COUNT = 5;
const BURST_INTERVAL_MS = 1500;

async function openBackCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  });
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export function InspoCaptureButton() {
  const [capturing, setCapturing] = useState(false);
  const [burstProgress, setBurstProgress] = useState<number>(0); // 0 = idle, 1-5 = shot number
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const router = useRouter();

  const triggerFlash = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
  }, []);

  const uploadBlob = useCallback(async (blob: Blob, filename: string): Promise<string> => {
    const formData = new FormData();
    formData.append('file', blob, filename);

    const apiKey = process.env.NEXT_PUBLIC_REBIRTH_API_KEY;
    const authHeaders: HeadersInit = apiKey ? { 'X-Api-Key': apiKey } : {};

    const uploadRes = await fetch(`${apiBase()}/api/inspo-photos/upload`, {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    });
    if (!uploadRes.ok) {
      throw new Error(`Upload ${uploadRes.status} ${uploadRes.statusText || ''}`.trim());
    }
    const { url } = await uploadRes.json();
    return url as string;
  }, []);

  const triggerCapture = useCallback(async () => {
    if (capturing) return;
    setCapturing(true);
    setBurstProgress(0);
    setError(null);

    const burstGroupId = crypto.randomUUID();
    const stream = await openBackCamera().catch((err) => {
      setError(err instanceof Error ? err.message : 'Camera unavailable');
      setCapturing(false);
      return null;
    });
    if (!stream) return;

    // Prepare shared video element — keep stream open for all frames
    const video = document.createElement('video');
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    await video.play();
    // Settle time for camera auto-exposure (only needed once)
    await sleep(400);

    const local: { uuid: string; blob: Blob; takenAt: string }[] = [];

    try {
      for (let i = 0; i < BURST_COUNT; i++) {
        setBurstProgress(i + 1);

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))),
            'image/jpeg',
            0.85,
          ),
        );

        const takenAt = new Date().toISOString();
        const uuid = genUUID();
        // Persist to IndexedDB immediately — if upload later fails, the photo
        // is still preserved locally and can be retried from the gallery.
        try {
          await db.inspo_photos.put({
            uuid,
            burst_group_id: burstGroupId,
            taken_at: takenAt,
            blob,
            blob_url: null,
            uploaded: '0',
            created_at: takenAt,
            notes: null,
          });
        } catch (err) {
          console.warn('[inspo] local save failed:', err);
        }
        // Also save to the iOS Photos library so the shot is accessible
        // outside the app. Fire-and-forget — Photos-save shouldn't block
        // the burst cadence.
        savePhotoToLibrary(blob).catch((err) => console.warn('[inspo] Photos save failed:', err));
        local.push({ uuid, blob, takenAt });
        triggerFlash();

        if (i < BURST_COUNT - 1) {
          await sleep(BURST_INTERVAL_MS);
        }
      }
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }

    // Best-effort upload. Each local row flips to uploaded='1' on success;
    // failures stay as '0' and remain visible in the local gallery.
    const failures: string[] = [];
    await Promise.all(
      local.map(async ({ uuid, blob, takenAt }, i) => {
        try {
          const filename = `inspo-burst-${burstGroupId}-${i + 1}.jpg`;
          const url = await uploadBlob(blob, filename);
          await fetchJsonAuthed(`${apiBase()}/api/inspo-photos`, {
            method: 'POST',
            body: JSON.stringify({
              blob_url: url,
              taken_at: takenAt,
              burst_group_id: burstGroupId,
            }),
          });
          try {
            await db.inspo_photos.update(uuid, { uploaded: '1', blob_url: url });
          } catch { /* non-fatal */ }
        } catch (err) {
          failures.push(err instanceof Error ? err.message : 'upload error');
        }
      }),
    );
    if (failures.length > 0) {
      const first = failures[0];
      setError(failures.length === BURST_COUNT
        ? `All uploads failed (${first}). Saved locally.`
        : `${failures.length}/${BURST_COUNT} uploads failed (${first}). Saved locally.`);
      setTimeout(() => setError(null), 3500);
    }

    setBurstProgress(0);
    setCapturing(false);
  }, [capturing, triggerFlash, uploadBlob]);

  // Subscribe to the iOS 18 Lock Screen control trigger.
  useEffect(() => {
    console.info('[InspoCaptureButton] subscribing to burstTrigger');
    return onNativeBurstTrigger(() => {
      console.info('[InspoCaptureButton] burstTrigger received — firing capture');
      triggerCapture();
    });
  }, [triggerCapture]);

  const handlePointerDown = useCallback(() => {
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      router.push('/inspo');
    }, 600);
  }, [router]);

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleClick = useCallback(() => {
    if (!didLongPress.current) {
      triggerCapture();
    }
  }, [triggerCapture]);

  return (
    <>
      {/* White flash on each capture */}
      {flash && (
        <div
          className="fixed inset-0 bg-white pointer-events-none"
          style={{ zIndex: 9999, animation: 'inspo-flash 0.25s ease-out forwards' }}
        />
      )}

      {/* Burst progress indicator */}
      {capturing && burstProgress > 0 && (
        <div
          className="fixed left-1/2 -translate-x-1/2 flex items-center gap-1 pointer-events-none"
          style={{
            zIndex: 9998,
            bottom: 'calc(var(--tab-bar-inner-height) + env(safe-area-inset-bottom, 0px) + 72px)',
          }}
        >
          {Array.from({ length: BURST_COUNT }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 w-1.5 rounded-full transition-colors duration-150 ${
                i < burstProgress ? 'bg-white' : 'bg-white/30'
              }`}
            />
          ))}
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div
          className="fixed left-1/2 -translate-x-1/2 bg-red-900/90 text-red-200 text-xs px-3 py-1.5 rounded-full pointer-events-none"
          style={{
            zIndex: 9998,
            bottom: 'calc(var(--tab-bar-inner-height) + env(safe-area-inset-bottom, 0px) + 68px)',
          }}
        >
          {error}
        </div>
      )}

      <button
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
        disabled={capturing}
        aria-label="Capture inspo photo burst (hold for gallery)"
        className="fixed right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800/90 border border-zinc-700 shadow-lg text-xl active:scale-90 transition-transform duration-100 disabled:opacity-40 select-none touch-none"
        style={{
          bottom:
            'calc(var(--tab-bar-inner-height) + env(safe-area-inset-bottom, 0px) + 12px)',
        }}
      >
        {capturing ? (
          <span className="h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
        ) : (
          <Dumbbell className="h-5 w-5 text-white" strokeWidth={2} />
        )}
      </button>
    </>
  );
}
