// Shared prop shape for the four CSS-only compare modes (Slide, SideBySide,
// Blend, Difference). Silhouette extends this; Time-lapse uses its own props.
//
// Both images render through the same offsetTransform(x, y) from
// src/lib/photo-offset so alignment stays consistent across modes.

export interface BaseCompareProps {
  beforeUrl: string;
  afterUrl: string;
  /** Vertical offset (0-100, null = center). */
  beforeOffsetY: number | null;
  /** Vertical offset (0-100, null = center). */
  afterOffsetY: number | null;
  /** Horizontal offset (0-100, null = center). */
  beforeOffsetX: number | null;
  /** Horizontal offset (0-100, null = center). */
  afterOffsetX: number | null;
  beforeLabel: string;
  afterLabel: string;
  /** Theme accent for the after-image badge + UI affordances. */
  accent: 'trans-blue' | 'trans-pink';
}
