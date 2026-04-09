'use client';

import { useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiBase, fetchJsonAuthed } from '@/lib/api/client';

async function captureFromBackCamera(): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  });

  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    await video.play();
    // Brief settle time for camera to auto-expose
    await new Promise<void>((r) => setTimeout(r, 400));

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob failed'))),
        'image/jpeg',
        0.85,
      ),
    );
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export function InspoCaptureButton() {
  const [capturing, setCapturing] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const router = useRouter();

  const triggerCapture = useCallback(async () => {
    if (capturing) return;
    setCapturing(true);
    setError(null);
    try {
      const blob = await captureFromBackCamera();

      const formData = new FormData();
      formData.append('file', blob, `inspo-${Date.now()}.jpg`);

      const apiKey = process.env.NEXT_PUBLIC_REBIRTH_API_KEY;
      const authHeaders: HeadersInit = apiKey ? { 'X-Api-Key': apiKey } : {};

      const uploadRes = await fetch(`${apiBase()}/api/inspo-photos/upload`, {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });
      if (!uploadRes.ok) throw new Error('Upload failed');
      const { url } = await uploadRes.json();

      await fetchJsonAuthed(`${apiBase()}/api/inspo-photos`, {
        method: 'POST',
        body: JSON.stringify({ blob_url: url, taken_at: new Date().toISOString() }),
      });

      setFlash(true);
      setTimeout(() => setFlash(false), 400);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Capture failed';
      // Show brief error indicator
      setError(msg);
      setTimeout(() => setError(null), 2500);
    } finally {
      setCapturing(false);
    }
  }, [capturing]);

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
      {/* White flash on capture */}
      {flash && (
        <div
          className="fixed inset-0 bg-white pointer-events-none"
          style={{ zIndex: 9999, animation: 'inspo-flash 0.4s ease-out forwards' }}
        />
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
        aria-label="Capture inspo photo (hold for gallery)"
        className="fixed right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800/90 border border-zinc-700 shadow-lg text-xl active:scale-90 transition-transform duration-100 disabled:opacity-40 select-none touch-none"
        style={{
          bottom:
            'calc(var(--tab-bar-inner-height) + env(safe-area-inset-bottom, 0px) + 12px)',
        }}
      >
        {capturing ? (
          <span className="h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
        ) : (
          '💪'
        )}
      </button>
    </>
  );
}
