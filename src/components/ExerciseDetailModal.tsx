'use client';

import { memo, useEffect } from 'react';
import type { Exercise } from '@/types';
import ExerciseDetail from '@/app/exercises/ExerciseDetail';

/**
 * Modal wrapper around <ExerciseDetail/> for the in-workout [i] flow.
 *
 * Renders as a `fixed inset-0` sibling overlay so the underlying workout page
 * stays mounted (rest timer keeps ticking, scroll position preserved, expanded
 * exercise rows survive). The modal renders <ExerciseDetail/> in its native
 * page layout — same content and edit affordances as the /exercises route.
 * <ExerciseDetail/>'s own back-button bar acts as the close affordance via
 * `onBack={onClose}`.
 *
 * Memoized: the workout page re-renders every 500ms while the rest timer is
 * active. With stable props (exerciseUuid is a string, onClose is wrapped by
 * useCallback at the call site), the modal subtree (including Recharts) only
 * re-renders when the user opens, closes, or paginates — not on timer ticks.
 */
function ExerciseDetailModalImpl({
  exercise,
  onClose,
}: {
  exercise: Exercise | null;
  onClose: () => void;
}) {
  // Body scroll lock + ESC-to-close while open. Deliberately scoped to the
  // open state rather than mount; the modal is conditionally rendered by the
  // parent so unmount handles cleanup.
  useEffect(() => {
    if (!exercise) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKey);
    };
  }, [exercise, onClose]);

  if (!exercise) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-background"
      role="dialog"
      aria-modal="true"
      aria-label={`${exercise.title} details`}
    >
      <ExerciseDetail exercise={exercise} onBack={onClose} />
    </div>
  );
}

export const ExerciseDetailModal = memo(ExerciseDetailModalImpl);
