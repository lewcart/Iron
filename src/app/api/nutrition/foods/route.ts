import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { randomUUID } from 'crypto';
import { query } from '@/db/db';
import { requireApiKey } from '@/lib/api-auth';
import { searchOpenFoodFacts, searchUsdaFdc } from '@/lib/food-search-remote';

/**
 * Three-layer food search:
 *   Layer 1 — local nutrition_food_canonical (Fitbee imports + previously
 *             seeded OFF/USDA selections). Fastest, most relevant.
 *   Layer 2 — Open Food Facts (no API key, ~3M branded products).
 *   Layer 3 — USDA FoodData Central (free with API key, ~2M foods).
 *
 * Layers 2/3 run in parallel with timeouts; failures degrade gracefully to
 * "Layer 1 only" without erroring the request.
 *
 * POST /api/nutrition/foods — seeds L1 with an OFF/USDA selection so that
 * food shows up as a Layer-1 hit on the next search.
 */

// Source of truth lives in src/lib/nutrition-history-types.ts so the
// Capacitor build can import it from client code.
export type { FoodResult } from '@/lib/nutrition-history-types';
import type { FoodResult } from '@/lib/nutrition-history-types';

interface CanonicalRow {
  food_name: string;
  calories: string | number | null;
  protein_g: string | number | null;
  carbs_g: string | number | null;
  fat_g: string | number | null;
  nutrients: Record<string, unknown> | null;
  last_logged_at: Date | string | null;
  times_logged: string | number;
  is_prefix_match: boolean;
}

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

function isoOrNull(v: Date | string | null): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

// Lower than pg_trgm's default of 0.3 so single-character typos still match
// foods like "L'Oreal latte" vs "Loreal latte". Tuned per-query rather than
// session-wide so concurrent searches don't fight over the threshold.
const TRIGRAM_THRESHOLD = 0.22;

async function searchLayer1(safeQ: string, rawQ: string, limit: number): Promise<FoodResult[]> {
  const rows = await query<CanonicalRow>(
    `SELECT
       food_name,
       calories,
       protein_g,
       carbs_g,
       fat_g,
       nutrients,
       last_logged_at,
       times_logged,
       (canonical_name LIKE $1 || '%' ESCAPE '\\') AS is_prefix_match
     FROM nutrition_food_canonical
     WHERE canonical_name LIKE $1 || '%' ESCAPE '\\'
        OR canonical_name LIKE '%' || $1 || '%' ESCAPE '\\'
        OR similarity(canonical_name, $2) >= $4
     ORDER BY is_prefix_match DESC, times_logged DESC, last_logged_at DESC
     LIMIT $3`,
    [safeQ, rawQ.toLowerCase(), limit, TRIGRAM_THRESHOLD],
  );

  return rows.map((r) => ({
    source: 'local' as const,
    food_name: r.food_name,
    serving_size: null,
    calories: num(r.calories),
    protein_g: num(r.protein_g),
    carbs_g: num(r.carbs_g),
    fat_g: num(r.fat_g),
    nutrients: r.nutrients ?? null,
    external_id: null,
    meta: {
      times_logged: Number(r.times_logged),
      last_logged_at: isoOrNull(r.last_logged_at) ?? undefined,
    },
  }));
}

// 24h cache on remote results. Two separate cache scopes per source so a
// timeout on one doesn't poison the other's cache.
const cachedOff = unstable_cache(
  (q: string) => searchOpenFoodFacts(q, 15),
  ['food-search-off'],
  { revalidate: 60 * 60 * 24 },
);
const cachedUsda = unstable_cache(
  (q: string) => searchUsdaFdc(q, 15),
  ['food-search-usda'],
  { revalidate: 60 * 60 * 24 },
);

function dedupeAndCombine(
  layer1: FoodResult[],
  layer2: FoodResult[],
  layer3: FoodResult[],
  cap: number,
): FoodResult[] {
  // Layer 1 wins ties. Keep first occurrence of (lowercase) food_name.
  const seen = new Set<string>();
  const out: FoodResult[] = [];
  const push = (r: FoodResult) => {
    const key = r.food_name.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };
  for (const r of layer1) push(r);
  for (const r of layer2) push(r);
  for (const r of layer3) push(r);
  return out.slice(0, cap);
}

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const rawQ = (searchParams.get('q') ?? '').trim();
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
  const sourcesParam = searchParams.get('sources');
  const sources = sourcesParam
    ? new Set(sourcesParam.split(',').map((s) => s.trim()))
    : new Set(['local', 'off', 'usda']);

  if (rawQ.length < 2) {
    return NextResponse.json({ error: 'q must be at least 2 characters' }, { status: 400 });
  }
  if (rawQ.length > 100) {
    return NextResponse.json({ error: 'q must be at most 100 characters' }, { status: 400 });
  }

  const safeQ = escapeLike(rawQ.toLowerCase());

  const [layer1Result, layer2Result, layer3Result] = await Promise.allSettled([
    sources.has('local') ? searchLayer1(safeQ, rawQ, limit) : Promise.resolve([]),
    sources.has('off') ? cachedOff(rawQ.toLowerCase()) : Promise.resolve([]),
    sources.has('usda') ? cachedUsda(rawQ.toLowerCase()) : Promise.resolve([]),
  ]);

  const layer1 = layer1Result.status === 'fulfilled' ? layer1Result.value : [];
  const layer2 = layer2Result.status === 'fulfilled' ? layer2Result.value : [];
  const layer3 = layer3Result.status === 'fulfilled' ? layer3Result.value : [];

  const combined = dedupeAndCombine(layer1, layer2, layer3, limit);

  return NextResponse.json(
    { layer1, layer2, layer3, combined },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}

interface SeedBody {
  food_name?: string;
  source?: string;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  nutrients?: Record<string, unknown> | null;
  external_id?: string | null;
}

/**
 * Seed L1 with an OFF/USDA result so future searches hit the canonical view
 * without an extra remote round-trip. Idempotent on (food_name, source,
 * external_id) via dedupe_key.
 */
export async function POST(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const body = (await request.json()) as SeedBody;

  if (!body.food_name || typeof body.food_name !== 'string') {
    return NextResponse.json({ error: 'food_name required' }, { status: 400 });
  }
  const foodName = body.food_name.trim();
  if (foodName.length === 0 || foodName.length > 200) {
    return NextResponse.json({ error: 'food_name must be 1-200 chars' }, { status: 400 });
  }
  const externalId =
    body.external_id != null ? String(body.external_id).slice(0, 100) : null;
  const source = body.source === 'off' || body.source === 'usda' ? body.source : 'manual';

  const dedupeKey = `seed:${source}:${externalId ?? 'noext'}:${foodName.toLowerCase()}`;

  await query(
    `INSERT INTO nutrition_food_entries
       (uuid, logged_at, day_local, meal_type, food_name, calories, protein_g, carbs_g, fat_g, nutrients, source, dedupe_key)
     VALUES ($1, NOW(), to_char(NOW(), 'YYYY-MM-DD'), 'other', $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [
      randomUUID(),
      foodName,
      body.calories ?? null,
      body.protein_g ?? null,
      body.carbs_g ?? null,
      body.fat_g ?? null,
      body.nutrients ? JSON.stringify(body.nutrients) : null,
      source,
      dedupeKey,
    ],
  );

  return NextResponse.json({ seeded: true });
}
