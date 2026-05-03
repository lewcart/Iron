// Photo crop offsets are stored as 0-100 numbers (CSS object-position
// semantics: x%/y% of the source aligns with x%/y% of the frame). The
// original renderer applied them via `object-position`, which silently
// no-ops when the source and frame share an aspect ratio — selfies are
// 3:4, frames are 3:4, so the saved offset never moved the image.
//
// We keep the same semantic but add a constant zoom so there's always
// overflow to shift around. Scale 1.3 gives 30% headroom (15% top/bottom
// + 15% left/right), enough for head-anchor + body-center alignment
// without obvious zoom artifacts.

export const PHOTO_OFFSET_SCALE = 1.3;

/** CSS `transform` value that mimics `object-position: {x}% {y}%` but
 *  works regardless of source aspect ratio.
 *
 *  Both axes default to 50 (center) when the offset is null/undefined.
 *  derivation: shiftX = (50-x) * (scale-1); shiftY = (50-y) * (scale-1). */
export function offsetTransform(
  cropOffsetX: number | null | undefined,
  cropOffsetY: number | null | undefined,
): string {
  const x = cropOffsetX ?? 50;
  const y = cropOffsetY ?? 50;
  const shiftX = (50 - x) * (PHOTO_OFFSET_SCALE - 1);
  const shiftY = (50 - y) * (PHOTO_OFFSET_SCALE - 1);
  return `translate(${shiftX}%, ${shiftY}%) scale(${PHOTO_OFFSET_SCALE})`;
}
