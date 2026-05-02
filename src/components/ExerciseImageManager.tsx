'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, RefreshCcw, AlertTriangle, Check } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Sheet } from '@/components/ui/sheet';
import { db } from '@/db/local';
import { apiBase } from '@/lib/api/client';
import { rebirthJsonHeaders } from '@/lib/api/headers';
import type { LocalExerciseImageCandidate } from '@/db/local';

// In-app AI generation manager for an exercise's demo images.
//
// Two entry points:
//   - <ExerciseImageManagerTrigger /> — pencil chip overlay over the demo
//     strip when images exist; full-width "Generate demo images" CTA when
//     image_count === 0 / image_urls is empty.
//   - <ExerciseImageManagerSheet /> — the bottom sheet with history grid,
//     active marker, sticky regen footer, 3-phase progress.
//
// Data flow:
//   - Local Dexie liveQuery on `exercise_image_candidates` powers the
//     history grid (sync engine pulls server changes into Dexie).
//   - GET /api/exercises/[uuid]/image-candidates fetches a cumulative-cost
//     summary for the footer (jobs table is server-only).
//   - POST /generate-images kicks off a new pair (~$0.50, ~2 min).
//   - POST /image-candidates/activate swaps the active pair without
//     regenerating.
//
// PWA-suspend recovery:
//   When generate is in flight, we stamp localStorage with
//   { request_id, started_at, exercise_uuid }. On visibilitychange→visible
//   we poll /image-candidates?request_id=X for up to 5 min until either
//   the new batch appears (success — sync pull, swap UI) or status flips
//   to a terminal failure.
//
// Single-flight per exercise — regenerate button is disabled while pending.

interface BatchSummary {
  batch_id: string;
  created_at: string;
  is_active: boolean;
  frame1_url: string | null;
  frame2_url: string | null;
}

interface ManagerCommonProps {
  exerciseUuid: string;
}

interface ManagerEmptyStateProps extends ManagerCommonProps {
  variant: 'empty';
}

interface ManagerEditOverlayProps extends ManagerCommonProps {
  variant: 'overlay';
}

type ManagerProps = ManagerEmptyStateProps | ManagerEditOverlayProps;

const RECOVERY_KEY_PREFIX = 'rebirth.exerciseImageGen.pending.';
const RECOVERY_TIMEOUT_MS = 5 * 60 * 1000; // 5 min — generation budget + buffer
const POLL_INTERVAL_MS = 5_000;
// Heuristic phase-advance thresholds. Visual only — server is doing the real
// work and we approximate elapsed-since-start mapping to the sequential
// frame1 → frame2 → save path. Adjusting these doesn't affect correctness.
const PHASE_FRAME2_AT_S = 55;   // assume frame 1 finishes ~here
const PHASE_SAVING_AT_S = 110;  // assume frame 2 finishes ~here
const PHASE_STALL_AT_S = 180;   // copy softens to "still working" past here
// Matches COST_PAIR_CENTS in the server route (25c × 2 frames). If you change
// the per-frame cost there, change the label here.
const COST_CTA_LABEL = '~$0.50';

function recoveryKey(exerciseUuid: string) {
  return `${RECOVERY_KEY_PREFIX}${exerciseUuid}`;
}

interface PendingRecord {
  request_id: string;
  started_at: number;
}

