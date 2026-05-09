/**
 * App-wide timezone resolution.
 *
 * Postgres runs in UTC, but week boundaries ("Monday 00:00") need to be
 * computed in the user's local civil time — otherwise queries answer in
 * the wrong week for several hours every weekend (e.g. AEST is UTC+10, so
 * 00:00 Mon AEST = 14:00 Sun UTC; UTC's `date_trunc('week', NOW())` still
 * returns the previous Monday until 10:00 AEST).
 *
 * This is single-user. The canonical app TZ is `Australia/Brisbane` (matching
 * `src/lib/sleep-stats.ts` and the rest of the codebase). It can be
 * overridden via the `USER_TZ` env var.
 *
 * For HTTP routes the client SHOULD pass `?tz=...` (an IANA TZ name from
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`); MCP tools fall back
 * to APP_TZ when no `tz` arg is supplied.
 */

const FALLBACK_TZ = 'Australia/Brisbane';

const VALID_TZ_RE = /^[A-Za-z][A-Za-z0-9+_./-]*$/;

/** Trim env-var noise (trailing newlines, surrounding whitespace) and validate
 *  before adopting. A bad USER_TZ has historically poisoned every downstream
 *  Postgres query because the bad string flows through `resolveTz(undefined)`
 *  back to APP_TZ. */
function loadAppTz(): string {
  const raw = process.env.USER_TZ;
  if (typeof raw !== 'string') return FALLBACK_TZ;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return FALLBACK_TZ;
  if (!VALID_TZ_RE.test(trimmed)) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return FALLBACK_TZ;
  }
}

/** Resolved user timezone — `process.env.USER_TZ` (trimmed + validated) if usable, else `'Australia/Brisbane'`. */
export const APP_TZ: string = loadAppTz();

/** Coerces an arbitrary input into a usable IANA TZ name. Falls back to
 *  `APP_TZ` for empty/invalid values. Validates against the runtime's ICU
 *  data via `Intl.DateTimeFormat`. */
export function resolveTz(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return APP_TZ;
  if (!VALID_TZ_RE.test(input) || input.length > 64) return APP_TZ;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: input }).format(new Date());
    return input;
  } catch {
    return APP_TZ;
  }
}
