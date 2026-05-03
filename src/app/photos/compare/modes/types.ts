// Shared prop shape for the four CSS-only compare modes (Slide, SideBySide,
// Blend, Difference). Silhouette extends this; Time-lapse uses its own props.
//
// Both images render through the same offsetTransform from src/lib/photo-offset
// so head-anchored alignment stays consistent across modes.

export interface BaseCompareProps {
  beforeUrl: string;
  afterUrl: string;
  beforeOffset: number | null;
  afterOffset: number | null;
  beforeLabel: string;
  afterLabel: string;
  /** Theme accent for the after-image badge + UI affordances. */
  accent: 'trans-blue' | 'trans-pink';
}
