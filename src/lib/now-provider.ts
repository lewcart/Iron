// Clock injection for E2E test runs. Default delegates to real Date.now().
// `setNow(iso)` pins the clock so date-bound code (today's nutrition, this
// week's volume, sleep windows) reads a deterministic timestamp.
//
// Migration: callsites that need test-determinism import `now()` /
// `today(tz)` from here instead of `Date.now()` / `new Date()`. The sweep
// is incremental — un-migrated callsites stay on real wall-clock.

let override: number | null = null;

export function now(): number {
  return override !== null ? override : Date.now();
}

export function setNow(iso: string | null): void {
  if (iso === null) {
    override = null;
    return;
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`now-provider: invalid ISO date "${iso}"`);
  }
  override = ms;
}

export function isPinned(): boolean {
  return override !== null;
}

// Returns a YYYY-MM-DD string in the given IANA timezone. Defaults to
// Australia/Brisbane (Lou's local). Single-user app, single timezone — but
// keep the param so test fixtures can pin other zones if needed.
export function today(tz = 'Australia/Brisbane'): string {
  const d = new Date(now());
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
