/**
 * HrtContext — derives "weeks since last protocol change" from the synced
 * `hrt_timeline_periods` Dexie table. Used by the prescription engine to:
 *
 *   1. Suppress e1RM-stagnation as a DELOAD trigger when the protocol
 *      changed within the last 4 weeks (strength recalibration is expected
 *      and would create false-positive deload recommendations).
 *   2. Surface a context note next to the prescription card explaining
 *      what the engine is downweighting and why.
 *
 * Schema reality (verified during /autoplan eng review):
 *   `hrt_timeline_periods` columns are uuid, name, started_at (DATE),
 *   ended_at (DATE NULL=current), doses_e (TEXT), doses_t_blocker (TEXT),
 *   doses_other (JSONB), notes. There is NO `drug` column and NO
 *   `cycle_days` column — so trough-day inference is NOT shippable in v1.1.
 *   The trough-day chip was dropped at the gate; this module surfaces only
 *   `weeks_since_protocol_change` and the current period's display name.
 *
 * Period selection rule (explicit per eng spec):
 *   WHERE started_at <= today
 *     AND (ended_at IS NULL OR ended_at >= today)
 *   ORDER BY started_at DESC LIMIT 1
 *   Overlapping periods (started_at tie): created_at DESC, then uuid DESC.
 */

export interface HrtTimelinePeriodInput {
  uuid: string;
  /** YYYY-MM-DD. */
  started_at: string;
  /** YYYY-MM-DD. NULL means "current — no end date". */
  ended_at: string | null;
  /** Period display name (e.g. "Estrogel + Cypro Q2 2026"). */
  name: string;
  /** ISO timestamp — used for tiebreak when two periods have the same started_at. */
  created_at: string;
}

export interface HrtContext {
  /** Days between today and the current period's start date. NULL when no
   *  current period exists. */
  weeks_since_protocol_change: number | null;
  /** Display name of the current period. NULL when no current period. */
  current_period_name: string | null;
  /** YYYY-MM-DD start date of the current period. NULL when no current. */
  current_period_started_at: string | null;
}

/**
 * Pick the current HRT period and derive context.
 *
 * @param periods All known periods (Dexie scan, no need to pre-filter).
 * @param today YYYY-MM-DD reference date.
 */
export function deriveHrtContext(
  periods: readonly HrtTimelinePeriodInput[],
  today: string,
): HrtContext {
  // Find all "currently active" periods (start ≤ today AND (end null OR end ≥ today)).
  const active = periods.filter(p => {
    if (p.started_at > today) return false;
    if (p.ended_at != null && p.ended_at < today) return false;
    return true;
  });

  if (active.length === 0) {
    return {
      weeks_since_protocol_change: null,
      current_period_name: null,
      current_period_started_at: null,
    };
  }

  // Tiebreak: most-recent started_at first, then created_at DESC, then uuid DESC.
  active.sort((a, b) => {
    if (a.started_at !== b.started_at) return b.started_at.localeCompare(a.started_at);
    if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at);
    return b.uuid.localeCompare(a.uuid);
  });
  const current = active[0];

  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const startMs = Date.parse(`${current.started_at}T00:00:00Z`);
  const days = Math.round((todayMs - startMs) / 86_400_000);
  const weeks = Math.max(0, Math.floor(days / 7));

  return {
    weeks_since_protocol_change: weeks,
    current_period_name: current.name,
    current_period_started_at: current.started_at,
  };
}

/**
 * True when the active protocol is "recent enough" that strength
 * recalibration is expected — engine should suppress e1rm_stagnant as a
 * DELOAD trigger and add a context note to the prescription card.
 *
 * Threshold: 4 weeks. Conservative — strength curves typically stabilize
 * within 3-6 weeks of a hormone-regimen change for trained lifters.
 */
export function isRecentProtocolChange(ctx: HrtContext): boolean {
  return ctx.weeks_since_protocol_change != null && ctx.weeks_since_protocol_change < 4;
}

/**
 * Generate a human-readable context note for the PrescriptionCard footer.
 * Returns null when no note is needed (settled state ≥4 weeks, or no
 * period at all).
 */
export function hrtContextNote(ctx: HrtContext): string | null {
  if (!isRecentProtocolChange(ctx)) return null;
  const w = ctx.weeks_since_protocol_change!;
  if (w === 0) return 'Recent protocol change today — strength variance expected';
  return `Recent protocol change (${w} ${w === 1 ? 'week' : 'weeks'} ago) — strength variance expected`;
}
