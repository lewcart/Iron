/**
 * photo-cadence — pure math driving the PhotoCadenceFooter on the Week page.
 *
 * Cadence: 28 days for front-pose progress photos. Tied to the projection
 * compare workflow — HRT silhouette change is a monthly signal (van Velzen
 * 2018), so monthly comparison photos are the right interval.
 *
 * Returns one of three states:
 *   no-photo-ever   — Lou has never logged a front-pose progress photo.
 *                     Footer renders distinct onboarding copy.
 *   overdue         — > 28 days since the last front-pose photo. Footer
 *                     renders prominently (promotes above Section B).
 *   soon            — 22..28 days since the last photo. Footer renders
 *                     gently, stays in the page footer.
 *   fresh           — ≤ 21 days since the last photo. Footer renders
 *                     nothing (silent — no nag).
 *
 * `dueIn` semantics:
 *   no-photo-ever → 0 (Lou is "0 days" away from being able to start)
 *   soon          → days REMAINING until overdue (positive 1..6)
 *   overdue       → days OVERDUE as a NEGATIVE number (so the chip can
 *                   render "-N days overdue" cleanly via dueIn)
 *   fresh         → days remaining until soon (positive 7..)
 */

export type PhotoCadenceStatus = 'no-photo-ever' | 'overdue' | 'soon' | 'fresh';

export interface PhotoCadenceState {
  status: PhotoCadenceStatus;
  /** Days from today until/since the soon/overdue threshold (see docstring). */
  dueIn: number;
}

const SOON_DAYS_BEFORE_DUE = 6;  // 22..28d window → soon
const CADENCE_DAYS = 28;

/**
 * Compute photo cadence state for the front-pose progress photo workflow.
 *
 * @param latestPhotoTakenAt YYYY-MM-DD of the most recent front-pose photo,
 *                           or null if none exists.
 * @param today              Reference date for the computation. Pass an
 *                           explicit Date for determinism in tests.
 */
export function photoCadenceState(
  latestPhotoTakenAt: string | null,
  today: Date,
): PhotoCadenceState {
  if (latestPhotoTakenAt == null) {
    return { status: 'no-photo-ever', dueIn: 0 };
  }
  const todayMs = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const latestParts = latestPhotoTakenAt.slice(0, 10).split('-').map(Number);
  if (latestParts.length !== 3 || latestParts.some(n => !Number.isFinite(n))) {
    // Treat malformed input as no-photo-ever rather than throwing.
    return { status: 'no-photo-ever', dueIn: 0 };
  }
  const latestMs = Date.UTC(latestParts[0], latestParts[1] - 1, latestParts[2]);
  const daysSince = Math.floor((todayMs - latestMs) / 86_400_000);

  if (daysSince > CADENCE_DAYS) {
    // Overdue: dueIn renders as how many days past 28
    return { status: 'overdue', dueIn: -(daysSince - CADENCE_DAYS) };
  }
  if (daysSince > CADENCE_DAYS - SOON_DAYS_BEFORE_DUE - 1) {
    // 22..28 days range
    return { status: 'soon', dueIn: CADENCE_DAYS - daysSince };
  }
  return { status: 'fresh', dueIn: CADENCE_DAYS - daysSince };
}
