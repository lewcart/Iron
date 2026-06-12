/**
 * Tests for src/lib/nutrition/derive-macros.ts
 *
 * Covers the same logical cases as the migration 052 view-formula tests in
 * src/db/migrations/052_nutrition_ingredients.test.ts so the TS helper and
 * the SQL view are verified to agree.
 *
 * Additionally includes a grep-guard test that:
 *   1. The scaling expression (`amount / per_qty` multiply) appears in exactly
 *      one source location inside src/lib/nutrition/ (scaleContribution fn).
 *   2. No other file in src/ (outside the SQL view and this helper) re-derives
 *      the formula independently.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

import {
  deriveMealMacros,
  type DeriveFood,
  type DeriveIngredient,
  type DeriveMeal,
} from './derive-macros';

// ─── Flat meal (is_recipe=false) ─────────────────────────────────────────────

describe('deriveMealMacros — flat meal (is_recipe=false)', () => {
  it('returns stored aggregate macros unchanged', () => {
    const meal: DeriveMeal = {
      is_recipe: false,
      calories: 571,
      protein_g: 45,
      carbs_g: 60,
      fat_g: 12,
    };
    const result = deriveMealMacros(meal, []);
    expect(result.calories).toBe(571);
    expect(result.protein_g).toBe(45);
    expect(result.carbs_g).toBe(60);
    expect(result.fat_g).toBe(12);
  });

  it('ignores ingredients when is_recipe=false (no silent macro drop)', () => {
    const food: DeriveFood = {
      per_qty: 100,
      calories: 400,
      protein_g: 10,
      carbs_g: 70,
      fat_g: 8,
    };
    const meal: DeriveMeal = {
      is_recipe: false,
      calories: 571,
      protein_g: 45,
      carbs_g: 60,
      fat_g: 12,
    };
    const ingredients: DeriveIngredient[] = [{ amount: 150, food }];
    const result = deriveMealMacros(meal, ingredients);
    expect(result.calories).toBe(571);
    expect(result.protein_g).toBe(45);
  });

  it('returns null macros when stored macros are null', () => {
    const meal: DeriveMeal = {
      is_recipe: false,
      calories: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
    };
    const result = deriveMealMacros(meal, []);
    expect(result.calories).toBeNull();
    expect(result.protein_g).toBeNull();
    expect(result.carbs_g).toBeNull();
    expect(result.fat_g).toBeNull();
  });
});

// ─── Recipe meal (is_recipe=true) with ingredients ───────────────────────────

describe('deriveMealMacros — recipe meal (is_recipe=true)', () => {
  it('two ingredients: sums and scales correctly', () => {
    // Food A: oats — macros per 100g
    const oats: DeriveFood = {
      per_qty: 100,
      calories: 389,
      protein_g: 17,
      carbs_g: 66,
      fat_g: 7,
    };
    // Food B: protein powder — macros per 1 serve
    const proteinPowder: DeriveFood = {
      per_qty: 1,
      calories: 120,
      protein_g: 25,
      carbs_g: 3,
      fat_g: 2,
    };

    const meal: DeriveMeal = {
      is_recipe: true,
      // stored macros are irrelevant when is_recipe=true
      calories: 999,
      protein_g: 999,
      carbs_g: 999,
      fat_g: 999,
    };
    const ingredients: DeriveIngredient[] = [
      { amount: 80, food: oats },         // 80g oats → 0.8×
      { amount: 2, food: proteinPowder }, // 2 serves → 2×
    ];

    const result = deriveMealMacros(meal, ingredients);

    // oats: 80/100 = 0.8 × macros
    const oatsCal = 0.8 * 389;  // 311.2
    const oatsPro = 0.8 * 17;   // 13.6
    const oatsCarb = 0.8 * 66;  // 52.8
    const oatsFat = 0.8 * 7;    // 5.6

    // protein powder: 2/1 = 2 × macros
    const ppCal = 2 * 120;  // 240
    const ppPro = 2 * 25;   // 50
    const ppCarb = 2 * 3;   // 6
    const ppFat = 2 * 2;    // 4

    expect(result.calories).toBeCloseTo(oatsCal + ppCal, 5);  // 551.2
    expect(result.protein_g).toBeCloseTo(oatsPro + ppPro, 5); // 63.6
    expect(result.carbs_g).toBeCloseTo(oatsCarb + ppCarb, 5); // 58.8
    expect(result.fat_g).toBeCloseTo(oatsFat + ppFat, 5);     // 9.6
  });

  it('per-100g food at 40g quantity → 0.4× scaling', () => {
    const food: DeriveFood = {
      per_qty: 100,
      calories: 500,
      protein_g: 20,
      carbs_g: 60,
      fat_g: 15,
    };
    const meal: DeriveMeal = {
      is_recipe: true,
      calories: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
    };
    const result = deriveMealMacros(meal, [{ amount: 40, food }]);
    expect(result.calories).toBeCloseTo(0.4 * 500, 5);   // 200
    expect(result.protein_g).toBeCloseTo(0.4 * 20, 5);   // 8
    expect(result.carbs_g).toBeCloseTo(0.4 * 60, 5);     // 24
    expect(result.fat_g).toBeCloseTo(0.4 * 15, 5);       // 6
  });

  it('empty recipe returns null macros (mirrors SQL SUM over empty set)', () => {
    const meal: DeriveMeal = {
      is_recipe: true,
      calories: 400,
      protein_g: 30,
      carbs_g: 40,
      fat_g: 10,
    };
    const result = deriveMealMacros(meal, []);
    expect(result.calories).toBeNull();
    expect(result.protein_g).toBeNull();
    expect(result.carbs_g).toBeNull();
    expect(result.fat_g).toBeNull();
  });

  it('serve-unit food at qty=1 → full macros returned', () => {
    const food: DeriveFood = {
      per_qty: 1,
      calories: 250,
      protein_g: 12,
      carbs_g: 30,
      fat_g: 8,
    };
    const meal: DeriveMeal = {
      is_recipe: true,
      calories: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
    };
    const result = deriveMealMacros(meal, [{ amount: 1, food }]);
    expect(result.calories).toBeCloseTo(250, 5);
    expect(result.protein_g).toBeCloseTo(12, 5);
    expect(result.carbs_g).toBeCloseTo(30, 5);
    expect(result.fat_g).toBeCloseTo(8, 5);
  });
});

// ─── per_qty guard ────────────────────────────────────────────────────────────

describe('deriveMealMacros — per_qty guard', () => {
  it('ingredient with per_qty=null contributes nothing (no divide-by-zero)', () => {
    const badFood: DeriveFood = {
      per_qty: null, // defensive guard fires
      calories: 500,
      protein_g: 20,
      carbs_g: 60,
      fat_g: 15,
    };
    const goodFood: DeriveFood = {
      per_qty: 100,
      calories: 200,
      protein_g: 10,
      carbs_g: 30,
      fat_g: 5,
    };
    const meal: DeriveMeal = {
      is_recipe: true,
      calories: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
    };
    const result = deriveMealMacros(meal, [
      { amount: 50, food: badFood },  // skipped — per_qty guard
      { amount: 100, food: goodFood }, // 100/100 = 1× → full macros
    ]);
    // Only goodFood contributes (1× its macros)
    expect(result.calories).toBeCloseTo(200, 5);
    expect(result.protein_g).toBeCloseTo(10, 5);
  });

  it('ingredient with per_qty=0 contributes nothing', () => {
    const food: DeriveFood = {
      per_qty: 0 as unknown as null, // simulate bypass of DB CHECK
      calories: 500,
      protein_g: 20,
      carbs_g: 60,
      fat_g: 15,
    };
    const meal: DeriveMeal = {
      is_recipe: true,
      calories: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
    };
    const result = deriveMealMacros(meal, [{ amount: 100, food }]);
    // All skipped → null (same as empty recipe)
    expect(result.calories).toBeNull();
  });

  it('ingredient with null food macro contributes null for that macro only', () => {
    const food: DeriveFood = {
      per_qty: 100,
      calories: 300, // known
      protein_g: null, // unknown
      carbs_g: 50,
      fat_g: 10,
    };
    const meal: DeriveMeal = {
      is_recipe: true,
      calories: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
    };
    const result = deriveMealMacros(meal, [{ amount: 100, food }]);
    expect(result.calories).toBeCloseTo(300, 5); // 100/100 × 300
    expect(result.protein_g).toBeNull();          // no contribution
    expect(result.carbs_g).toBeCloseTo(50, 5);
    expect(result.fat_g).toBeCloseTo(10, 5);
  });
});

// ─── Grep-guard: scaling formula in exactly ONE source location ───────────────

// Helper: collect files matching an extension filter, recursively, skipping
// node_modules / .next directories.
function collectFiles(
  dir: string,
  extFilter: (f: string) => boolean,
  excludeDirs: string[] = ['node_modules', '.next', '.git'],
): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (excludeDirs.includes(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectFiles(full, extFilter, excludeDirs));
    } else if (extFilter(entry)) {
      results.push(full);
    }
  }
  return results;
}

describe('derive-macros grep-guard', () => {
  const nutritionDir = resolve(__dirname, '.');

  it('scaling expression (amount / per_qty multiply) appears in exactly one non-test TS file in src/lib/nutrition/', () => {
    // Collect all .ts files in this directory, excluding test files
    const tsFiles = readdirSync(nutritionDir)
      .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map(f => join(nutritionDir, f));

    // The scaling formula: `amount / per_qty` — the exact expression in scaleContribution.
    const scalingPattern = /\(amount\s*\/\s*per_qty\)/;

    const matchingFiles = tsFiles.filter(f => {
      const content = readFileSync(f, 'utf-8');
      return scalingPattern.test(content);
    });

    expect(
      matchingFiles.length,
      `Expected exactly 1 non-test TS file in src/lib/nutrition/ to contain the ` +
      `scaling expression (amount / per_qty), but found ${matchingFiles.length}: ` +
      matchingFiles.map(f => f.replace(nutritionDir + '/', '')).join(', '),
    ).toBe(1);

    // And it must be derive-macros.ts
    expect(matchingFiles[0]).toMatch(/derive-macros\.ts$/);
  });

  it('SQL view in migration 052 is the only SQL derive site (NULLIF guard pattern)', () => {
    const migrationsDir = resolve(__dirname, '../../db/migrations');
    const sqlFiles = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .map(f => join(migrationsDir, f));

    // The SQL scaling formula uses NULLIF(f.per_qty, 0)
    const sqlPattern = /NULLIF\(f\.per_qty,\s*0\)/;

    const matchingSqlFiles = sqlFiles.filter(f => {
      const content = readFileSync(f, 'utf-8');
      return sqlPattern.test(content);
    });

    expect(
      matchingSqlFiles.length,
      `Expected exactly 1 SQL migration to contain NULLIF(f.per_qty, 0), ` +
      `found ${matchingSqlFiles.length}: ` +
      matchingSqlFiles.map(f => f.split('/').pop()).join(', '),
    ).toBe(1);

    expect(matchingSqlFiles[0]).toMatch(/052_nutrition_ingredients\.sql$/);
  });

  it('no other src/ TS file outside src/lib/nutrition/ re-derives the meal macro formula', () => {
    const srcDir = resolve(__dirname, '../..');
    // Collect all .ts/.tsx files outside src/lib/nutrition/, excluding test files
    const allTsFiles = collectFiles(srcDir, f => /\.(ts|tsx)$/.test(f))
      .filter(f => !f.includes('/nutrition/') && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));

    // Tight pattern: dividing amount by per_qty — only scaleContribution should match
    const rederivePattern = /amount\s*\/\s*(NULLIF\s*\()?per_qty/;

    const rederivingFiles = allTsFiles.filter(f => {
      const content = readFileSync(f, 'utf-8');
      return rederivePattern.test(content);
    });

    expect(
      rederivingFiles.length,
      `Found ${rederivingFiles.length} TS file(s) outside src/lib/nutrition/ ` +
      `that re-derive the meal macro formula (amount / per_qty). ` +
      `Move the logic to deriveMealMacros() instead: ` +
      rederivingFiles.map(f => f.replace(srcDir + '/', 'src/')).join(', '),
    ).toBe(0);
  });
});
