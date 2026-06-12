<!-- /autoplan target plan -->
# Plan: Nutrition meals composed of foods/ingredients

**Branch:** main (ship-to-main, single user) · **Author:** Lou · **Date:** 2026-06-13

## Problem

Meals in Rebirth are **flat aggregates**. `nutrition_week_meals` (the Standard Week
template) and `nutrition_logs` (what was eaten) store only `meal_name` + summed
`calories/protein/carbs/fat`. The ingredient composition is **not stored**: "Tofu
Protein Smoothie · 571 kcal" doesn't know it contains tofu, oats, banana, milk. So:

- Editing a meal ("add 40g oats to the smoothie") means hand-bumping the four total
  numbers, with no source of truth for what's in it.
- No food reuse: the same "oats" is re-keyed into every meal's mental math.
- We already retarget calories often (just went 2,250 → 2,550); without composition,
  every adjustment is manual arithmetic.

There IS partial infra: `nutrition_food_entries` (per-food rows: `food_name`, macros,
`nutrients` JSONB — imported from Fitbee) and `search_nutrition_foods` (trigram search
over it). But meals are **not composed of** these — no join exists.

## Goal

Make a meal a **recipe**: a named thing composed of `(food, quantity)` rows, whose
macros are the **derived sum** of its ingredients. Keep legacy flat meals working as
"quick-add" rows so nothing breaks.

## Scope

### MVP (this plan)
1. `foods` canonical-ingredient table (name + macros per reference unit), seeded from
   the existing `nutrition_food_entries` corpus.
2. `meal_ingredients` join: links a Standard Week meal (`nutrition_week_meals`) to
   foods with a quantity.
3. **Derived macros** for week meals: when a meal has ingredients, its macros are
   computed from them; when it has none (legacy), the stored aggregate is used.
4. Ingredient-editor UI on the Standard Week meals: open a meal, add/remove/scale
   ingredients, see macros recompute live.
5. Seed/migration so the existing template smoothie etc. can be "cracked open."

### Fast-follow (NOT this plan — defer to TODOS.md)
- Ingredient-level **daily logging** (`nutrition_logs` → `meal_ingredients`).
- Full MCP tool changes (`add_week_meal`/`log_nutrition_meal` accept ingredient lists;
  richer `search_nutrition_foods`).
- Per-food micro-nutrient surfacing from the `nutrients` JSONB.

## Current state (verified)

Tables (migration 002, 015, 021, 036):
- `nutrition_week_meals(uuid, day_of_week, meal_slot, meal_name, protein_g, carbs_g,
  fat_g, calories, quality_rating, sort_order, created_at)` — flat.
- `nutrition_logs(uuid, logged_at, meal_type, meal_name, calories, protein_g, carbs_g,
  fat_g, template_meal_id, status, external_ref, notes)` — flat.
- `nutrition_food_entries(uuid, logged_at, day_local, meal_type, food_name, calories,
  protein_g, carbs_g, fat_g, nutrients JSONB, source, import_batch_uuid, dedupe_key)`
  — per-food, Fitbee import lane, NOT linked to meals.
- `search_nutrition_foods` MCP tool → trigram search over `nutrition_food_entries.food_name`.

Sync layer (per the ab-visibility/migration-051 precedent) threads through ~6 places:
1. SQL migration (`src/db/migrations/0NN_*.sql`)
2. `src/db/local.ts` — TS types + Dexie `this.version(N)` bump + table registration
3. `src/lib/mutations-*.ts` — write helpers
4. `src/app/api/sync/push/route.ts` — INSERT + ON CONFLICT upsert
5. `src/app/api/sync/changes/route.ts` — pull SELECT
6. UI component(s)

## Proposed data model

