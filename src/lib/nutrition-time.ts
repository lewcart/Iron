/**
 * Date + status helpers for the nutrition page.
 *
 * Single-user app — all dates are computed in the user's local timezone (set
 * by the OS / browser). When you travel, the OS handles it. The DB stores
 * `nutrition_day_notes.date` as a plain YYYY-MM-DD string keyed to "the
 * calendar day you ate on" — no TZ conversion needed when reading.
 */

import type { LocalNutritionDayNote } from '@/db/local';

/** YYYY-MM-DD for a given Date in local time. */
export function toLocalDateString(d: Date): string {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

/** Today as YYYY-MM-DD in local time. */
export function todayLocal(): string {
  return toLocalDateString(new Date());
}

/** Add days to a YYYY-MM-DD; positive = future, negative = past. */
export function offsetDate(base: string, days: number): string {
  const d = new Date(base + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return toLocalDateString(d);
}

/** Format a YYYY-MM-DD for display (e.g. "Mar 14, 2026" or "Today"/"Yesterday"). */
export function formatDateLabel(dateStr: string, opts?: { relative?: boolean }): string {
  const today = todayLocal();
  if (opts?.relative !== false) {
    if (dateStr === today) return 'Today';
    if (dateStr === offsetDate(today, -1)) return 'Yesterday';
    if (dateStr === offsetDate(today, 1)) return 'Tomorrow';
  }
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

/** Display state for a day's approval. */
export type DayDisplayStatus = {
  kind: 'today' | 'reviewed' | 'logged';
  label: string;
};

/**
 * Derive the day's display status from its (possibly absent) day_note row
 * and the date being viewed.
 *
 * Rules:
 *   - approved_status === 'approved' → "Reviewed" (always)
 *   - else date === today → "Today" (CTA active)
 *   - else (past, not approved) → "Logged" (auto-derived; never written)
 *
 * Future dates render as "Today" too — read-only viewing of planned content.
 */
export function deriveDisplayStatus(
  date: string,
  dayNote: LocalNutritionDayNote | undefined,
  todayStr: string = todayLocal(),
): DayDisplayStatus {
  if (dayNote?.approved_status === 'approved') {
    return { kind: 'reviewed', label: 'Reviewed' };
  }
  if (date >= todayStr) {
    return { kind: 'today', label: 'Today' };
  }
  return { kind: 'logged', label: 'Logged' };
}

/** Returns true if the user can tap "Mark day reviewed" on this date. */
export function canApproveDay(date: string, todayStr: string = todayLocal()): boolean {
  return date <= todayStr;
}

/**
 * Parse an ISO timestamp into a finite number, or null if NaN/empty/invalid.
 * Use at form boundaries before persisting macros — Postgres NUMERIC rejects
 * NaN and breaks the sync push on rejection.
 */
export function safeParseNumber(input: string | null | undefined): number | null {
  if (input == null) return null;
  const trimmed = String(input).trim();
  if (trimmed === '') return null;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}
