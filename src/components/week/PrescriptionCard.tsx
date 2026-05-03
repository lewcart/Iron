'use client';

/**
 * PrescriptionCard — Week-page v1.1 banner at the top of Section A.
 *
 * Visual language: BANNER, not tile. Different chrome from the v1 tiles
 * (`bg-primary/5 border-primary/20`) so it visually reads as a recommendation
 * not a report. Top of page = "what to do" before "where you are".
 *
 * Render-state matrix (per /autoplan design spec):
 *   data === null                                → loading skeleton
 *   { eligibility:{eligible:0,...}, prescriptions:[] } → "Building your
 *                                                   prescription — N wks of
 *                                                   data so far"
 *   eligibility.eligible > 0 + prescriptions:[] → all-HOLD, render nothing
 *   prescriptions has rows                      → banner + rows
 *
 * A11y: each row IS the tap target (44pt min-height), opens a sheet with
 * full English reason explanations. Reason chips are passive labels with
 * symbol-stripped aria-labels.
 *
 * Action visual: icon + label + color (NEVER color-only):
 *   PUSH   → TrendingUp + emerald
 *   REDUCE → TrendingDown + amber
 *   DELOAD → AlertTriangle + red
 *   HOLD   → never rendered (filtered by engine)
 */

import { useState } from 'react';
import { TrendingUp, TrendingDown, AlertTriangle, ChevronRight } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import {
  REASON_CHIP_REGISTRY,
  type ReasonChip,
} from '@/lib/training/reason-chip-registry';
import type {
  PriorityMusclePrescription,
  PrescriptionEngineResult,
} from '@/lib/training/prescription-engine';

export interface PrescriptionCardProps {
  /** Engine result, or null while underlying facts are loading. */
  data: PrescriptionEngineResult | null;
}

