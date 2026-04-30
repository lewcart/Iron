import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/db';
import { requireApiKey } from '@/lib/api-auth';

/**
 * Layer 1 food search — hits the local nutrition_food_canonical view (deduped
 * Fitbee imports + foods seeded from previous OFF/USDA selections). Returns
 * top-N matches ranked by prefix-match-first, then frequency, then recency.
 *
 * Layers 2 (Open Food Facts) and 3 (USDA FoodData Central) will fall through
 * here in step 8.
 */

export interface FoodResult {
  source: 'local' | 'off' | 'usda';
  food_name: string;
  serving_size: { qty: number; unit: string } | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  nutrients: Record<string, unknown> | null;
  external_id: string | null;
  meta: { times_logged?: number; last_logged_at?: string } | null;
}

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

/**
 * Escape LIKE wildcards in user input. `%` and `_` are special in LIKE
 * patterns; `\` is the default escape character. Without this, "100%" would
 * match every row in the table. Drizzle parameterizes `$1` (preventing SQL
 * injection) but does NOT interpret wildcards inside the value.
 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

export async function GET(request: NextRequest) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const rawQ = searchParams.get('q') ?? '';
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 1), 50);

  const q = rawQ.trim();
  if (q.length < 2) {
    return NextResponse.json(
      { error: 'q must be at least 2 characters' },
      { status: 400 },
    );
  }
  if (q.length > 100) {
    return NextResponse.json(
      { error: 'q must be at most 100 characters' },
      { status: 400 },
    );
  }

  const safeQ = escapeLike(q.toLowerCase());

  // Combined ranking query:
  //   - prefix matches (`canonical_name LIKE 'foo%'`) win regardless of frequency
  //   - then trigram similarity matches (uses GIN index from migration 020)
  //   - within each group: frequency × recency
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
        OR canonical_name % $2
     ORDER BY is_prefix_match DESC, times_logged DESC, last_logged_at DESC
     LIMIT $3`,
    [safeQ, q.toLowerCase(), limit],
  );

  const layer1: FoodResult[] = rows.map((r) => ({
    source: 'local',
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

  return NextResponse.json(
    {
      layer1,
      layer2: [] as FoodResult[],
      layer3: [] as FoodResult[],
      combined: layer1,
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=60',
      },
    },
  );
}