function readPending(exerciseUuid: string): PendingRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(recoveryKey(exerciseUuid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingRecord;
    if (!parsed.request_id || !parsed.started_at) return null;
    if (Date.now() - parsed.started_at > RECOVERY_TIMEOUT_MS) {
      // Stale — clear and ignore.
      localStorage.removeItem(recoveryKey(exerciseUuid));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePending(exerciseUuid: string, requestId: string) {
  try {
    localStorage.setItem(
      recoveryKey(exerciseUuid),
      JSON.stringify({ request_id: requestId, started_at: Date.now() }),
    );
  } catch { /* localStorage may be disabled */ }
}

function clearPending(exerciseUuid: string) {
  try { localStorage.removeItem(recoveryKey(exerciseUuid)); } catch { /* noop */ }
}

// ─── Public components ──────────────────────────────────────────────────────

/** Shows either:
 *    variant='empty'   — a full-width CTA card prompting first-time generation.
 *    variant='overlay' — a small pencil chip absolutely positioned in the
 *                        top-right of the parent (caller wraps with `relative`). */
export function ExerciseImageManager(props: ManagerProps) {
  const [open, setOpen] = useState(false);

  if (props.variant === 'empty') {
    // Match the App-UI sibling sheet pattern (PhotoSheet, HealthKitPermissionsSheet):
    // utility tone, rounded-xl card, rounded-lg button, no decorative icon hero.
    return (
      <>
        <div className="ios-section p-4 flex items-center justify-between gap-3">
          <p className="text-sm text-foreground">No demo images yet.</p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg disabled:opacity-50"
          >
            Generate
          </button>
        </div>
        <ExerciseImageManagerSheet
          exerciseUuid={props.exerciseUuid}
          open={open}
          onClose={() => setOpen(false)}
        />
      </>
    );
  }

  // overlay variant — caller sets the parent to relative
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Manage demo images"
        className="absolute top-3 right-3 inline-flex items-center justify-center w-11 h-11 -m-1.5 z-10"
      >
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-black/50 text-white shadow-md backdrop-blur-sm hover:bg-black/70 transition-colors">
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </span>
      </button>
      <ExerciseImageManagerSheet
        exerciseUuid={props.exerciseUuid}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

// ─── Sheet ─────────────────────────────────────────────────────────────────

interface SheetProps {
  exerciseUuid: string;
  open: boolean;
  onClose: () => void;
}

type GenPhase = 'idle' | 'frame1' | 'frame2' | 'saving' | 'recovering';

interface GenError {
  message: string;
  cost_usd_cents?: number;
  status?: string;
}

function ExerciseImageManagerSheet({ exerciseUuid, open, onClose }: SheetProps) {
  const [phase, setPhase] = useState<GenPhase>('idle');
  const [error, setError] = useState<GenError | null>(null);
  const [activatingBatch, setActivatingBatch] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ generations: number; total_cost_cents: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const generationStartedRef = useRef<number>(0);
  // For the 'recovering' phase, elapsed is measured from the original
  // POST start time stored in localStorage (not Date.now()), so the
  // counter survives PWA suspend/resume cycles.
  const [recoveryStartedAt, setRecoveryStartedAt] = useState<number | null>(null);
  // Mirror phase into a ref so the recovery effect can read it without
  // re-installing the visibilitychange listener on every transition.
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // History from Dexie — local-first, instant.
  const candidates = useLiveQuery(
    () =>
      db.exercise_image_candidates
        .where('exercise_uuid').equals(exerciseUuid)
        .toArray(),
    [exerciseUuid],
    [] as LocalExerciseImageCandidate[],
  );

  const batches = useMemo(() => groupIntoBatches(candidates ?? []), [candidates]);

  // Tick the elapsed counter once a second while in flight. Only this
  // component needs to re-render — PairTile and other children are
  // unaffected (and `elapsed` is read only by RegenerateFooter).
  // For active generation, count from generationStartedRef (set in
  // handleRegenerate). For recovery, count from recoveryStartedAt
  // (the original POST timestamp from localStorage, so the counter
  // continues across PWA suspend/resume).
  useEffect(() => {
    if (phase === 'idle') {
      setElapsed(0);
      return;
    }
    const startedAt = phase === 'recovering'
      ? recoveryStartedAt
      : generationStartedRef.current;
    if (!startedAt) {
      setElapsed(0);
      return;
    }
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [phase, recoveryStartedAt]);

  // Fetch the cumulative cost summary whenever the sheet opens or a new
  // generation completes. Cheap; the local liveQuery handles everything else.
  const refreshSummary = useCallback(async () => {
    try {
      const res = await fetch(
        `${apiBase()}/api/exercises/${exerciseUuid}/image-candidates?limit=1`,
        { headers: rebirthJsonHeaders() },
      );
      if (!res.ok) return;
      const json = await res.json() as {
        summary?: { generations: number; total_cost_cents: number };
      };
      if (json.summary) setSummary(json.summary);
    } catch { /* noop */ }
  }, [exerciseUuid]);

  useEffect(() => {
    if (open) refreshSummary();
  }, [open, refreshSummary]);

  // Stable refs for the recovery effect so we don't re-install the
  // visibilitychange listener on every phase / summary-callback change.
  const refreshSummaryRef = useRef(refreshSummary);
  useEffect(() => { refreshSummaryRef.current = refreshSummary; }, [refreshSummary]);

  // Resume any pending generation when the sheet opens or visibility changes.
  // Effect installs once per exerciseUuid (not per phase change) — phase is
  // read via ref so transitions don't churn the listener / poll loop.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const tryRecover = () => {
      const pending = readPending(exerciseUuid);
      if (!pending) return;
      const livePhase = phaseRef.current;
      if (livePhase !== 'idle' && livePhase !== 'recovering') return; // already in flight locally

      setPhase('recovering');
      setRecoveryStartedAt(pending.started_at);
      const started = pending.started_at;
      pollId = setInterval(async () => {
        if (cancelled) return;
        if (Date.now() - started > RECOVERY_TIMEOUT_MS) {
          clearPending(exerciseUuid);
          if (pollId) clearInterval(pollId);
          if (!cancelled) {
            setPhase('idle');
            setRecoveryStartedAt(null);
            setError({ message: 'Last generation may have failed — check the history below.' });
          }
          return;
        }
        try {
          const res = await fetch(
            `${apiBase()}/api/exercises/${exerciseUuid}/image-candidates?request_id=${encodeURIComponent(pending.request_id)}`,
            { headers: rebirthJsonHeaders() },
          );
          if (!res.ok) return;
          const json = await res.json() as { status?: string };
          if (json.status === 'succeeded') {
            clearPending(exerciseUuid);
            if (pollId) clearInterval(pollId);
            const { syncEngine } = await import('@/lib/sync');
            await syncEngine.pull();
            if (!cancelled) {
              setPhase('idle');
              setRecoveryStartedAt(null);
              refreshSummaryRef.current();
            }
          } else if (
            json.status === 'failed_frame1' ||
            json.status === 'failed_frame2' ||
            json.status === 'failed_db' ||
            json.status === 'rollback_orphan'
          ) {
            clearPending(exerciseUuid);
            if (pollId) clearInterval(pollId);
            if (!cancelled) {
              setPhase('idle');
              setRecoveryStartedAt(null);
              setError({ message: 'Last generation failed.', status: json.status });
            }
          }
          // 'unknown' / 'running' — keep polling
        } catch { /* network blip — try next tick */ }
      }, POLL_INTERVAL_MS);
    };

    tryRecover();
    const onVis = () => { if (document.visibilityState === 'visible') tryRecover(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [exerciseUuid]);

  const handleRegenerate = useCallback(async () => {
    if (phase !== 'idle') return;
    setError(null);
    const requestId = crypto.randomUUID();
    writePending(exerciseUuid, requestId);
    setPhase('frame1');
    generationStartedRef.current = Date.now();
    try {
      const res = await fetch(
        `${apiBase()}/api/exercises/${exerciseUuid}/generate-images`,
        {
          method: 'POST',
          headers: rebirthJsonHeaders(),
          body: JSON.stringify({ request_id: requestId }),
        },
      );

      // We only know the actual phase server-side (it's sequential), so we
      // approximate locally: assume frame1 finishes around 60s, frame2
      // around 60s, then saving. This is just UX optics — the network
      // latency dominates.
      // Phase ticking is purely visual; the backend is doing the real work.
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as GenError;
        clearPending(exerciseUuid);
        throw body;
      }
      // Success — pull sync to get the new candidate rows.
      clearPending(exerciseUuid);
      setPhase('saving');
      const { syncEngine } = await import('@/lib/sync');
      await syncEngine.pull();
      setPhase('idle');
      // Visual feedback: the active-pill flips to the new tile via liveQuery,
      // and the cumulative-cost footer increments. No toast.
      refreshSummary();
    } catch (err) {
      const e = err as GenError | Error;
      if ('message' in e) {
        setError({
          message: e.message ?? 'Generation failed',
          cost_usd_cents: 'cost_usd_cents' in e ? e.cost_usd_cents : undefined,
          status: 'status' in e ? e.status : undefined,
        });
      } else {
        setError({ message: 'Generation failed' });
      }
      clearPending(exerciseUuid);
      setPhase('idle');
    }
  }, [exerciseUuid, phase, refreshSummary]);

  // Heuristic phase advance based on elapsed time. Real status comes via
  // the request resolving, but we want the user to feel forward motion.
  useEffect(() => {
    if (phase === 'frame1' && elapsed > PHASE_FRAME2_AT_S) setPhase('frame2');
    if (phase === 'frame2' && elapsed > PHASE_SAVING_AT_S) setPhase('saving');
  }, [phase, elapsed]);

  const handleActivate = useCallback(async (batchId: string) => {
    if (phase !== 'idle') return;
    setError(null);
    setActivatingBatch(batchId);
    try {
      const res = await fetch(
        `${apiBase()}/api/exercises/${exerciseUuid}/image-candidates/activate`,
        {
          method: 'POST',
          headers: rebirthJsonHeaders(),
          body: JSON.stringify({ batch_id: batchId }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { syncEngine } = await import('@/lib/sync');
      await syncEngine.pull();
      // Active-pill flip is the feedback (visible at the activated tile).
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'Activation failed' });
    } finally {
      setActivatingBatch(null);
    }
  }, [exerciseUuid, phase]);

  const generating = phase !== 'idle';

  // Sheet sizes to content when there's no history (avoids 85vh of dead air
  // around a single "No demo images yet." line). Once batches arrive or a
  // generation is in flight, lock to 85vh so the history grid + footer are
  // always reachable without resizing on every batch addition.
  const sheetHeight = batches.length === 0 && phase === 'idle' ? 'auto' : '85vh';

  return (
    <Sheet
      open={open}
      // Closing mid-generation is fine — the server keeps running, the
      // localStorage pending marker stays, and the recovery effect picks
      // up where we left off the next time the sheet opens.
      onClose={onClose}
      title="Demo images"
      height={sheetHeight}
      footer={
        <RegenerateFooter
          onRegenerate={handleRegenerate}
          phase={phase}
          elapsed={elapsed}
          summary={summary}
          hasHistory={batches.length > 0}
        />
      }
    >
      <div className="px-4 py-4">
        {error && (
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
        )}

        {batches.length > 0 && (
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-label-section">History</h3>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {batches.length} {batches.length === 1 ? 'pair' : 'pairs'}
            </span>
          </div>
        )}

        {batches.length === 0 && phase === 'idle' && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No demo images yet.
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" aria-label="Demo pair history">
          {batches.map(b => (
            <PairTile
              key={b.batch_id}
              batch={b}
              activating={activatingBatch === b.batch_id}
              disabled={generating || activatingBatch != null}
              onActivate={() => handleActivate(b.batch_id)}
            />
          ))}
        </div>
      </div>

    </Sheet>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

function PairTile({
  batch,
  activating,
  disabled,
  onActivate,
}: {
  batch: BatchSummary;
  activating: boolean;
  disabled: boolean;
  onActivate: () => void;
}) {
  const ageLabel = formatRelative(batch.created_at);
  return (
    <button
      type="button"
      aria-pressed={batch.is_active}
      aria-busy={activating}
      onClick={onActivate}
      disabled={disabled || batch.is_active}
      className={`relative flex flex-col gap-1 p-2 rounded-xl border text-left transition-colors ${
        batch.is_active
          ? 'border-primary bg-primary/10'
          : 'border-border hover:border-muted-foreground/40'
      } ${disabled && !batch.is_active ? 'opacity-50' : ''}`}
    >
      <div className="grid grid-cols-2 gap-1.5">
        {[batch.frame1_url, batch.frame2_url].map((src, i) => (
          <div key={i} className="aspect-[3/4] overflow-hidden rounded-lg bg-muted">
            {src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={`Frame ${i + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-1 px-1">
        <span className="text-[11px] text-muted-foreground">{ageLabel}</span>
        {batch.is_active && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
            <Check className="h-3 w-3" aria-hidden />
            Active
          </span>
        )}
        {activating && (
          <span className="text-[10px] text-muted-foreground">Activating…</span>
        )}
      </div>
    </button>
  );
}

function RegenerateFooter({
  onRegenerate,
  phase,
  elapsed,
  summary,
  hasHistory,
}: {
  onRegenerate: () => void;
  phase: GenPhase;
  elapsed: number;
  summary: { generations: number; total_cost_cents: number } | null;
  hasHistory: boolean;
}) {
  const isGenerating = phase !== 'idle';
  const ctaWord = hasHistory ? 'Regenerate' : 'Generate';
  const phaseLabel = (() => {
    switch (phase) {
      case 'frame1':     return `Generating start position…`;
      case 'frame2':     return `Generating end position…`;
      case 'saving':     return `Saving…`;
      case 'recovering': return `Resuming previous generation…`;
      default:           return null;
    }
  })();

  const stallNote = (() => {
    if (phase === 'frame2' && elapsed > PHASE_STALL_AT_S) {
      return 'Still working — image generation can take up to 4 min.';
    }
    if (phase === 'recovering') {
      return `Checking every ${POLL_INTERVAL_MS / 1000}s…`;
    }
    return null;
  })();

  return (
    <div className="space-y-2">
      {phaseLabel && (
        <div
          aria-live="polite"
          className="flex items-center justify-between text-xs text-muted-foreground"
        >
          <span>{phaseLabel}</span>
          <span className="tabular-nums">{elapsed}s</span>
        </div>
      )}
      {stallNote && (
        <p className="text-xs text-muted-foreground">{stallNote}</p>
      )}
      <button
        type="button"
        onClick={onRegenerate}
        disabled={isGenerating}
        aria-busy={isGenerating}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 min-h-[44px] bg-primary text-primary-foreground text-sm font-medium rounded-lg disabled:opacity-50"
      >
        <RefreshCcw className={`h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} aria-hidden />
        {isGenerating ? 'Generating…' : `${ctaWord} (${COST_CTA_LABEL})`}
      </button>
      <p className="text-[11px] text-muted-foreground text-center">
        ~2 min · OpenAI
        {summary && summary.generations > 0 && (
          <>
            {' · '}
            This exercise: {summary.generations} generation{summary.generations === 1 ? '' : 's'}
            {' · '}
            ${(summary.total_cost_cents / 100).toFixed(2)}
          </>
        )}
      </p>
    </div>
  );
}

function ErrorBanner({
  error,
  onDismiss,
}: {
  error: GenError;
  onDismiss: () => void;
}) {
  const costLine = error.cost_usd_cents != null && error.cost_usd_cents > 0
    ? ` OpenAI charged $${(error.cost_usd_cents / 100).toFixed(2)} for the partial completion.`
    : '';
  return (
    <div className="flex items-start gap-2 p-3 mb-4 bg-destructive/10 border border-destructive/30 rounded-xl">
      <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" aria-hidden />
      <div className="flex-1 text-xs text-destructive leading-relaxed">
        <p className="font-medium mb-0.5">Generation failed</p>
        <p>{error.message}{costLine}</p>
        {error.status && (
          <p className="text-destructive/70 mt-1">Status: {error.status}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="inline-flex items-center justify-center min-h-[36px] px-2 -my-1 text-destructive/70 text-xs underline"
      >
        Dismiss
      </button>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function groupIntoBatches(rows: LocalExerciseImageCandidate[]): BatchSummary[] {
  const grouped = new Map<string, BatchSummary>();
  for (const r of rows) {
    let b = grouped.get(r.batch_id);
    if (!b) {
      b = {
        batch_id: r.batch_id,
        created_at: r.created_at,
        is_active: false,
        frame1_url: null,
        frame2_url: null,
      };
      grouped.set(r.batch_id, b);
    }
    if (r.frame_index === 1) b.frame1_url = r.url;
    if (r.frame_index === 2) b.frame2_url = r.url;
    if (r.is_active) b.is_active = true;
    // Use the earliest created_at for the batch as a whole (frame 1 is
    // typically inserted before frame 2 in the same statement, but the
    // tx commit timestamp is what matters for ordering).
    if (r.created_at < b.created_at) b.created_at = r.created_at;
  }
  // Newest first.
  return Array.from(grouped.values()).sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day} days ago`;
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
