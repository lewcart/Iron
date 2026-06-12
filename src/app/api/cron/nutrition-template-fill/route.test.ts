import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/db/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { GET } from './route';
import { query } from '@/db/db';

const mockedQuery = vi.mocked(query);

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockedQuery.mockReset();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/cron/nutrition-template-fill', { headers });
}

describe('GET /api/cron/nutrition-template-fill — auth', () => {
  it('rejects without auth when CRON_SECRET is set', async () => {
    process.env.CRON_SECRET = 'cron-secret-xyz';
    delete process.env.REBIRTH_API_KEY;

    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('accepts CRON_SECRET via Bearer header', async () => {
    process.env.CRON_SECRET = 'cron-secret-xyz';
    delete process.env.REBIRTH_API_KEY;
    mockedQuery.mockResolvedValue([]);

    const res = await GET(makeReq({ authorization: 'Bearer cron-secret-xyz' }));
    expect(res.status).toBe(200);
  });

  it('accepts REBIRTH_API_KEY too (so curl still works)', async () => {
    delete process.env.CRON_SECRET;
    process.env.REBIRTH_API_KEY = 'api-key-abc';
    mockedQuery.mockResolvedValue([]);

    const res = await GET(makeReq({ 'x-api-key': 'api-key-abc' }));
    expect(res.status).toBe(200);
  });

  it('open access when nothing is configured (local dev)', async () => {
    delete process.env.CRON_SECRET;
    delete process.env.REBIRTH_API_KEY;
    mockedQuery.mockResolvedValue([]);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
  });

  it('rejects wrong secret', async () => {
    process.env.CRON_SECRET = 'cron-secret-xyz';
    process.env.REBIRTH_API_KEY = 'api-key-abc';

    const res = await GET(makeReq({ authorization: 'Bearer wrong' }));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/cron/nutrition-template-fill — sweep loop', () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.REBIRTH_API_KEY;
  });

  it('skips dates already stamped with template_applied_at', async () => {
    // Every date returns an already-stamped day note → no inserts.
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM nutrition_day_notes WHERE date')) {
        return [{ uuid: 'dn', template_applied_at: '2026-05-01T01:00:00Z' }] as never;
      }
      return [] as never;
    });

    const res = await GET(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.days_stamped).toBe(0);
    expect(body.rows_materialized).toBe(0);

    // We never queried week_meals or inserted logs.
    const calls = mockedQuery.mock.calls.map(c => c[0] as string);
    expect(calls.some(s => s.includes('FROM nutrition_week_meals'))).toBe(false);
    expect(calls.some(s => s.includes('INSERT INTO nutrition_logs'))).toBe(false);
  });

  it('materializes templates and stamps day notes for unstamped dates', async () => {
    let dayNoteCalls = 0;
    mockedQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM nutrition_day_notes WHERE date')) {
        dayNoteCalls++;
        // First date: unstamped. All later: stamped (so we only do work once).
        if (dayNoteCalls === 1) return [] as never;
        return [{ uuid: 'dn', template_applied_at: '2026-04-01T00:00:00Z' }] as never;
      }
      if (sql.includes('nutrition_week_meals')) {
        return [
          { uuid: 't-1', meal_slot: 'breakfast', meal_name: 'Oats',
            protein_g: 20, carbs_g: 55, fat_g: 8, calories: 350, sort_order: 0 },
          { uuid: 't-2', meal_slot: 'lunch', meal_name: 'Salad',
            protein_g: 35, carbs_g: 40, fat_g: 15, calories: 500, sort_order: 1 },
        ] as never;
      }
      if (sql.includes('SELECT DISTINCT template_meal_id')) {
        return [] as never;  // No existing logs for this date.
      }
      return [] as never;
      void params;
    });

    const res = await GET(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.days_stamped).toBe(1);
    expect(body.rows_materialized).toBe(2);

    const calls = mockedQuery.mock.calls;
    const inserts = calls.filter(c => (c[0] as string).includes('INSERT INTO nutrition_logs'));
    expect(inserts).toHaveLength(2);
    // status='planned', meal_type matches the template slot
    expect(inserts[0][0]).toContain("'planned'");

    const stamps = calls.filter(c => (c[0] as string).includes('INSERT INTO nutrition_day_notes'));
    expect(stamps).toHaveLength(1);
  });

  it('skips template_meal_ids already present in nutrition_logs (cross-device dedupe)', async () => {
    let dayNoteCalls = 0;
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM nutrition_day_notes WHERE date')) {
        dayNoteCalls++;
        if (dayNoteCalls === 1) return [] as never;
        return [{ uuid: 'dn', template_applied_at: '2026-04-01T00:00:00Z' }] as never;
      }
      if (sql.includes('nutrition_week_meals')) {
        return [
          { uuid: 't-1', meal_slot: 'breakfast', meal_name: 'Oats',
            protein_g: 20, carbs_g: 55, fat_g: 8, calories: 350, sort_order: 0 },
          { uuid: 't-2', meal_slot: 'lunch', meal_name: 'Salad',
            protein_g: 35, carbs_g: 40, fat_g: 15, calories: 500, sort_order: 1 },
        ] as never;
      }
      if (sql.includes('SELECT DISTINCT template_meal_id')) {
        // Client already auto-filled t-1 from this template — don't double-create.
        return [{ template_meal_id: 't-1' }] as never;
      }
      return [] as never;
    });

    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.rows_materialized).toBe(1);
    expect(body.details[0]).toMatchObject({ created: 1, skipped_existing: 1 });
  });
});