```
foods
  uuid TEXT PK
  name TEXT NOT NULL
  brand TEXT NULL
  ref_unit TEXT NOT NULL DEFAULT 'serve'   -- 'g' | 'ml' | 'serve'
  ref_qty NUMERIC NOT NULL DEFAULT 1        -- macros are per ref_qty of ref_unit
  calories NUMERIC, protein_g NUMERIC, carbs_g NUMERIC, fat_g NUMERIC
  nutrients JSONB DEFAULT '{}'              -- carry-through from food_entries
  source TEXT DEFAULT 'manual'              -- 'fitbee-seed' | 'manual'
  archived_at TIMESTAMPTZ NULL
  created_at, updated_at

meal_ingredients
  uuid TEXT PK
  week_meal_uuid TEXT NOT NULL REFERENCES nutrition_week_meals(uuid) ON DELETE CASCADE
  food_uuid TEXT NOT NULL REFERENCES foods(uuid) ON DELETE RESTRICT
  qty NUMERIC NOT NULL                      -- in food.ref_unit
  sort_order INTEGER NOT NULL DEFAULT 0
  created_at
```

**Derived macros:** a `week_meal`'s effective macros =
`Σ ingredient.qty / food.ref_qty × food.{macro}` when `meal_ingredients` exist for it;
otherwise the stored `nutrition_week_meals` aggregate (legacy quick-add). Computed in a
shared helper used by both the API summary path and the UI, so server and client agree.

**Decision — compute-on-read vs stored rollup:** compute-on-read for the MVP (single
user, ≤7 days × ~7 meals × ~6 ingredients = trivial N). Re-evaluate only if a real perf
signal appears. Keeps one source of truth; no rollup-staleness class of bug.

## Seeding

One-shot: `INSERT INTO foods (...) SELECT DISTINCT ON (lower(food_name)) ... FROM
nutrition_food_entries` — collapse the Fitbee corpus to canonical foods (latest macro
values per name), `source='fitbee-seed'`, `ref_unit='serve'`, `ref_qty=1`. Idempotent
(guard on empty `foods`). Does NOT auto-decompose existing flat meals — that stays manual
(open a meal, add ingredients) so we never guess wrong about what was in a meal.

## UI (MVP)

On `src/app/nutrition/...` Standard Week editor: each meal row gets an "ingredients"
disclosure. Expand → list of `(food, qty)` lines + an "add food" picker (reuses the
`search_nutrition_foods` trigram search against `foods`). Macros badge on the meal
recomputes live from the ingredient list. Empty list → falls back to the flat
quick-add fields (legacy meals untouched until you add the first ingredient).

## Edge cases

- Meal with zero ingredients → legacy aggregate shown (no regression).
- Food referenced by a meal cannot be hard-deleted (`ON DELETE RESTRICT`) — archive
  instead (`archived_at`); archived foods hidden from the picker but still resolve in
  existing ingredient rows.
- Quantity 0 or negative → reject at mutation layer.
- `ref_qty` 0 → division guard (treat as 1, log).
- Seeding collision (same food_name, different macros across Fitbee imports) →
  `DISTINCT ON (lower(name)) ... ORDER BY ... logged_at DESC` keeps the most recent.
- Sync: `meal_ingredients` + `foods` are client-owned (like the ab-visibility column),
  so push uses plain upsert; pull SELECT must include the new tables/columns or they
  silently fail to round-trip (the exact bug class found in migration-051 review).

## Test plan (outline — eng phase fills this)

- Derived-macro helper: meal with N ingredients sums correctly; empty → aggregate;
  ref_qty scaling (per-100g food at qty 40 → 0.4×).
- Migration up: tables created, seed populates from food_entries, idempotent re-run.
- Sync round-trip: create meal + ingredients on client → push → pull on fresh client →
  identical.
- Editor: add/remove/scale ingredient → macros badge + day total update.
- Regression: a legacy flat meal with no ingredients renders unchanged.

## Rollout

Single user, ship-to-main. Migration 052 (051 was last). No feature flag needed.
Daily-log composition + MCP changes follow in a second PR.

---

# GSTACK REVIEW REPORT (autoplan — CEO skipped per request)

Voices: Eng (Claude) · Design (Claude) · DX (Claude) · Codex. Four independent reviews, no shared context.

## Consensus scorecard

