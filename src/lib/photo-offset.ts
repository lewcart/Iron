// Photo crop_offset_y is stored as a 0-100 number (CSS object-position y%
// semantics: y% of the source aligns with y% of the frame). The original
// renderer applied it via `object-position`, which silently no-ops when the
// source and frame share an aspect ratio — selfies are 3:4, frames are 3:4,
// so the saved offset never moved the image.
//
// We keep the same semantic but add a constant zoom so there's always
// overflow to shift around. Scale 1.3 gives 30% headroom (15% top + 15%
// bottom), enough for head-anchor alignment without obvious zoom artifacts.

export const PHOTO_OFFSET_SCALE = 1.3;

/** CSS `transform` value that mimics `object-position: center {y}%` but
 *  works regardless of source aspect ratio. */
export function offsetTransform(cropOffsetY: number | null | undefined): string {
  const y = cropOffsetY ?? 50;
  // translateY (% of element height) applied before scale; chosen so that
  // y%=0 puts source top at frame top, y%=100 puts source bottom at frame
  // bottom, y%=50 centers. See derivation: shift = (50-y) * (scale-1).
  const shift = (50 - y) * (PHOTO_OFFSET_SCALE - 1);
  return `translateY(${shift}%) scale(${PHOTO_OFFSET_SCALE})`;
}
