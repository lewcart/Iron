// Best-effort face detection for photo alignment.
//
// Returns a CSS object-position y% (0-100) that anchors the detected face at
// the canonical comparison y (~25% from the top). NULL = couldn't detect a
// face (unsupported browser, back-pose photo, etc.) — caller should leave
// crop_offset_y null and let the renderer fall back to 50 (center).
//
// Uses window.FaceDetector (Shape Detection API) where available — that's
// Chromium-based browsers behind a flag in some channels, on by default in
// others. On Safari (incl. iOS via Capacitor) the API doesn't exist yet, so
// this returns null and manual drag-to-nudge is the only path. We never
// download an ML model; cost stays $0.
//
// Convention: the "anchor y" is where the face center should sit in the
// rendered comparison frame. With anchor=25%, faces all land at ~1/4 from
// the top regardless of source framing.

const ANCHOR_Y_PCT = 25;

interface DetectedFace {
  boundingBox: { y: number; height: number };
}

interface FaceDetectorCtor {
  new (): { detect(image: ImageBitmapSource): Promise<DetectedFace[]> };
}

/** Best-effort face detection. Returns CSS object-position y% (0-100), or null
 *  when no face is detected or the browser doesn't ship FaceDetector. */
export async function tryDetectFaceY(blob: Blob): Promise<number | null> {
  // Feature-detect at runtime — typed loosely so we never fail compilation
  // on browsers that don't ship the API.
  const Ctor =
    typeof window !== 'undefined'
      ? ((window as unknown as { FaceDetector?: FaceDetectorCtor }).FaceDetector ?? null)
      : null;
  if (!Ctor) return null;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    const detector = new Ctor();
    const faces = await detector.detect(bitmap);
    if (!faces || faces.length === 0) return null;

    // Pick the largest face (most likely the subject).
    const face = faces.reduce((a, b) =>
      a.boundingBox.height > b.boundingBox.height ? a : b,
    );

    // Face center as a fraction of image height.
    const faceCenterY = face.boundingBox.y + face.boundingBox.height / 2;
    const facePct = (faceCenterY / bitmap.height) * 100;

    // We want the face to land at ANCHOR_Y_PCT in the rendered frame.
    // CSS object-position y% controls which part of the source image is
    // visible at the top of the frame (when the source is taller than the
    // frame). Solving: rendered_face_y_pct = facePct + (50 - obj_pos_y%) * k
    // where k depends on aspect ratios. For a near-1:1 frame and portrait
    // source we approximate: object-position y% ≈ facePct - ANCHOR_Y_PCT + 50
    // (simple offset that reads well in practice — exact formula varies with
    // aspect ratio, manual nudge is the safety net.)
    const objectPositionY = clamp(facePct - ANCHOR_Y_PCT + 50, 0, 100);
    return Math.round(objectPositionY * 10) / 10; // 1 decimal
  } catch {
    return null;
  } finally {
    bitmap?.close?.();
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
