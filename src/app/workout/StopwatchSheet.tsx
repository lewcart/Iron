'use client';

import { useState } from 'react';
import { formatTime } from './workout-utils';
import {
  finalDurationSeconds,
  type UseStopwatchApi,
} from './useStopwatch';

/** Format mm:ss for ≤59:59, h:mm:ss for ≥60:00. Cap-warn happens at the
 *  banner level; this just formats whatever's passed in. */
function formatStopwatch(seconds: number): string {
  if (seconds < 3600) return formatTime(seconds);
  const h = Math.floor(seconds / 3600);
  const remainder = seconds % 3600;
  return `${h}:${formatTime(remainder)}`;
}

export interface StopwatchSheetProps {
  api: UseStopwatchApi;
  /** Called once per stop sequence with the final duration_seconds for the
   *  current set. Consumer is responsible for writing to Dexie + closing
   *  the sheet on completion. */
  onCommit: (durationSeconds: number) => void | Promise<void>;
  /** User taps Close — preserves running state in background. */
  onClose: () => void;
  /** When true, the user is opening the sheet on an already-completed
   *  set (existing duration > 0). The replacement note + undo affordance
   *  surface in this mode. */
  replacingSeconds?: number | null;
  /** Exercise title for the header. */
  exerciseName?: string;
}

