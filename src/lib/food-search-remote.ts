/**
 * Remote food-database adapters: Open Food Facts (no key) and USDA
 * FoodData Central (free with API key).
 *
 * Both return our normalised FoodResult shape so the search route can
 * concatenate them with Layer 1 (local) results without per-source branching.
 *
 * Errors and timeouts return [] — never throw — so a slow/dead remote can't
 * tank the search response.
 */

import type { FoodResult } from '@/app/api/nutrition/foods/route';

const OFF_TIMEOUT_MS = 1500;
const USDA_TIMEOUT_MS = 1500;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timed = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    });
    const out = await Promise.race([p, timed]);
    return out as T | null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Open Food Facts ────────────────────────────────────────────────────────

interface OFFProduct {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  brands?: string;
  serving_size?: string;
  nutriments?: {
    'energy-kcal_100g'?: number;
    'energy-kcal_serving'?: number;
    'proteins_100g'?: number;
    'proteins_serving'?: number;
    'carbohydrates_100g'?: number;
    'carbohydrates_serving'?: number;
    'fat_100g'?: number;
    'fat_serving'?: number;
  };
}

interface OFFResponse {
  products?: OFFProduct[];
}

export async function searchOpenFoodFacts(query: string, limit = 15): Promise<FoodResult[]> {
  const url =
    `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}` +
    `&search_simple=1&action=process&json=1&page_size=${limit}`;

  const fetched = await withTimeout(
    fetch(url, { headers: { 'User-Agent': 'Rebirth/1.0 (personal-tracker)' } }).then((r) =>
      r.ok ? (r.json() as Promise<OFFResponse>) : null,
    ),
    OFF_TIMEOUT_MS,
  );

  const products = fetched?.products ?? [];
  const results: FoodResult[] = [];

  for (const p of products) {
    const name = p.product_name_en || p.product_name;
    if (!name) continue;

    const n = p.nutriments ?? {};
    // Prefer per-serving when available, fall back to per-100g.
    const cal = n['energy-kcal_serving'] ?? n['energy-kcal_100g'];
    const pro = n['proteins_serving'] ?? n['proteins_100g'];
    const carb = n['carbohydrates_serving'] ?? n['carbohydrates_100g'];
    const fat = n['fat_serving'] ?? n['fat_100g'];

    // Skip products with no useful macro data.
    if (cal == null && pro == null && carb == null && fat == null) continue;

    const display = p.brands ? `${name} (${p.brands.split(',')[0].trim()})` : name;

    results.push({
      source: 'off',
      food_name: display,
      serving_size: parseServingSize(p.serving_size),
      calories: cal ?? null,
      protein_g: pro ?? null,
      carbs_g: carb ?? null,
      fat_g: fat ?? null,
      nutrients: null,
      external_id: p.code ?? null,
      meta: null,
    });
  }

  return results;
}

function parseServingSize(s: string | undefined): { qty: number; unit: string } | null {
  if (!s) return null;
  const m = s.match(/^([\d.]+)\s*([a-zA-Z]+)/);
  if (!m) return null;
  const qty = parseFloat(m[1]);
  if (!Number.isFinite(qty)) return null;
  return { qty, unit: m[2].toLowerCase() };
}

// ─── USDA FoodData Central ──────────────────────────────────────────────────

interface USDAFood {
  fdcId: number;
  description: string;
  brandName?: string;
  brandOwner?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: Array<{
    nutrientId?: number;
    nutrientName?: string;
    nutrientNumber?: string;
    value?: number;
  }>;
}

interface USDAResponse {
  foods?: USDAFood[];
}

const USDA_NUTRIENT_NUMBERS = {
  ENERGY_KCAL: '208',
  PROTEIN: '203',
  CARBS: '205',
  FAT: '204',
} as const;

export async function searchUsdaFdc(query: string, limit = 15): Promise<FoodResult[]> {
  const apiKey = process.env.USDA_FDC_API_KEY;
  if (!apiKey) return [];

  const url =
    `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}` +
    `&pageSize=${limit}&api_key=${encodeURIComponent(apiKey)}`;

  const fetched = await withTimeout(
    fetch(url).then((r) => (r.ok ? (r.json() as Promise<USDAResponse>) : null)),
    USDA_TIMEOUT_MS,
  );

  const foods = fetched?.foods ?? [];
  const results: FoodResult[] = [];

  for (const f of foods) {
    const nutrients = new Map<string, number>();
    for (const n of f.foodNutrients ?? []) {
      const num = (n.nutrientNumber ?? '').toString();
      if (num && n.value != null) nutrients.set(num, n.value);
    }

    const cal = nutrients.get(USDA_NUTRIENT_NUMBERS.ENERGY_KCAL) ?? null;
    const pro = nutrients.get(USDA_NUTRIENT_NUMBERS.PROTEIN) ?? null;
    const carb = nutrients.get(USDA_NUTRIENT_NUMBERS.CARBS) ?? null;
    const fat = nutrients.get(USDA_NUTRIENT_NUMBERS.FAT) ?? null;

    if (cal == null && pro == null && carb == null && fat == null) continue;

    const display = f.brandName ? `${f.description} (${f.brandName})` : f.description;

    results.push({
      source: 'usda',
      food_name: display,
      serving_size:
        f.servingSize != null && f.servingSizeUnit
          ? { qty: f.servingSize, unit: f.servingSizeUnit }
          : null,
      calories: cal,
      protein_g: pro,
      carbs_g: carb,
      fat_g: fat,
      nutrients: null,
      external_id: String(f.fdcId),
      meta: null,
    });
  }

  return results;
}
