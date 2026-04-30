'use client';

import { memo, useEffect } from 'react';
import { X } from 'lucide-react';
import type { Exercise } from '@/types';
import ExerciseDetail from '@/app/exercises/ExerciseDetail';

/**
 * Modal wrapper around <ExerciseDetail/> for the in-workout [i] flow.
 *
 * Renders as a `fixed inset-0` sibling overlay so the underlying workout page
 * stays mounted (rest timer keeps ticking, scroll position preserved, expanded
 * exercise rows survive). Modal supplies its own chrome — title bar + close
 * button — and tells <ExerciseDetail/> to skip its page-mode nav bar.
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
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label={`${exercise.title} details`}
    >
      {/* Modal chrome — title bar with close button */}
      <div className="flex items-center gap-2 px-4 pt-safe pb-3 border-b border-border bg-background">
        <button
          onClick={onClose}
          className="p-1 -ml-1 text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
        <h2 className="flex-1 text-base font-semibold truncate">{exercise.title}</h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ExerciseDetail exercise={exercise} onBack={onClose} chrome="modal" />
      </div>
    </div>
  );
}

export const ExerciseDetailModal = memo(ExerciseDetailModalImpl);