export function StopwatchSheet({
  api,
  onCommit,
  onClose,
  replacingSeconds,
  exerciseName,
}: StopwatchSheetProps) {
  const { state, elapsed, switchRemaining, isOwner, isOrphan } = api;
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [committing, setCommitting] = useState(false);

  if (!state) return null;

  const sideLabel = state.hasSides
    ? state.side === 1 ? 'First side' : 'Second side'
    : null;
  const isStale = elapsed >= 600; // soft warning at 10 minutes
  const isVeryStale = elapsed >= 3600;

  // ─── Phase: done ─── auto-commit + close after the consumer writes
  if (state.phase === 'done') {
    if (!committing) {
      setCommitting(true);
      const dur = finalDurationSeconds(state);
      void Promise.resolve(onCommit(dur)).finally(() => api.consumeDone());
    }
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <Header onClose={onClose} title={exerciseName ?? 'Stopwatch'} />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Logged</p>
          <p className="text-5xl font-light tabular-nums">
            {formatStopwatch(finalDurationSeconds(state))}
            {state.hasSides && state.side2Elapsed != null && ' (longer)'}
          </p>
          {state.hasSides && (
            <div className="text-sm text-muted-foreground tabular-nums space-y-1 text-center">
              <div>First side: {formatStopwatch(state.side1Elapsed ?? 0)}</div>
              <div>Second side: {state.side2Elapsed != null ? formatStopwatch(state.side2Elapsed) : '—'}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Read-only recovery (non-owner tab or orphan set) ───
  if (!isOwner || isOrphan) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <Header onClose={onClose} title={isOrphan ? 'Set deleted' : 'Running in another tab'} />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {isOrphan ? 'Lost connection' : 'Read-only'}
          </p>
          <p className="text-5xl font-light tabular-nums">{formatStopwatch(elapsed)}</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            {isOrphan
              ? 'The set this stopwatch was timing has been deleted. Discard or copy the elapsed time to a new set.'
              : 'This stopwatch is running in another tab. Close it there to commit, or discard here.'}
          </p>
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => api.cancel()}
              className="px-5 h-12 rounded-xl bg-zinc-800 text-zinc-100 font-semibold text-sm"
            >
              Discard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Phase: switch_expired_paused ───
  if (state.phase === 'switch_expired_paused') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <Header onClose={onClose} title={exerciseName ?? 'Stopwatch'} />
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">First side done</p>
          <p className="text-5xl font-light tabular-nums">{formatStopwatch(state.side1Elapsed ?? 0)}</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            Ready for the second side?
          </p>
          <button
            onClick={api.resumeFromPause}
            className="w-32 h-32 rounded-full bg-primary active:scale-95 transition text-primary-foreground font-semibold text-base"
            aria-label="Start second side"
          >
            Start second side
          </button>
          <button
            onClick={api.logFirstOnly}
            className="text-sm text-muted-foreground underline"
            aria-label="Done — log first side only"
          >
            Done — log first side only
          </button>
        </div>
      </div>
    );
  }

  // ─── Phase: switching ───
  if (state.phase === 'switching') {
    const progress = Math.max(0, Math.min(1, switchRemaining / 10));
    const circumference = 2 * Math.PI * 100;
    const dashOffset = circumference * (1 - progress);
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <Header onClose={onClose} title={exerciseName ?? 'Stopwatch'} />
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            <span className="opacity-50">First side ✓</span>
            <span className="mx-2">→</span>
            <span className="text-primary">Second side</span>
          </div>
          <div className="relative w-60 h-60">
            <svg
              className="w-full h-full -rotate-90 motion-reduce:hidden"
              viewBox="0 0 240 240"
              aria-hidden="true"
            >
              <circle cx="120" cy="120" r="100" fill="none" stroke="hsl(var(--secondary))" strokeWidth="12" />
              <circle
                cx="120" cy="120" r="100" fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
            </svg>
            <div
              className="absolute inset-0 flex flex-col items-center justify-center"
              role="timer"
              aria-label={`Switch sides in ${switchRemaining} seconds`}
            >
              <span className="text-5xl font-light tabular-nums">{switchRemaining}</span>
              <span className="text-xs uppercase tracking-widest text-muted-foreground mt-2">switch sides</span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground max-w-xs">
            First side: {formatStopwatch(state.side1Elapsed ?? 0)}
          </p>
          <button
            onClick={api.skipSwitch}
            className="text-sm text-muted-foreground underline px-4 py-3"
            aria-label="Skip switch — start second side now"
          >
            Skip — start second side now
          </button>
        </div>
      </div>
    );
  }

  // ─── Phase: counting (side 1 or side 2) ───
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <Header onClose={onClose} title={exerciseName ?? 'Stopwatch'} />
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center">
        {sideLabel && (
          <p
            className="text-xs uppercase tracking-widest text-primary"
            role="status"
          >
            {sideLabel}
          </p>
        )}
        <p
          className="text-5xl font-light tabular-nums"
          aria-live="polite"
          aria-atomic="true"
        >
          {formatStopwatch(elapsed)}
        </p>
        {replacingSeconds != null && replacingSeconds > 0 && (
          <p className="text-xs text-muted-foreground">
            Replacing {formatStopwatch(replacingSeconds)}
          </p>
        )}
        {isVeryStale ? (
          <p className="text-sm text-amber-500 max-w-xs">
            Timer ran for {Math.floor(elapsed / 60)}m — was the app suspended? Discard if this isn&apos;t right.
          </p>
        ) : isStale ? (
          <p className="text-xs text-amber-500/80 max-w-xs">
            Timer running over 10 minutes — confirm before logging.
          </p>
        ) : null}
        <button
          onClick={api.stop}
          disabled={committing}
          className="w-32 h-32 rounded-full bg-red-500 active:bg-red-600 active:scale-95 transition text-white font-semibold text-lg disabled:opacity-50"
          aria-label={sideLabel ? `Stop ${sideLabel.toLowerCase()} stopwatch` : 'Stop stopwatch'}
        >
          Stop
        </button>
        {!discardConfirm ? (
          <button
            onClick={() => setDiscardConfirm(true)}
            className="text-sm text-red-500/80 underline px-4 py-3"
            aria-label="Discard stopwatch"
          >
            Discard
          </button>
        ) : (
          <div className="flex gap-3 items-center">
            <span className="text-xs text-muted-foreground">Discard {formatStopwatch(elapsed)}?</span>
            <button
              onClick={() => { setDiscardConfirm(false); api.cancel(); }}
              className="px-3 h-9 rounded-lg bg-red-500/15 text-red-500 text-sm font-semibold"
            >
              Yes
            </button>
            <button
              onClick={() => setDiscardConfirm(false)}
              className="px-3 h-9 rounded-lg bg-zinc-800 text-zinc-200 text-sm"
            >
              No
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Header({ onClose, title }: { onClose: () => void; title: string }) {
  return (
    <div className="flex items-center justify-between px-4 pt-safe-plus pb-3 border-b border-border">
      <button
        onClick={onClose}
        className="text-primary font-medium text-base px-2 py-1 min-h-[44px] min-w-[44px]"
        aria-label="Close stopwatch (preserves running state)"
      >
        Close
      </button>
      <h2 className="font-semibold truncate px-2">{title}</h2>
      <div className="w-14" />
    </div>
  );
}
