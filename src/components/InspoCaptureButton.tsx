'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Dumbbell } from 'lucide-react';
import { apiBase, fetchJsonAuthed } from '@/lib/api/client';
import { onNativeBurstTrigger, savePhotoToLibrary } from '@/lib/inspo-burst-control';
import { db } from '@/db/local';
import { uuid as genUUID } from '@/lib/uuid';
import { uploadBlobToVercel } from '@/lib/photo-upload-queue';
import type { InspoPhotoPose } from '@/types';

const BURST_COUNT = 5;
const BURST_INTERVAL_MS = 1500;
const POSE_OPTIONS: InspoPhotoPose[] = ['front', 'side', 'back', 'other'];

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
  /** Burst photos still awaiting a pose tag. When non-null, the post-burst
   *  pose picker is shown. UUIDs reference both Dexie rows + server rows
   *  (server is updated lazily once Lou taps a pose). */
  const [pendingPoseBurst, setPendingPoseBurst] = useState<{
    burstGroupId: string;
    photoUuids: string[];
  } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const router = useRouter();

  const triggerFlash = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
  }, []);

  // Inspo's Blob upload is the same FormData POST as progress photos —
  // delegated to the shared helper so the offline-friendly capture pattern
  // stays in one place.
  const uploadBlob = useCallback(
    (blob: Blob, filename: string): Promise<string> =>
      uploadBlobToVercel({ table: 'inspo_photos', blob, filename }),
    [],
  );

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
        // pose: null at capture time; the post-burst picker tags all 5 frames
        // with the same pose once the burst completes.
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
            pose: null,
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

    // Surface the pose picker so the burst gets categorized for the
    // photos-compare viewer. User can dismiss to leave pose null and tag later.
    if (local.length > 0) {
      setPendingPoseBurst({
        burstGroupId,
        photoUuids: local.map(({ uuid }) => uuid),
      });
    }
  }, [capturing, triggerFlash, uploadBlob]);

  /** Tag every photo in the just-finished burst with `pose`. Updates Dexie
   *  immediately and PATCHes the server lazily; either failure is non-fatal —
   *  pose can be re-tagged from the gallery. */
  const tagBurstPose = useCallback(
    async (pose: InspoPhotoPose | null) => {
      const burst = pendingPoseBurst;
      setPendingPoseBurst(null);
      if (!burst || pose == null) return;

      // Local: update every Dexie row in the burst.
      try {
        await Promise.all(
          burst.photoUuids.map((uuid) => db.inspo_photos.update(uuid, { pose })),
        );
      } catch (err) {
        console.warn('[inspo] local pose tag failed:', err);
      }

      // Server: lazy fire-and-forget PATCHes. Each row may not exist yet on
      // the server (upload could've failed); failures here are non-fatal.
      await Promise.all(
        burst.photoUuids.map(async (uuid) => {
          try {
            await fetchJsonAuthed(`${apiBase()}/api/inspo-photos/${uuid}`, {
              method: 'PATCH',
              body: JSON.stringify({ pose }),
            });
          } catch {
            /* server may not have row; pose stays local-only until next sync */
          }
        }),
      );
    },
    [pendingPoseBurst],
  );

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

      {/* Post-burst pose picker — non-blocking; "Skip" leaves pose null. */}
      {pendingPoseBurst && (
        <div
          className="fixed inset-x-4 z-50 rounded-2xl bg-zinc-900/95 backdrop-blur-md border border-zinc-700 shadow-2xl px-4 py-3"
          style={{
            bottom: 'calc(var(--tab-bar-inner-height) + env(safe-area-inset-bottom, 0px) + 76px)',
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold tracking-wide text-zinc-200 uppercase">
              Tag pose
            </p>
            <button
              onClick={() => tagBurstPose(null)}
              className="text-[11px] text-zinc-500 px-1.5 py-0.5"
            >
              Skip
            </button>
          </div>
          <div className="flex gap-1.5">
            {POSE_OPTIONS.map((p) => (
              <button
                key={p}
                onClick={() => tagBurstPose(p)}
                className="flex-1 px-2.5 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-xs font-medium text-zinc-100 capitalize active:scale-[0.97] transition-transform"
              >
                {p}
              </button>
            ))}
          </div>
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
