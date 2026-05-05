import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { query } from '@/db/db';

/**
 * Daily server-side sweep that materializes the Standard Week template into
 * nutrition_logs for any date in the last SWEEP_WINDOW_DAYS where
 * template_applied_at IS NULL. Mirrors the client-side ensurePlannedLogsForDate
 * so the auto-fill happens even when Lou doesn't open the app.
 *
 * Triggered by Vercel Cron (vercel.json) at 15:00 UTC daily — 01:00
 * Brisbane (AEST UTC+10, no DST), comfortably past midnight local.
 *
 * Idempotency: once template_applied_at is stamped on a date, the cron skips
 * it forever — same contract as the client. If the user later deletes a
 * planned row, the cron will not resurrect it because the stamp prevents
 * re-entry, AND the per-row template_meal_id dedupe blocks it on the first
 * pass that runs after a stamp-clearing scenario (cross-device race).
 *
 * Auth accepts either:
 *   • CRON_SECRET — what Vercel Cron auto-injects.
 *   • REBIRTH_API_KEY — so curl/manual invocation from the CLI also works.
 *
 * If neither env var is set (local dev), open access. Same defaults as
 * requireApiKey().
 */

const SWEEP_WINDOW_DAYS = 14;

/** YYYY-MM-DD in Australia/Brisbane (single-user app — Lou's local calendar). */
function todayLocal(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date());
}

function dateAddDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Mirrors src/lib/api/nutrition.ts:dateToDayOfWeek. 0=Mon … 6=Sun. */
function dateToDayOfWeek(dateStr: string): number {
  const jsDay = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const apiKey = process.env.REBIRTH_API_KEY;

  // Local dev: nothing configured → allow.
  if (!cronSecret && !apiKey) return true;

  const authHeader = request.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const xApiKey = request.headers.get('x-api-key');
  const provided = bearer ?? xApiKey;
  if (!provided) return false;

  return (cronSecret && provided === cronSecret) ||
         (apiKey && provided === apiKey) ||
         false;
}

interface SweepResult {
  ok: true;
  swept_window_days: number;
  days_stamped: number;
  rows_materialized: number;
  details: Array<{ date: string; created: number; skipped_existing: number }>;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = todayLocal();
  const result: SweepResult = {
    ok: true,
    swept_window_days: SWEEP_WINDOW_DAYS,
    days_stamped: 0,
    rows_materialized: 0,
    details: [],
  };

  for (let i = 0; i < SWEEP_WINDOW_DAYS; i++) {
    const date = dateAddDays(today, -i);
    const dow = dateToDayOfWeek(date);

    const noteRows = await query<{ uuid: string; template_applied_at: string | null }>(
      `SELECT uuid, template_applied_at FROM nutrition_day_notes WHERE date = $1`,
      [date],
    );
    if (noteRows[0]?.template_applied_at) continue;

    const templates = await query<{
      uuid: string; meal_slot: string; meal_name: string;
      protein_g: number | null; carbs_g: number | null; fat_g: number | null;
      calories: number | null; sort_order: number;
    }>(
      `SELECT uuid, meal_slot, meal_name, protein_g, carbs_g, fat_g, calories, sort_order
         FROM nutrition_week_meals
         WHERE day_of_week = $1
         ORDER BY sort_order ASC`,
      [dow],
    );

    let created = 0;
    let skipped = 0;

    if (templates.length > 0) {
      // Dedupe vs any logs already on this date with a matching template_meal_id
      // (handles cross-device case where the client already auto-filled and
      // possibly edited some rows before sync caught up).
      const existing = await query<{ template_meal_id: string }>(
        `SELECT DISTINCT template_meal_id
           FROM nutrition_logs
           WHERE template_meal_id IS NOT NULL
             AND logged_at >= $1::date
             AND logged_at <  ($1::date + INTERVAL '1 day')`,
        [date],
      );
      const used = new Set(existing.map(r => r.template_meal_id));

      const baseMs = Date.parse(`${date}T12:00:00.000Z`);
      for (let j = 0; j < templates.length; j++) {
        const t = templates[j];
        if (used.has(t.uuid)) {
          skipped++;
          continue;
        }
        const loggedAt = new Date(baseMs + j * 1000).toISOString();
        await query(
          `INSERT INTO nutrition_logs
             (uuid, logged_at, meal_type, meal_name, calories, protein_g, carbs_g, fat_g,
              notes, template_meal_id, status, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, 'planned', NOW())`,
          [randomUUID(), loggedAt, t.meal_slot, t.meal_name, t.calories,
           t.protein_g, t.carbs_g, t.fat_g, t.uuid],
        );
        created++;
      }
    }

    // Stamp the day note. INSERT-or-UPDATE keyed on date (UNIQUE constraint).
    // The WHERE on UPDATE makes the stamp one-way: a stale client pushing
    // template_applied_at=null cannot un-stamp a date the cron has filled.
    await query(
      `INSERT INTO nutrition_day_notes
         (uuid, date, template_applied_at, approved_status, updated_at)
       VALUES ($1, $2, NOW(), 'pending', NOW())
       ON CONFLICT (date) DO UPDATE
         SET template_applied_at = COALESCE(nutrition_day_notes.template_applied_at, NOW()),
             updated_at = NOW()`,
      [randomUUID(), date],
    );

    result.days_stamped++;
    result.rows_materialized += created;
    result.details.push({ date, created, skipped_existing: skipped });
  }

  return NextResponse.json(result);
}