export function PrescriptionCard({ data }: PrescriptionCardProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  // Loading
  if (data === null) {
    return (
      <div
        className="rounded-2xl bg-muted/40 dark:bg-muted/20 border border-border h-20 animate-pulse"
        aria-hidden
      />
    );
  }

  const { prescriptions, eligibility, hrtContextNotes } = data;

  // Warming up — eligible muscles haven't accumulated enough weeks yet.
  if (eligibility.eligible === 0 && eligibility.ineligible > 0 && prescriptions.length === 0) {
    return (
      <section
        className="rounded-2xl bg-muted/30 border border-border/50 px-4 py-3"
        aria-label="Prescription warming up — insufficient data"
      >
        <p className="text-xs text-muted-foreground leading-snug">
          Building your prescription — {eligibility.ineligible} priority
          {' '}{eligibility.ineligible === 1 ? 'muscle' : 'muscles'} still warming up
        </p>
      </section>
    );
  }

  // All eligible muscles HOLD → render nothing (engine already filtered HOLDs).
  if (prescriptions.length === 0) {
    return null;
  }

  const open = openIdx != null ? prescriptions[openIdx] : null;
  const partialFooter =
    eligibility.ineligible > 0
      ? `${eligibility.ineligible} of ${eligibility.eligible + eligibility.ineligible} priority muscles still warming up`
      : null;

  return (
    <>
      <section
        className="rounded-2xl bg-primary/5 border border-primary/20 shadow-sm p-4"
        aria-label="Next-week prescription"
      >
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">
            Next Week
          </span>
        </div>

        <ul className="divide-y divide-primary/10 -mx-1">
          {prescriptions.map((p, i) => (
            <li key={`${p.muscle}-${i}`}>
              <button
                type="button"
                onClick={() => setOpenIdx(i)}
                className="w-full text-left flex items-center gap-3 px-1 py-3 min-h-[44px] hover:bg-primary/5 active:bg-primary/10 transition-colors rounded-lg"
                aria-label={`${displayMuscle(p.muscle)}: ${actionAriaLabel(p)} — open detail`}
              >
                <ActionGlyph action={p.action} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">
                      {displayMuscle(p.muscle)}
                    </span>
                    <span className={`text-xs font-semibold uppercase tracking-wide ${actionTone(p.action)}`}>
                      {actionLabel(p)}
                    </span>
                  </div>
                  {p.reasons.length > 0 && (
                    <div className="mt-1 flex items-center gap-1 flex-wrap">
                      {p.reasons.map((chip, ci) => (
                        <ReasonChipPill key={ci} chip={chip} />
                      ))}
                    </div>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>

        {hrtContextNotes.length > 0 && (
          <div className="mt-3 pt-3 border-t border-primary/10">
            {hrtContextNotes.map((note, i) => (
              <p
                key={i}
                className="text-[11px] italic text-muted-foreground leading-snug"
              >
                {note}
              </p>
            ))}
          </div>
        )}

        {partialFooter && (
          <p className="mt-2 text-[10px] text-muted-foreground leading-snug">
            {partialFooter}
          </p>
        )}
      </section>

      <Sheet
        open={open != null}
        onClose={() => setOpenIdx(null)}
        title={open ? `${displayMuscle(open.muscle)} — ${actionLabel(open)}` : ''}
        height="auto"
      >
        {open && <PrescriptionDetail prescription={open} />}
      </Sheet>
    </>
  );
}

function PrescriptionDetail({ prescription }: { prescription: PriorityMusclePrescription }) {
  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-center gap-3">
        <ActionGlyph action={prescription.action} large />
        <div>
          <div className={`text-base font-semibold ${actionTone(prescription.action)}`}>
            {actionLabel(prescription)}
          </div>
          {prescription.action === 'DELOAD' && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Reduce sets ~50% and load ~20% across all priority muscles for one week.
            </p>
          )}
        </div>
      </div>

      {prescription.reasons.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Why
          </h4>
          <ul className="space-y-2.5">
            {prescription.reasons.map((chip, i) => (
              <li key={i} className="text-sm text-foreground leading-relaxed">
                <span className="font-medium">{REASON_CHIP_REGISTRY[chip.kind].label(chip)}</span>
                <span className="block text-muted-foreground text-xs mt-0.5">
                  {REASON_CHIP_REGISTRY[chip.kind].explanation(chip)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          No specific signals — this recommendation is driven by your zone classification alone.
        </p>
      )}
    </div>
  );
}

// ── Primitives ───────────────────────────────────────────────────────────

function ReasonChipPill({ chip }: { chip: ReasonChip }) {
  const meta = REASON_CHIP_REGISTRY[chip.kind];
  return (
    <span
      className="text-[10px] font-medium tabular-nums px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground"
      aria-label={meta.ariaLabel(chip)}
    >
      {meta.label(chip)}
    </span>
  );
}

function ActionGlyph({ action, large = false }: { action: 'PUSH' | 'REDUCE' | 'DELOAD'; large?: boolean }) {
  const cls = `${large ? 'h-6 w-6' : 'h-4 w-4'} shrink-0`;
  const tone = actionIconTone(action);
  if (action === 'PUSH') return <TrendingUp className={`${cls} ${tone}`} strokeWidth={2} />;
  if (action === 'REDUCE') return <TrendingDown className={`${cls} ${tone}`} strokeWidth={2} />;
  return <AlertTriangle className={`${cls} ${tone}`} strokeWidth={2} />;
}

function actionLabel(p: PriorityMusclePrescription): string {
  if (p.action === 'DELOAD') return 'DELOAD';
  const sets = p.delta.sets ?? 0;
  if (p.action === 'PUSH') return `PUSH +${sets} set${sets === 1 ? '' : 's'}`;
  return `REDUCE ${sets} set${Math.abs(sets) === 1 ? '' : 's'}`;
}

function actionAriaLabel(p: PriorityMusclePrescription): string {
  if (p.action === 'DELOAD') return 'Deload — reduce sets and load this week';
  const sets = p.delta.sets ?? 0;
  if (p.action === 'PUSH') return `Push: add ${sets} set${sets === 1 ? '' : 's'} next week`;
  return `Reduce: drop ${Math.abs(sets)} set${Math.abs(sets) === 1 ? '' : 's'} next week`;
}

function actionTone(action: 'PUSH' | 'REDUCE' | 'DELOAD'): string {
  if (action === 'PUSH') return 'text-emerald-700 dark:text-emerald-400';
  if (action === 'REDUCE') return 'text-amber-700 dark:text-amber-400';
  return 'text-red-700 dark:text-red-400';
}

function actionIconTone(action: 'PUSH' | 'REDUCE' | 'DELOAD'): string {
  if (action === 'PUSH') return 'text-emerald-600 dark:text-emerald-400';
  if (action === 'REDUCE') return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function displayMuscle(slug: string): string {
  if (slug === 'whole-body') return 'Whole body';
  // Mirror the canonical taxonomy display names from src/lib/muscles.ts
  const map: Record<string, string> = {
    glutes: 'Glutes',
    lats: 'Lats',
    delts: 'Delts',
    chest: 'Chest',
    quads: 'Quads',
    hamstrings: 'Hamstrings',
    hip_abductors: 'Hip abductors',
    hip_adductors: 'Hip adductors',
    calves: 'Calves',
    triceps: 'Triceps',
    biceps: 'Biceps',
    traps: 'Traps',
    mid_traps: 'Mid traps',
    lower_traps: 'Lower traps',
    forearms: 'Forearms',
    core: 'Abs / core',
    abs: 'Abs',
    obliques: 'Obliques',
  };
  return map[slug] ?? slug.replace(/_/g, ' ');
}
