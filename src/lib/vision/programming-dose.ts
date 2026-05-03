/**
 * Zod schema for `body_plan.programming_dose` — the untyped JSONB blob that
 * holds Lou's training-dose targets (sets/week per muscle, cardio targets,
 * etc.). Several call sites already inline-parse pieces of this; this module
 * is the single source of truth so adding a new field doesn't drift across
 * three files.
 *
 * v1.1 surface adds `cardio_zone2_minutes_weekly` and
 * `cardio_intervals_minutes_weekly` alongside the existing
 * `cardio_floor_minutes_weekly` (which stays as the umbrella total + fallback
 * for the single-ring rendering when sub-targets aren't set).
 *
 * Backwards-compatible: every field is optional; existing plans with only
 * `cardio_floor_minutes_weekly` continue to work unchanged.
 */

import { z } from 'zod';

/** A single training-dose target with its motivation. */
export const DoseTargetSchema = z.object({
  target: z.number().nonnegative(),
  rationale: z.string().optional().nullable(),
});
export type DoseTarget = z.infer<typeof DoseTargetSchema>;

/**
 * The full programming_dose JSONB blob. Every field is optional because
 * historical plans were written by hand before the schema existed.
 *
 * Catch-all `passthrough` allows additional muscle-volume keys
 * (e.g. `glutes_sets_weekly`, `chest_sets_weekly`) without listing them all
 * here — the cardio surface only cares about the cardio_* fields.
 */
export const ProgrammingDoseSchema = z
  .object({
    /** Umbrella cardio total. Lou's existing 240 min/week target lives here. */
    cardio_floor_minutes_weekly: DoseTargetSchema.optional().nullable(),
    /** v1.1: zone-2 (steady-state) sub-target. */
    cardio_zone2_minutes_weekly: DoseTargetSchema.optional().nullable(),
    /** v1.1: intervals (HIIT) sub-target. */
    cardio_intervals_minutes_weekly: DoseTargetSchema.optional().nullable(),
  })
  .passthrough();
export type ProgrammingDose = z.infer<typeof ProgrammingDoseSchema>;

/** Resolved cardio targets after looking at the dose blob. */
export interface CardioTargets {
  /** Umbrella total target (or null if unset). */
  total: number | null;
  /** Zone-2 sub-target (or null if unset). */
  zone2: number | null;
  /** Intervals sub-target (or null if unset). */
  intervals: number | null;
  /** True iff at least one of the above is set. False = render no tile. */
  any_set: boolean;
  /** True iff EITHER sub-target is set. Drives split-vs-single-ring tile UI. */
  split: boolean;
}

/**
 * Pull cardio targets out of a programming_dose blob, falling back gracefully
 * when fields are missing or malformed. Never throws — bad data is treated as
 * "unset."
 */
export function resolveCardioTargets(rawDose: unknown): CardioTargets {
  const parsed = ProgrammingDoseSchema.safeParse(rawDose);
  const dose = parsed.success ? parsed.data : ({} as ProgrammingDose);

  const total = dose.cardio_floor_minutes_weekly?.target ?? null;
  const zone2 = dose.cardio_zone2_minutes_weekly?.target ?? null;
  const intervals = dose.cardio_intervals_minutes_weekly?.target ?? null;

  return {
    total,
    zone2,
    intervals,
    any_set: total != null || zone2 != null || intervals != null,
    split: zone2 != null || intervals != null,
  };
}
