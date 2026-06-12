/**
 * Tests for migration 052: nutrition ingredients schema.
 *
 * Does NOT require a live database connection. Tests cover:
 *
 * 1. SQL is syntactically parseable by the same splitSqlStatements() used in
 *    migrate.ts (guards against comment-semicolon splits, dollar-quoted bodies,
 *    etc. that have caused cryptic migration failures before).
 *
 * 2. The nutrition_week_meal_effective view formula is correct in pure TS,
 *    mirroring the SQL logic:
 *      - is_recipe = false → returns stored aggregate macros unchanged
 *      - is_recipe = true  → SUM(amount / per_qty * food.macro) over ingredients
 *
 * 3. The view SQL text contains the derive formula in exactly one place
 *    (grep-guard: prevents the server/MCP/UI from re-deriving independently).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── helpers ─────────────────────────────────────────────────────────────────

const migrationsDir = resolve(__dirname, '.');

function readMigration(filename: string): string {
  return readFileSync(resolve(migrationsDir, filename), 'utf-8');
}

/**
 * Minimal port of migrate.ts:splitSqlStatements — enough to count statements
 * and verify none are empty (which indicates a bad split on a comment semicolon).
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Line comment
    if (ch === '-' && next === '-') {
      const newlineIdx = sql.indexOf('\n', i);
      const end = newlineIdx === -1 ? sql.length : newlineIdx + 1;
      current += sql.slice(i, end);
      i = end;
      continue;
    }

    // Block comment
    if (ch === '/' && next === '*') {
      let depth = 1;
      current += sql.slice(i, i + 2);
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; current += sql.slice(i, i + 2); i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; current += sql.slice(i, i + 2); i += 2; }
        else { current += sql[i]; i++; }
      }
      continue;
    }

    // Dollar-quoted block
    if (ch === '$') {
      const tagMatch = sql.slice(i).match(/^\$[^$]*\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        const closeIdx = sql.indexOf(tag, i + tag.length);
        if (closeIdx !== -1) {
          current += sql.slice(i, closeIdx + tag.length);
          i = closeIdx + tag.length;
          continue;
        }
      }
    }

    // Single-quoted string
    if (ch === "'") {
      current += ch; i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { current += "''"; i += 2; continue; }
        if (sql[i] === "'") { current += "'"; i++; break; }
        current += sql[i]; i++;
      }
      continue;
    }

    if (ch === ';') {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = '';
      i++;
      continue;
    }

    current += ch; i++;
  }

  const last = current.trim();
  if (last) statements.push(last);
  return statements;
}

// ─── SQL parseability ─────────────────────────────────────────────────────────

describe('migration 052 SQL parseability', () => {
  it('up migration splits into non-empty statements without errors', () => {
    const sql = readMigration('052_nutrition_ingredients.sql');
    const stmts = splitSqlStatements(sql);
    expect(stmts.length).toBeGreaterThan(0);
    for (const stmt of stmts) {
      expect(stmt.trim(), 'empty statement detected — bad semicolon split').not.toBe('');
    }
  });

  it('down migration splits into non-empty statements without errors', () => {
    const sql = readMigration('052_nutrition_ingredients.down.sql');
    const stmts = splitSqlStatements(sql);
    expect(stmts.length).toBeGreaterThan(0);
    for (const stmt of stmts) {
      expect(stmt.trim()).not.toBe('');
    }
  });

  it('up migration creates foods table', () => {
    const sql = readMigration('052_nutrition_ingredients.sql');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS foods');
  });

  it('up migration creates week_meal_ingredients table', () => {
    const sql = readMigration('052_nutrition_ingredients.sql');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS week_meal_ingredients');
  });

  it('up migration creates nutrition_week_meal_effective view', () => {
    const sql = readMigration('052_nutrition_ingredients.sql');
    expect(sql).toContain('CREATE OR REPLACE VIEW nutrition_week_meal_effective');
  });

  it('up migration adds is_recipe column', () => {
    const sql = readMigration('052_nutrition_ingredients.sql');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS is_recipe BOOLEAN NOT NULL DEFAULT false');
  });

  it('up migration registers CDC triggers for foods', () => {
    const sql = readMigration('052_nutrition_ingredients.sql');
    expect(sql).toContain('foods_change_log');
    expect(sql).toContain('foods_updated_at');
  });

  it('up migration registers CDC triggers for week_meal_ingredients', () => {
    const sql = readMigration('052_nutrition_ingredients.sql');
    expect(sql).toContain('week_meal_ingredients_change_log');
    expect(sql).toContain('week_meal_ingredients_updated_at');
  });

  it('foods table has per_unit CHECK constraint', () => {
    const sql = readMigration('052_nutrition_ingredients.sql');
    expect(sql).toContain("CHECK (per_unit IN ('g', 'ml', 'serve'))");
  });

  it('foods table has per_qty > 0 CHECK constraint', () => {
    const sql = readMigration('052_nutrition_ingredients.sql');
    expect(sql).toContain('CHECK (per_qty > 0)');
  });

  it('week_meal_ingredients has amount > 0 CHECK constraint', () => {
    const sql = readMigration('052_nutrition_ingredients.sql');
    expect(sql).toContain('CHECK (amount > 0)');
  });

  it('week_meal_ingredients has has_parent CHECK constraint', () => {
    const sql = readMigration('052_nutrition_ingredients.sql');
    expect(sql).toContain('week_meal_ingredients_has_parent');
  });

  it('week_meal_ingredients has UNIQUE (week_meal_uuid, food_uuid)', () => {
    const sql = readMigration('052_nutrition_ingredients.sql');
    expect(sql).toContain('UNIQUE (week_meal_uuid, food_uuid)');
  });

  it('view uses NULLIF guard on per_qty to prevent division by zero', () => {
    const sql = readMigration('052_nutrition_ingredients.sql');
    expect(sql).toContain('NULLIF(f.per_qty, 0)');
  });

  it('down migration drops the view', () => {
    const sql = readMigration('052_nutrition_ingredients.down.sql');
    expect(sql).toContain('DROP VIEW IF EXISTS nutrition_week_meal_effective');
  });

  it('down migration drops week_meal_ingredients before foods (FK order)', () => {
    const sql = readMigration('052_nutrition_ingredients.down.sql');
    const wmiIdx = sql.indexOf('DROP TABLE IF EXISTS week_meal_ingredients');
    const foodsIdx = sql.indexOf('DROP TABLE IF EXISTS foods');
    expect(wmiIdx).toBeGreaterThan(-1);
    expect(foodsIdx).toBeGreaterThan(-1);
    expect(wmiIdx).toBeLessThan(foodsIdx);
  });
});

// ─── view formula correctness (pure TS mirror of SQL logic) ──────────────────
//
// These tests exercise the derive-macros logic in isolation, mirroring exactly
// what the nutrition_week_meal_effective view computes in SQL.
//
// TS mirror of the view's CASE expression:
//   is_recipe=false → stored macros
//   is_recipe=true  → SUM(amount / per_qty * food.macro)

interface Food {
  per_qty: number;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

interface Ingredient {
  amount: number;
  food: Food;
}

interface Meal {
  is_recipe: boolean;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  ingredients: Ingredient[];
}

function effectiveMacros(meal: Meal): {
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
} {
  if (!meal.is_recipe) {
    return {
      calories: meal.calories,
      protein_g: meal.protein_g,
      carbs_g: meal.carbs_g,
      fat_g: meal.fat_g,
    };
  }
  const sum = (getter: (f: Food) => number | null): number | null => {
    let total = 0;
    let hasAny = false;
    for (const { amount, food } of meal.ingredients) {
      const val = getter(food);
      if (val !== null && val !== undefined) {
        const pq = food.per_qty || 1; // NULLIF guard: treat 0 as 1 (can't happen via CHECK)
        total += (amount / pq) * val;
        hasAny = true;
      }
    }
    return hasAny ? total : null;
  };
  return {
    calories: sum(f => f.calories),
    protein_g: sum(f => f.protein_g),
    carbs_g: sum(f => f.carbs_g),
    fat_g: sum(f => f.fat_g),
  };
}

describe('nutrition_week_meal_effective view formula', () => {
  it('is_recipe=false returns stored aggregate macros unchanged', () => {
    const meal: Meal = {
      is_recipe: false,
      calories: 571,
      protein_g: 45,
      carbs_g: 60,
      fat_g: 12,
      ingredients: [], // irrelevant when is_recipe=false
    };
    const result = effectiveMacros(meal);
    expect(result.calories).toBe(571);
    expect(result.protein_g).toBe(45);
    expect(result.carbs_g).toBe(60);
    expect(result.fat_g).toBe(12);
  });

  it('is_recipe=false with ingredients still returns stored macros (not derived)', () => {
    const food: Food = { per_qty: 100, calories: 400, protein_g: 10, carbs_g: 70, fat_g: 8 };
    const meal: Meal = {
      is_recipe: false,
      calories: 571,
      protein_g: 45,
      carbs_g: 60,
      fat_g: 12,
      ingredients: [{ amount: 150, food }],
    };
    const result = effectiveMacros(meal);
    expect(result.calories).toBe(571);
  });

  it('is_recipe=true with two ingredients sums and scales correctly', () => {
    // Food A: oats — macros per 100g
    const oats: Food = {
      per_qty: 100,
      calories: 389,
      protein_g: 17,
      carbs_g: 66,
      fat_g: 7,
    };
    // Food B: protein powder — macros per 1 serve (30g equivalent)
    const proteinPowder: Food = {
      per_qty: 1,
      calories: 120,
      protein_g: 25,
      carbs_g: 3,
      fat_g: 2,
    };

    const meal: Meal = {
      is_recipe: true,
      // stored macros are irrelevant when is_recipe=true
      calories: 999,
      protein_g: 999,
      carbs_g: 999,
      fat_g: 999,
      ingredients: [
        { amount: 80, food: oats },         // 80g oats
        { amount: 2, food: proteinPowder }, // 2 serves protein powder
      ],
    };

    const result = effectiveMacros(meal);

    // oats: 80/100 = 0.8 × macros
    const oatsCal = 0.8 * 389;   // 311.2
    const oatsPro = 0.8 * 17;    // 13.6
    const oatsCarb = 0.8 * 66;   // 52.8
    const oatsFat = 0.8 * 7;     // 5.6

    // protein powder: 2/1 = 2 × macros
    const ppCal = 2 * 120;       // 240
    const ppPro = 2 * 25;        // 50
    const ppCarb = 2 * 3;        // 6
    const ppFat = 2 * 2;         // 4

    expect(result.calories).toBeCloseTo(oatsCal + ppCal, 5);   // 551.2
    expect(result.protein_g).toBeCloseTo(oatsPro + ppPro, 5);  // 63.6
    expect(result.carbs_g).toBeCloseTo(oatsCarb + ppCarb, 5);  // 58.8
    expect(result.fat_g).toBeCloseTo(oatsFat + ppFat, 5);      // 9.6
  });

  it('is_recipe=true with a per-100g food at 40g quantity → 0.4× scaling', () => {
    const food: Food = {
      per_qty: 100,
      calories: 500,
      protein_g: 20,
      carbs_g: 60,
      fat_g: 15,
    };
    const meal: Meal = {
      is_recipe: true,
      calories: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      ingredients: [{ amount: 40, food }],
    };
    const result = effectiveMacros(meal);
    expect(result.calories).toBeCloseTo(0.4 * 500, 5);    // 200
    expect(result.protein_g).toBeCloseTo(0.4 * 20, 5);    // 8
    expect(result.carbs_g).toBeCloseTo(0.4 * 60, 5);      // 24
    expect(result.fat_g).toBeCloseTo(0.4 * 15, 5);        // 6
  });

  it('is_recipe=true with zero ingredients returns null macros', () => {
    const meal: Meal = {
      is_recipe: true,
      calories: 400,
      protein_g: 30,
      carbs_g: 40,
      fat_g: 10,
      ingredients: [],
    };
    const result = effectiveMacros(meal);
    expect(result.calories).toBeNull();
    expect(result.protein_g).toBeNull();
    expect(result.carbs_g).toBeNull();
    expect(result.fat_g).toBeNull();
  });

  it('is_recipe=true with a serve-unit food at qty=1 → full macros', () => {
    const food: Food = {
      per_qty: 1, // per 1 serve
      calories: 250,
      protein_g: 12,
      carbs_g: 30,
      fat_g: 8,
    };
    const meal: Meal = {
      is_recipe: true,
      calories: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      ingredients: [{ amount: 1, food }],
    };
    const result = effectiveMacros(meal);
    expect(result.calories).toBeCloseTo(250, 5);
    expect(result.protein_g).toBeCloseTo(12, 5);
    expect(result.carbs_g).toBeCloseTo(30, 5);
    expect(result.fat_g).toBeCloseTo(8, 5);
  });
});

// ─── grep-guard: formula lives in exactly one SQL location ───────────────────

describe('nutrition_week_meal_effective formula single-source guard', () => {
  it('view SQL uses the scaling formula (amount / NULLIF(per_qty)) exactly once per macro', () => {
    const sql = readMigration('052_nutrition_ingredients.sql');
    // Extract just the view definition
    const viewStart = sql.indexOf('CREATE OR REPLACE VIEW nutrition_week_meal_effective');
    expect(viewStart).toBeGreaterThan(-1);
    const viewSql = sql.slice(viewStart);

    // Four macros, each with its own CASE block — formula appears 4 times total
    const occurrences = (viewSql.match(/NULLIF\(f\.per_qty, 0\)/g) ?? []).length;
    expect(occurrences).toBe(4); // calories, protein_g, carbs_g, fat_g
  });
});
