/**
 * person-segmentation — iOS Vision bridge for the Silhouette compare mode.
 *
 * The native PersonSegmentationPlugin runs `VNGeneratePersonSegmentationRequest`
 * on a JPEG and returns a single-channel PNG mask (white = person,
 * black = background) sized to the source image.
 *
 * Used by `src/lib/silhouette.ts` to compute + cache masks lazily, then
 * by `src/app/photos/compare/modes/SilhouetteMode.tsx` to render the
 * outline overlay.
 *
 * Web fallback: the plugin is iOS-only. `isPersonSegmentationAvailable()`
 * returns false on web, in which case SilhouetteMode shows an explanatory
 * empty state instead of attempting a call that would always reject.
 */

import { registerPlugin, Capacitor } from '@capacitor/core';

export interface SegmentOptions {
  /** Source image as base64 (JPEG/PNG/HEIC supported by UIImage). */
  imageBase64: string;
}

export interface SegmentResult {
  /** Person mask as base64 PNG, single-channel 8-bit, sized to source image. */
  maskPngBase64: string;
  /** How long the Vision request took on-device (ms). */
  durationMs: number;
}

interface PersonSegmentationPluginShape {
  segment: (opts: SegmentOptions) => Promise<SegmentResult>;
}

const PersonSegmentation = registerPlugin<PersonSegmentationPluginShape>('PersonSegmentation');

/** True only when running inside the iOS Capacitor shell. The plugin's
 *  registerPlugin shim still exists in the browser but every call would
 *  reject with `not implemented on web`. */
export function isPersonSegmentationAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

/** Run person segmentation on a source image. Caller is responsible for
 *  passing a reasonable-sized JPEG (segmentation cost scales with pixel
 *  count). Throws on plugin error or unsupported platform. */
export async function segmentPerson(opts: SegmentOptions): Promise<SegmentResult> {
  if (!isPersonSegmentationAvailable()) {
    throw new Error('Person segmentation requires the iOS app');
  }
  return PersonSegmentation.segment(opts);
}
