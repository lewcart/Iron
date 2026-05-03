// Best-effort face detection for photo alignment.
//
// Returns a CSS object-position y% (0-100) that anchors the detected face at
// the canonical comparison y (~25% from the top). NULL = couldn't detect a
// face (e.g. back-pose photo, all detection paths failed) — caller should
// leave crop_offset_y null and let the renderer fall back to 50 (center).
//
// Two-tier strategy:
//   1. window.FaceDetector (Shape Detection API) — Chromium-on-Android only,
//      native, ~zero overhead. Tried first.
//   2. @tensorflow-models/face-detection with MediaPipe full-range model —
//      lazy-loaded via dynamic import, runs on iOS Safari (incl. Capacitor),
//      web Safari, and any browser without the Shape Detection API. Bundle:
//      ~630KB JS + 250KB model on first call, cached forever.
//
// The "full" MediaPipe model variant is specifically designed for full-body
// shots where faces are small in frame (down to ~5% of width) — exactly the
// progress-photo case. The "short" / BlazeFace variant only handles
// selfie-distance faces and would miss most progress shots.
//
// Convention: the "anchor y" is where the face center should sit in the
// rendered comparison frame. With anchor=25%, faces all land at ~1/4 from
// the top regardless of source framing.

const ANCHOR_Y_PCT = 25;

interface DetectedFace {
  boundingBox: { x: number; y: number; width: number; height: number };
}

interface FaceDetectorCtor {
  new (): { detect(image: ImageBitmapSource): Promise<DetectedFace[]> };
}

// TFJS detector + import are cached at module scope so the lazy import + model
// load only happens once per session.
type TfjsDetector = {
  estimateFaces(input: ImageBitmap): Promise<Array<{ box: { xMin: number; yMin: number; width: number; height: number } }>>;
};
let tfjsDetectorPromise: Promise<TfjsDetector | null> | null = null;

async function loadTfjsDetector(): Promise<TfjsDetector | null> {
  if (tfjsDetectorPromise) return tfjsDetectorPromise;
  tfjsDetectorPromise = (async () => {
    try {
      // Dynamic imports keep TFJS out of the main bundle. The first user-
      // initiated upload pays the load cost; the browser caches the chunks.
      const [faceDetection] = await Promise.all([
        import('@tensorflow-models/face-detection'),
        import('@tensorflow/tfjs-core'),
        import('@tensorflow/tfjs-converter'),
        import('@tensorflow/tfjs-backend-webgl'),
      ]);
      const detector = await faceDetection.createDetector(
        faceDetection.SupportedModels.MediaPipeFaceDetector,
        {
          runtime: 'tfjs',
          // 'full' is the long-range model — handles small faces in full-body
          // shots. 'short' is BlazeFace-equivalent and would miss most.
          modelType: 'full',
        },
      );
      return detector as unknown as TfjsDetector;
    } catch (err) {
      // Don't cache the rejection so a transient failure can be retried on
      // a later upload; reset the promise.
      tfjsDetectorPromise = null;
      console.warn('[face-detect] tfjs detector load failed:', err);
      return null;
    }
  })();
  return tfjsDetectorPromise;
}

/** Best-effort face detection. Returns CSS object-position y% (0-100), or null
 *  when no face is detected by any path. Kept as a thin wrapper for callers
 *  that only need vertical alignment. */
export async function tryDetectFaceY(blob: Blob): Promise<number | null> {
  const center = await tryDetectFaceCenter(blob);
  return center?.y ?? null;
}

/** Best-effort face detection returning both axes as CSS object-position
 *  percentages (0-100). NULL when no face is detected by any path. Used by
 *  AdjustOffsetDialog when no silhouette mask is available for body-centroid
 *  detection. */
export async function tryDetectFaceCenter(blob: Blob): Promise<{ x: number; y: number } | null> {
  const native = await tryNativeFaceDetectorCenter(blob);
  if (native !== null) return native;
  return tryTfjsFaceDetectorCenter(blob);
}

async function tryNativeFaceDetectorCenter(blob: Blob): Promise<{ x: number; y: number } | null> {
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
    const face = faces.reduce((a, b) =>
      a.boundingBox.height > b.boundingBox.height ? a : b,
    );
    const faceCenterY = face.boundingBox.y + face.boundingBox.height / 2;
    const faceCenterX = face.boundingBox.x + face.boundingBox.width / 2;
    return {
      x: pctFromCenter(faceCenterX, bitmap.width),
      y: faceCenterToObjectPositionY(faceCenterY, bitmap.height),
    };
  } catch {
    return null;
  } finally {
    bitmap?.close?.();
  }
}

async function tryTfjsFaceDetectorCenter(blob: Blob): Promise<{ x: number; y: number } | null> {
  if (typeof window === 'undefined') return null;
  const detector = await loadTfjsDetector();
  if (!detector) return null;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    const faces = await detector.estimateFaces(bitmap);
    if (!faces || faces.length === 0) return null;
    const face = faces.reduce((a, b) => (a.box.height > b.box.height ? a : b));
    const faceCenterY = face.box.yMin + face.box.height / 2;
    const faceCenterX = face.box.xMin + face.box.width / 2;
    return {
      x: pctFromCenter(faceCenterX, bitmap.width),
      y: faceCenterToObjectPositionY(faceCenterY, bitmap.height),
    };
  } catch (err) {
    console.warn('[face-detect] tfjs estimateFaces failed:', err);
    return null;
  } finally {
    bitmap?.close?.();
  }
}

/** For x: face-center pixel → CSS object-position x%. Unlike y, there's no
 *  "anchor" concept — we just want the face horizontally centered, so map the
 *  face's pixel x straight to a percentage. */
function pctFromCenter(pixel: number, dim: number): number {
  return Math.round(clamp((pixel / dim) * 100, 0, 100) * 10) / 10;
}

/** Convert a detected face center (in image pixels) to a CSS object-position
 *  y% that puts that face at ANCHOR_Y_PCT in the rendered frame.
 *
 *  For a near-1:1 frame and portrait source we approximate:
 *    object-position y% ≈ facePct - ANCHOR_Y_PCT + 50
 *  Exact formula varies with aspect ratio; manual nudge is the safety net. */
function faceCenterToObjectPositionY(faceCenterY: number, imageHeight: number): number {
  const facePct = (faceCenterY / imageHeight) * 100;
  const objectPositionY = clamp(facePct - ANCHOR_Y_PCT + 50, 0, 100);
  return Math.round(objectPositionY * 10) / 10;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