| Dimension | Verdict |
|---|---|
| Core model (foods + meal_ingredients + derived macros) | SOUND |
| Compute-on-read vs rollup | CONFIRMED (compute-on-read; N is trivial) |
| Sync correctness | CRITICAL GAPS (all 4 voices) |
| Materialization → daily totals | CRITICAL (Codex) — the showstopper |
| Food corpus model | CRITICAL (DX + Codex) — plan forks a second corpus |
| Units / "add 40g oats" | CRITICAL (Design + Codex) — seed flattening breaks it |
| Legacy flat→composed UX | CRITICAL (Design + DX) — silent macro drop |
| Delete semantics | CRITICAL (Eng + Codex) — push wedge |

## Critical findings + resolutions (auto-decided unless flagged TASTE)

1. **Materialization gap [Codex, CRITICAL].** The Standard Week template is *materialized* into `nutrition_logs` (flat copies) by `mutations-nutrition.ts:220` + the `nutrition-template-fill` cron, and adherence/summary aggregate `nutrition_logs`, NOT week meals. So deriving week-meal macros on read does NOT reach daily totals. **Resolution (P1 completeness):** template-fill must compute effective macros from `meal_ingredients + foods` at insert time. Already-materialized `planned` logs are immutable snapshots (a food diary doesn't rewrite the past); editing ingredients affects future fills only. This is the difference between "the editor changes a display number" and "the editor actually moves your tracked 2,550."

2. **Food corpus fork [DX + Codex, CRITICAL].** Plan's "current state" was STALE: `search_nutrition_foods` reads the live `nutrition_food_canonical` VIEW (migration 021, 3-layer incl. OFF/USDA), not raw `nutrition_food_entries`. Seeding a frozen `foods` table forks a second corpus with no shared key to search results. **Resolution (P4 DRY + P1):** do NOT bulk-seed a frozen table. `foods` becomes a **promote-on-attach mint target** — search keeps using the canonical view; when a food is attached as an ingredient (or created manually), upsert into `foods` keyed by name+source, minting a stable `food_uuid` carrying real serving metadata from the source. `foods` holds only foods actually used in recipes. Resolves the units problem too (foods carry per_qty/per_unit from FoodResult.serving_size, gram-native where available).

3. **Sync infra incomplete [Eng + Codex, CRITICAL].** Tables alone don't sync. **Resolution (mechanical, adopt all):** migration adds CDC triggers (`record_change_uuid` AFTER INSERT/UPDATE/DELETE) + `updated_at` + update trigger on both tables; `foods` before `meal_ingredients` (FK order) in client `sync.ts` SYNCED_TABLES, server push payload+loops, and pull allowlist; Dexie bump **v26 → v27** (NOT aligned to migration number); pull SELECT arms with `Number()` coercion on every numeric (un-coerced NUMERIC returns string → `"571"+"114"="571114"`); `LocalFood`/`LocalWeekMealIngredient` types + mutation helpers.

4. **Delete wedge [Eng + Codex, CRITICAL].** A `_deleted` food hits `ON DELETE RESTRICT` → 500 → permanent push wedge. **Resolution (mechanical):** foods are archive-only; client `deleteFood` sets `archived_at`; server push translates `_deleted` food → `archived_at=NOW()`, never hard DELETE.

5. **Legacy flat→composed transition [Design + DX, CRITICAL — TASTE].** Every existing meal starts ingredient-less; adding the first ingredient flips the read rule and the trusted aggregate (e.g. 571 kcal) silently drops to just-the-new-ingredient (150). Three options: (A) remainder "ghost" ingredient holds the old total, decremented as you itemize; (B) explicit "Convert to recipe" toggle that clears the aggregate; (C) show both side-by-side until "mark complete." **→ SURFACED AT GATE.**

## Other adopted fixes (auto-decided)
- `week_meal_ingredients` parent made nullable + CHECK, so daily-log ingredients (fast-follow) reuse the table instead of forking [P2 boil-lakes].
- DB invariants in SQL not just mutation: `CHECK (qty > 0)`, `CHECK (per_qty > 0)`, `per_unit IN ('g','ml','serve')`, indexes on `(week_meal_uuid, sort_order)` and `(food_uuid)`, `UNIQUE (week_meal_uuid, food_uuid)` to block dup rows [P1].
- Rename `ref_unit/ref_qty/qty` → `per_unit/per_qty/amount` to match repo `_g` conventions; pin unit in column comment + MCP field desc [P5 explicit].
- Single-source derived-macros: Postgres view/CTE for server + MCP reads, TS helper `src/lib/nutrition/derive-macros.ts` for Dexie UI, grep-guard test that the formula appears in one place (healthkit-drift precedent) [P5].
- `resolveFood({ food_uuid | food_name })` mirroring `resolveExercise` [P4]; add `uuid` to search projection.
- Error contracts: `FOOD_NOT_FOUND` (hint: search_nutrition_foods), `INVALID_QUANTITY`, loud legacy-supersede warning [repo `hint` bar].
- Add `052_nutrition_ingredients.down.sql` (repo has `.down.sql` precedent) [P1].
- Server-side push validation: clamp per_unit whitelist, finite/positive numerics, JSON.stringify nutrients [P1].
- UI fully specced: reuse `AddFoodSheet` state model (loading/empty/no-match/manual-create); persistent live macro header; per-ingredient contribution rows; gram-native qty `inputMode="decimal"`; inline trash to remove; optimistic local recompute, persist on save.

## Decision Audit Trail

| # | Phase | Decision | Class | Principle | Rationale |
|---|-------|----------|-------|-----------|-----------|
| 1 | Eng | template-fill computes effective macros at insert; past logs immutable | Mechanical | P1 | Else edits never reach daily totals |
| 2 | DX | promote-on-attach foods, not frozen seed | Taste→adopt | P4/P1 | Avoids 2nd corpus; one search surface |
| 3 | Eng | full sync threading + CDC + coercion + Dexie v27 | Mechanical | P1/P5 | Silent no-sync otherwise |
| 4 | Eng | foods archive-only; push translates delete | Mechanical | P1 | Prevents push wedge |
| 5 | Design | legacy transition | TASTE | — | Surfaced at gate |
| 6 | Eng | nullable polymorphic parent on join | Mechanical | P2 | Door open for log ingredients |
| 7 | All | SQL invariants + indexes + unique | Mechanical | P1 | Integrity at DB layer |
| 8 | DX | per_unit/per_qty/amount naming | Mechanical | P5 | Repo convention match |
| 9 | All | single-source derive (view + helper + grep test) | Mechanical | P5 | Server/UI/MCP agree |
| 10 | Eng | down migration | Mechanical | P1 | Repo precedent |

## Revised effort (honest)
Original MVP estimate (~8h) was wrong — it assumed a frozen seed + display-only editor. With the materialization fix + promote-on-attach + full sync threading, the corrected MVP is **~15–22h CC**: migration+triggers (2h), sync threading (3h), derive view+helper+tests (3h), template-fill change (2h), foods promote/resolve + search uuid (3h), ingredient editor UI (5h), error contracts + validation (2h). Still one coherent build; pipeline can execute it.

## GATE DECISIONS (Lou, 2026-06-13)
1. **Legacy flat→composed transition = EXPLICIT "Convert to recipe".** A meal keeps its stored aggregate macros until Lou taps "Convert to recipe"; only then do macros derive from ingredients (aggregate cleared/superseded). No silent number-drop. Until converted, a meal stays flat quick-add. This means `meal_ingredients` rows only exist on meals that have been explicitly converted — derive helper uses ingredients iff converted, else stored aggregate. (Add a `is_recipe BOOLEAN DEFAULT false` flag on nutrition_week_meals, or treat "has ≥1 ingredient" as converted — implementer's call, but the conversion must be a deliberate user action, not implicit on first add.)
2. **Scope = FULL corrected MVP** including the template-fill materialization fix (ingredient edits reach daily totals) and promote-on-attach foods. Proceed to /pipeline. Ship to main.