// ─── U5: effective macros at materialization time ────────────────────────────

describe('GET /api/cron/nutrition-template-fill — U5 effective-macro materialization', () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.REBIRTH_API_KEY;
  });

  it('recipe meal: log INSERT carries derived macros returned by the view (not stale stored aggregate)', async () => {
    // The effective-macros view already resolves ingredients server-side.
    // We simulate this by returning already-summed derived values from the
    // view mock — the cron just writes whatever the view returns.
    let dayNoteCalls = 0;
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM nutrition_day_notes WHERE date')) {
        dayNoteCalls++;
        if (dayNoteCalls === 1) return [] as never;
        return [{ uuid: 'dn', template_applied_at: '2026-04-01T00:00:00Z' }] as never;
      }
      // New query references nutrition_week_meal_effective AND nutrition_week_meals.
      if (sql.includes('nutrition_week_meals')) {
        // View returns ingredient-derived macros (e.g. 603 kcal from ingredients,
        // not the stale flat stored aggregate which might be 500).
        return [
          {
            uuid: 'recipe-meal-1',
            meal_slot: 'breakfast',
            meal_name: 'Protein Smoothie',
            protein_g: 55,
            carbs_g: 72,
            fat_g: 11,
            calories: 603,
            sort_order: 0,
          },
        ] as never;
      }
      if (sql.includes('SELECT DISTINCT template_meal_id')) {
        return [] as never;
      }
      return [] as never;
    });

    const res = await GET(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.rows_materialized).toBe(1);

    // The INSERT must carry exactly what the view returned (derived macros).
    const insertCall = mockedQuery.mock.calls.find(
      c => (c[0] as string).includes('INSERT INTO nutrition_logs'),
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    // params: [uuid, loggedAt, meal_type, meal_name, calories, protein_g, carbs_g, fat_g, template_meal_id]
    expect(params[4]).toBe(603);  // calories = derived
    expect(params[5]).toBe(55);   // protein_g = derived
    expect(params[6]).toBe(72);   // carbs_g = derived
    expect(params[7]).toBe(11);   // fat_g = derived
  });

  it('flat meal (is_recipe=false): view passes stored macros through; log carries them unchanged (regression)', async () => {
    let dayNoteCalls = 0;
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM nutrition_day_notes WHERE date')) {
        dayNoteCalls++;
        if (dayNoteCalls === 1) return [] as never;
        return [{ uuid: 'dn', template_applied_at: '2026-04-01T00:00:00Z' }] as never;
      }
      if (sql.includes('nutrition_week_meals')) {
        // Flat meal: view CASE returns stored aggregate unchanged.
        return [
          {
            uuid: 'flat-meal-1',
            meal_slot: 'lunch',
            meal_name: 'Chicken Rice',
            protein_g: 40,
            carbs_g: 80,
            fat_g: 10,
            calories: 570,
            sort_order: 0,
          },
        ] as never;
      }
      if (sql.includes('SELECT DISTINCT template_meal_id')) {
        return [] as never;
      }
      return [] as never;
    });

    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.rows_materialized).toBe(1);

    const insertCall = mockedQuery.mock.calls.find(
      c => (c[0] as string).includes('INSERT INTO nutrition_logs'),
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    expect(params[4]).toBe(570);  // calories = stored
    expect(params[5]).toBe(40);   // protein_g = stored
    expect(params[6]).toBe(80);   // carbs_g = stored
    expect(params[7]).toBe(10);   // fat_g = stored
  });

  it('already-stamped dates are skipped entirely — past logs are not rewritten', async () => {
    // All 14 days already have template_applied_at → cron must be a complete no-op.
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM nutrition_day_notes WHERE date')) {
        return [{ uuid: 'dn', template_applied_at: '2026-04-01T00:00:00Z' }] as never;
      }
      return [] as never;
    });

    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.days_stamped).toBe(0);
    expect(body.rows_materialized).toBe(0);

    // No INSERT into nutrition_logs — past logs are immutable snapshots.
    const inserts = mockedQuery.mock.calls.filter(
      c => (c[0] as string).includes('INSERT INTO nutrition_logs'),
    );
    expect(inserts).toHaveLength(0);
  });

  it('queries read from nutrition_week_meal_effective view (not raw table alone)', async () => {
    // Confirm the new SQL uses the view by verifying at least one query
    // references nutrition_week_meal_effective.
    mockedQuery.mockResolvedValue([]);

    await GET(makeReq());

    const allSqls = mockedQuery.mock.calls.map(c => c[0] as string);
    const usesView = allSqls.some(s => s.includes('nutrition_week_meal_effective'));
    expect(usesView).toBe(true);
  });
});
