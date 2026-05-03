import type { ProgressPhotoPose, InspoPhotoPose } from '@/types';

export const ALL_POSES: ProgressPhotoPose[] = [
  'front',
  'side',
  'back',
  'face_front',
  'face_side',
  'other',
];

export const POSE_LABELS: Record<ProgressPhotoPose, string> = {
  front: 'Front',
  side: 'Side',
  back: 'Back',
  face_front: 'Face Front',
  face_side: 'Face Side',
  other: 'Other',
};

// Poses that participate in the compare flow. 'other' is a catch-all that
// has no canonical mirror across progress/projection/inspo, so it never
// surfaces as a comparable pose.
export const COMPARABLE_POSES: ProgressPhotoPose[] = [
  'front',
  'side',
  'back',
  'face_front',
  'face_side',
];

export function isComparablePose(p: unknown): p is ProgressPhotoPose {
  return (
    p === 'front' ||
    p === 'side' ||
    p === 'back' ||
    p === 'face_front' ||
    p === 'face_side'
  );
}

export function isPose(p: unknown): p is ProgressPhotoPose {
  return isComparablePose(p) || p === 'other';
}

export function isInspoPose(p: unknown): p is InspoPhotoPose {
  return isPose(p);
}
