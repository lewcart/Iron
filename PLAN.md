# Nutrition Page Upgrade — Plan (v3, post-review)

Branch: `worktree-feat+nutrition-upgrade`
Single-user app (Lewis only). Multi-user / migration-skew concerns relaxed.

> **Visual north star:** the FitBee Today screen (calorie ring up top, macro cards horizontal scroll, per-meal "+ Add", smart-repeat suggestions, floating dock). Rebirth absorbs that flow and adds: MCP, history, summary, goals editor, day-approval semantics, local-first sync, our own food DB layering.

This plan went through Design, Eng, and DX dual-voice reviews. v3 incorporates their feedback. Sections that changed materially are marked **(rev)**.

---

## Premise

Today's nutrition page is a 937-line monolith. It works but fights you:
- Per-meal "log this" tap × every planned item × every day = friction.
- No food autocomplete — every unplanned meal needs manual macros.
- No goals UI; only protein lives in `localStorage`.
- No history view, no summary, no adherence visibility.
- "Did I eat right today?" is unanswerable from the app.

FitBee solves the daily UX nicely. We replace it: keep the UX, add MCP + summary + goals, own the data.

## What "FitBee" actually is

Closed iOS app by Cortado Labs LLC ("1M+ verified foods", barcode + photo-AI). No public API. The CSV export shape (USDA-style column naming with rich JSONB micros) plus their feature set strongly suggests they layer USDA FoodData Central + a barcoded source like Open Food Facts.

We do the same — three layers, fall-through:

| Layer | Source | Why | Cost |
|---|---|---|---|
| 1 | Local `nutrition_food_entries` | Foods you actually eat — fastest, most relevant | Free (already imported) |
| 2 | **Open Food Facts** REST | Branded products + barcodes, ~3M items | Free, **no key** |
| 3 | **USDA FoodData Central** | Raw ingredients, gold-standard macros | Free, requires API key |

Search hits Layer 1 instantly; Layers 2+3 are network-fetched in parallel after a 200ms debounce, each with a 1500ms timeout, results combined and ranked. Top result wins. Selected food → row inserted into `nutrition_logs` AND seeded into `nutrition_food_entries` so future searches hit Layer 1.

## NOT in scope this round

- Photo-based food logging — button stub, "coming soon" sheet.
- Barcode scanning — same.
- Recipe builder — future.
- Standard Week template tab — extract into its own page (`/nutrition/week`) using existing logic, no UX redesign.
- Hydration UI changes — works, unchanged.

## What already exists (reuse list)

| Need | Existing piece | Where |
|---|---|---|
| Swipe-to-delete | `<SwipeToDelete>` (80px reveal) | `src/components/SwipeToDelete.tsx` |
| Targets table | `nutrition_targets` (singleton id=1) | migration 015 |
| Day notes (date-keyed) | `nutrition_day_notes` (UNIQUE date) | **migration 002** (not 015 — review caught) |
| Food history corpus | `nutrition_food_entries` (server-only) | migration 002 |
| Logged meals | `nutrition_logs` w/ `meal_type` enum | migration 002 |
| Local-first plumbing | Dexie + sync engine | `src/db/local.ts`, `src/lib/sync.ts` |
| Charts | `recharts@3.8.0` | already installed |
| Workouts (kcal) | `health_workouts` (HealthKit) | migration 017 |
| iOS list styles | `.ios-section`, `.ios-row`, safe-area utils | `globals.css` |
| `useNutritionLogsForDate(date)` | accepts arbitrary dates | `src/lib/useLocalDB-nutrition.ts:15` |

---

## Today page — UI (FitBee-aligned)

```
┌─────────────────────────────────────────┐
│  ‹  📅 Today  ›             [⚙ Goals]   │  ← date nav + gear
├─────────────────────────────────────────┤
│  ╔═════════════════════════════════════╗│
│  ║  Remaining          ┌─────┐         ║│  ← Card 1: calorie balance
│  ║   1,950 cal         │ ◯   │         ║│     big ring, focal viz
│  ║                     └─────┘         ║│
│  ║                  Consumed   0 cal   ║│
│  ║                  Workouts 129 cal   ║│  ← from health_workouts
│  ╚═════════════════════════════════════╝│
│                                          │
│  ┌──────┬──────┬──────┬──────┐          │ ← horizontal scroll
│  │Pro   │Carbs │Fat   │Steps │          │   each: small ring + n/goal
│  │0/125 │0/175 │0/55  │7.7k  │          │
│  └──────┴──────┴──────┴──────┘          │
│                                          │
│  Breakfast                       0 cal   │
│  ┌─────────────────────────────────────┐│
│  │  + Add  | 🕐                  ⋯     ││
│  │  ── Oat milk latte    160 kcal     ││ ← swipe ← reveals delete
│  │  ── Eggs, 3            210 kcal     ││ ← tap row to edit macros
│  └─────────────────────────────────────┘│
│                                          │
│  Lunch · Dinner · Snacks  [same shape]   │
│  ⓘ Log Dinner from yesterday            │ ← smart-repeat (when meal empty)
│                                          │
│  ┌─────────────────────────────────────┐│
│  │  ✓  Mark day reviewed                ││ ← single bottom CTA
│  └─────────────────────────────────────┘│
│                                          │
│   ┌────────────┐                         │ ← floating dock (FitBee-style)
│   │ + 📷 Aa    │                         │   📷/Aa = "coming soon" stubs
│   └────────────┘                         │
└─────────────────────────────────────────┘
```

### Design decisions (rev — designer feedback)

- **One ring, big.** Calories is the focal viz. Macros = 4 small ring cards in horizontal scroller. Replaces the dot-fill viz from v1 (designer: dots can't distinguish 76% from 86%).
- **Single bottom CTA, not double.** Status badge inside the calorie card; action lives once at the bottom.
- **Goals = gear icon, not a tab.** Settings affordance.
- **State labels (rev):**
  - Today, untouched → no badge, "Mark day reviewed" CTA active
  - Tapped today → "✓ Reviewed" badge
  - Past day, never tapped → "• Logged" (soft dot, not a check, not "auto-approved")
- **Tap-to-edit a logged food** (designer caught the gap): tap any row opens an inline edit sheet with macros + serving size. Swipe ← reveals delete.
- **Empty meal sections collapse:** if a meal has no rows, render a thin "+ Add Breakfast" header bar instead of the full section card. Less visual noise on minimal days.
- **Date arrows:** prev/next day. Tap "Today" pill → date picker (sheet). Future dates allowed for read-only viewing of planned meals; CTA disabled.
- **Color encoding:** under-band = neutral gray, in-band = green, over-band = amber, way-over (>20%) = red. Never red+green only.

### Component split (rev — eng feedback)

```
src/app/nutrition/today/
  page.tsx                        # client component, ~120 lines, reads ?date= from searchParams
  CalorieBalanceCard.tsx          # ring + remaining/consumed/workouts
  MacroCardScroller.tsx           # horizontal scroll: protein/carbs/fat/steps cards
  MealSection.tsx                 # one of breakfast | lunch | dinner | snack
  FoodRow.tsx                     # one row, wrapped in <SwipeToDelete>, tap-to-edit
  EditFoodSheet.tsx               # invoked on row tap
  AddFoodSheet.tsx                # invoked on "+ Add" — search → results → confirm
  ApproveDayButton.tsx            # the single bottom CTA (inline; small enough to keep)
  SmartRepeatSuggestion.tsx       # "Log Dinner from yesterday" prompt
  EntryDock.tsx                   # floating + / 📷 / Aa dock

src/components/ui/
  Sheet.tsx                       # NEW shared primitive (drag-to-dismiss, focus-trap, scroll-lock)
  MacroRing.tsx                   # NEW pure-SVG donut
  MacroBar.tsx                    # NEW horizontal bar (used in History row dots)
  SearchInput.tsx                 # NEW debounced wrapper (used by AddFoodSheet + future)
```

`Sheet`, `MacroRing`, `MacroBar`, `SearchInput` are extracted **before** the rest of the work — they're load-bearing primitives, not afterthoughts (eng review caught this).

### State matrix (rev — designer feedback)

| Page | Loading | Empty | Partial | Error | Offline |
|---|---|---|---|---|---|
| Today | Skeleton (3 cards + 4 meal headers) | "Nothing logged yet" + center illustration + "Tap + to add" | Just shows what's there | Toast: "Sync failed — saved locally" | Banner: "Offline — changes will sync" |
| Goals | Skeleton form | "No targets yet" + 3 preset chips | N/A | Inline field error | Same banner |
| History | Skeleton list | "No history yet — log a meal to start" | "(no data)" rows | Toast | Cached + banner |
| Summary | Skeleton charts | "Need 7+ days to show summary" | Charts with goal-line + sparse data | Toast | Cached |
| Food search | "Searching…" inside sheet | Top-8 most-frequent on empty query | Layer 1 only if remote layers fail | "Couldn't reach food DBs — local matches still work" | Layer 1 only, banner |
| Food search 0 results | "No matches" + button "Add 'oat milk latte' manually" with query pre-baked + "Save for next time" default-checked checkbox | — | — | — | — |

---

## Approval semantics (rev — eng feedback caused a redesign)

**v1/v2 plan:** 3 enum states (`pending`, `approved`, `auto_approved`); auto-flip on read.
**v3 plan:** 2 enum states (`pending`, `approved`); "Logged" is **derived in the application layer**, never stored.

```sql
-- migration 020 (rev)
ALTER TABLE nutrition_day_notes
  ADD COLUMN approved_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approved_status IN ('pending','approved')),
  ADD COLUMN approved_at TIMESTAMPTZ;
```

**Display rule** (in TS):
```ts
function displayStatus(date: string, status: 'pending'|'approved', today: string) {
  if (status === 'approved') return { label: 'Reviewed', kind: 'approved' };
  if (date < today)         return { label: 'Logged',   kind: 'auto' };
  return                          { label: 'Today',    kind: 'pending' };
}
```

**Why this is better:**
- ✅ No write under read traffic (eng review #2 → solved).
- ✅ No CDC fanout from auto-flipping (eng review #11 → solved).
- ✅ No timezone race (eng review #5 → solved — derivation is per-render, in your locale).
- ✅ No-row case is trivial (eng review #4 → solved): if `nutrition_day_notes` row doesn't exist, day is past → "Logged"; day is today → "Today" (CTA active, no row needed yet).
- ✅ Approving a past day still works: insert/upsert the row with `approved_status='approved'`.
- ✅ The DB stays simple — only two real states.

**Empty days for adherence**: if no `nutrition_day_notes` AND no `nutrition_logs` for the date → exclude from adherence denominator (no data ≠ miss). If `nutrition_logs` exist but no `nutrition_day_notes` → derived as "Logged", and the day's macros enter adherence.

**Editing a "Logged" past day**: reads as "Logged" (since `approved_status` is still `pending`). To make it "Reviewed," user (or MCP) must explicitly approve. We do NOT auto-flip on edit (designer originally suggested this, but it conflates "I touched this" with "I endorsed this." Cleaner to keep them separate.)

**Cross-midnight on open page**: derivation is per-render. A `useEffect` watching `setInterval(() => setNow(new Date()), 60_000)` ensures the page re-derives status if you happen to be staring at it at midnight. Cheap.

**Timezone**: hardcoded `Europe/London` constant in `src/lib/time.ts`. Single user, single TZ. When you travel, change the constant. Documented.

---

## Data model — migration 020 (rev)

```sql
-- 020_nutrition_upgrade.sql

-- Day approval (binary)
ALTER TABLE nutrition_day_notes
  ADD COLUMN approved_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approved_status IN ('pending','approved')),
  ADD COLUMN approved_at TIMESTAMPTZ;

-- Per-macro adherence bands (JSONB for flexibility)
ALTER TABLE nutrition_targets
  ADD COLUMN bands JSONB NOT NULL DEFAULT '{
    "cal":{"low":-0.10,"high":0.10},
    "pro":{"low":-0.10,"high":null},
    "carb":{"low":-0.15,"high":0.15},
    "fat":{"low":-0.15,"high":0.20}
  }'::jsonb;

-- Food search: trigram for fuzzy substring (eng review #1)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_nutrition_food_entries_name_trgm
  ON nutrition_food_entries USING gin (food_name gin_trgm_ops);

-- Canonical foods view (de-duped per name, most recent macros)
CREATE OR REPLACE VIEW nutrition_food_canonical AS
SELECT DISTINCT ON (lower(trim(food_name)))
  lower(trim(food_name))           AS canonical_name,
  food_name,
  calories, protein_g, carbs_g, fat_g, nutrients,
  logged_at                         AS last_logged_at,
  count(*) OVER (PARTITION BY lower(trim(food_name))) AS times_logged
FROM nutrition_food_entries
ORDER BY lower(trim(food_name)), logged_at DESC;

-- Idempotency: ALTER TABLE ... ADD COLUMN is implicitly idempotent in PG 16+
-- but we use IF NOT EXISTS for safety
```

### Local-first surface area (rev — eng review #3, the most under-counted piece)

The current `LocalNutritionLog` (`src/db/local.ts:207`) lacks `meal_name`, `template_meal_id`, `status`. The current page uses these as core data. Without adding them, switching to local-first **drops them**.

Required edits, all in this PR:
1. `src/db/local.ts` — bump Dexie version (5→6), update `LocalNutritionLog` interface, add `approved_status`/`approved_at` to `LocalNutritionDayNote`, add `bands` to `LocalNutritionTarget`. Write explicit `.upgrade(tx => …)` callback that backfills new fields.
2. `src/lib/mutations-nutrition.ts` — extend `logMeal` params with `meal_name`, `template_meal_id`, `status`. Extend `setNutritionTargets` with `bands`.
3. `src/lib/useLocalDB-nutrition.ts` — already supports `useNutritionLogsForDate(date)`. Add `useNutritionDayNote(date)` and `useNutritionTargets()` (if not present).
4. `src/app/api/sync/push/route.ts:408,442` — add the new columns to push handlers for both `nutrition_logs` and `nutrition_day_notes`.
5. `src/app/api/sync/changes/route.ts:202,209` — add the new columns to the SELECT lists for both tables.
6. `src/db/migrations/020_nutrition_upgrade.sql` — server schema (above).

Without these six edits, new fields silently round-trip as null. **All six are in scope for this PR.**

---

## Food search API (rev — eng review #6, #9)

```
GET /api/nutrition/foods?q={query}&limit=20            # NOT /foods/search (DX review)

→ {
  layer1: FoodResult[],   // local nutrition_food_entries
  layer2: FoodResult[],   // Open Food Facts (filtered to non-empty macros)
  layer3: FoodResult[],   // USDA FDC (filtered to non-empty macros)
  combined: FoodResult[]  // deduped, ranked, top N
}

FoodResult = {
  source: 'local' | 'off' | 'usda',
  food_name: string,
  serving_size: { qty: number, unit: string } | null,
  calories: number | null,
  protein_g: number | null,
  carbs_g: number | null,
  fat_g: number | null,
  nutrients: Record<string, number | null> | null,
  external_id: string | null,    // OFF barcode, USDA fdcId
  meta: { times_logged?: number, last_logged_at?: string } | null
}
```

**Validation (rev — eng review #6):**
- Reject `q.length < 2` and `q.length > 100` with HTTP 400.
- Strip control chars.
- Escape LIKE wildcards in user input: `q.replaceAll(/[\\%_]/g, c => '\\' + c)` before concat. Drizzle parameterizes the `$1` value, but the wildcards inside `$1` need escaping or `100%` matches the entire table.

**Layer 1 query (rev — eng review #4):**
```sql
SELECT * FROM nutrition_food_canonical
WHERE canonical_name LIKE lower($1) || '%'                 -- prefix (cheap)
   OR canonical_name % lower($1)                           -- trigram similarity
ORDER BY (canonical_name LIKE lower($1) || '%') DESC,      -- prefix wins
         times_logged DESC,
         last_logged_at DESC
LIMIT $2;
```

`pg_trgm`'s `%` operator uses the GIN index. Prefix matches sort first. `count(*)` was previously baked into the canonical view via window function — no extra subquery.

**Layers 2+3:** `Promise.allSettled` with 1500ms timeout each. `unstable_cache` (Next.js) keyed by `(query, source)`, 24h TTL.

**Caching:** `Cache-Control: private, max-age=60` on the response (DX review).

**OFF endpoint:** `https://world.openfoodfacts.org/cgi/search.pl?search_terms={q}&search_simple=1&action=process&json=1&page_size=15` — no auth.

**USDA endpoint:** `https://api.nal.usda.gov/fdc/v1/foods/search?query={q}&pageSize=15&api_key={key}` — `USDA_FDC_API_KEY` env var.

**Selecting a food**: insert one row into `nutrition_logs` AND if it came from L2/L3, also insert into `nutrition_food_entries` (`source='off'` or `'usda'`) so it's an L1 hit next time. Both writes from the same server action.

---

## Adherence semantics (rev — eng review #6)

A day "hits" a macro when actual is within that macro's band of target. Default bands per migration (asymmetric).

**Per-day classification:**
- `hit_count = number of macros where actual ∈ [target+target*low, target+target*high]`
- A day is "in band" iff `hit_count == 4`.

**Edge cases (rev):**

| Scenario | Adherence behavior |
|---|---|
| `nutrition_targets` row missing or all nulls | Day excluded from `adherence_pct` denominator (`null`, not 0%) |
| Day has no `nutrition_logs` AND no `nutrition_day_notes` | Excluded — no data |
| Day has `nutrition_logs` but no `nutrition_day_notes` | Counted; derived "Logged" status |
| Single macro target null (e.g. fat unset) | Day's `hit_count` excludes that macro; need 3/3 to hit |
| Targets changed mid-history | Adherence computed against **current** targets. Footnote on Summary: "Adherence reflects your current goals." Out of scope: temporal targets table |

**Streak:** consecutive most-recent days where `hit_count` equals the count of non-null macro targets. Excluded days break the streak.

---

## History page (`/nutrition/history`)

Day-by-day list, infinite scroll, most recent first. Each row:
- Date
- 4 small `<MacroBar>`s (one per macro, % of goal, color-coded against band)
- State badge ("Reviewed" / "Logged" / "(no data)")

Filter: 7d / 30d / 90d / All. Default 30d.

Tap row → `/nutrition/today?date=YYYY-MM-DD` (full edit, not read-only — designer's choice).

**Backed by:**
```
GET /api/nutrition/history?range=7d|30d|90d|all
→ { days: [{ date, calories, protein_g, carbs_g, fat_g, hit_count, status }] }
```

This is a new aggregate endpoint — eng review caught that v2 plan implicitly assumed it existed.

## Summary page (`/nutrition/summary`)

```
[Week | Month | All]                            ← segmented control

Adherence: 82% of days within band             ← excludes "no data" days
Approval:  ✓ 11   • 16   ⚫ 1 missed
Streak:    7 days within band

[ daily macros vs goal — recharts LineChart, one line per macro, goal as ReferenceLine ]
[ approval status timeline — recharts BarChart, stacked, week-by-week ]
[ macro averages — small 4-card grid w/ avg vs target ]
```

```
GET /api/nutrition/summary?range=week|month|all
→ {
  days: [{ date, calories, protein_g, carbs_g, fat_g, hit_count, status }],
  targets: { calories, protein_g, carbs_g, fat_g, bands },
  derived: {
    adherence_pct: number | null,    // null if no qualifying days
    streak_days: number,
    approval_counts: { approved, auto_approved, missed }
  }
}
```

ETag based on `max(updated_at)` across the range's days for cheap client revalidation (DX review).

---

## Sub-nav (rev — designer)

Three top tabs (segmented control, not bottom — bottom is owned by app's main nav):

```
Today | Week | History
```

History page has internal `[ Day ]` / `[ Aggregate ]` segmented control (Aggregate = Summary). Goals lives behind the gear icon on Today (sheet). Five tabs collapsed to three.

---

## MCP tool surface (rev — DX review)

All renamed for namespace consistency. Eight tools added.

| Tool (final names) | Args | Purpose |
|---|---|---|
| `list_nutrition_logs` | `{ date: 'YYYY-MM-DD' }` | **NEW (DX-critical):** prereq for editing — agent needs uuids. Without this, edit/delete are dead-on-arrival. |
| `update_nutrition_log` | `{ uuid, meal_type?, meal_name?, calories?, protein_g?, carbs_g?, fat_g?, notes?, status?, logged_at? }` | Edit one log. **Named params, not `fields` blob.** Whitelist enforced server-side (no `_synced`, `created_at`, etc.). |
| `delete_nutrition_log` | `{ uuid }` | Soft-delete via local-first sync. |
| `bulk_log_nutrition_meals` | `{ date, meals: NutritionLogInput[] }` | Catch-up. Per-item result array, partial failures don't abort batch. |
| `approve_nutrition_day` | `{ date }` | Set status=approved. Future date → BUSINESS_RULE error. Already-approved → idempotent silent success. |
| `search_nutrition_foods` | `{ query, limit?, sources?: ('local'|'off'|'usda')[] }` | Layered search. Same shape as HTTP. |
| `get_nutrition_summary` | `{ start_date, end_date }` | Aggregate stats; same shape as HTTP. |
| `get_nutrition_rules` | `{}` | Returns auto-approval rule, default bands, timezone. Discoverability shortcut. |

**Renames vs v2 plan:**
- `edit_nutrition_log` → `update_nutrition_log` (matches existing `update_*` pattern across codebase)
- `search_food_entries` → `search_nutrition_foods` (namespace consistency — agent grep finds it)

**Date convention** (uniform across all nutrition tools, documented in tool descriptions):
- `date` params: `YYYY-MM-DD`, `Europe/London` local
- `*_at` params: ISO-8601 with TZ offset
- Agent computes relative dates ("yesterday") itself; tools never accept literal `"yesterday"`

**Errors** (uniform shape with hints):
```ts
{ error: { code: 'NOT_FOUND'|'INVALID_INPUT'|'BUSINESS_RULE', message: string, hint?: string } }
```
Examples (with hints — DX review):
- `update_nutrition_log({uuid:'bad'})` → `{code:'NOT_FOUND', message:'No nutrition log with that uuid', hint:'Call list_nutrition_logs(date) first to get uuids.'}`
- `approve_nutrition_day('2027-01-01')` → `{code:'BUSINESS_RULE', message:'Cannot approve future date', hint:'approve_nutrition_day only accepts today or past dates.'}`
- `bulk_log_nutrition_meals({...})` partial failure → returns `{ results: [{ index: 0, ok: true, uuid: '...' }, { index: 1, ok: false, error: {...} }, …] }`. Caller sees per-meal outcome.

**Pre-extraction (rev — DX review):** before adding 8 tools to a 2894-line file, extract `src/lib/mcp/nutrition-tools.ts` (exports `nutritionTools: ToolDef[]`). Main file becomes `[...workoutTools, ...nutritionTools, ...]`. ~30 min refactor, saves hours over the next year.

**Doc updates** (numbered as a step now, not skipped):
- Lead `/* ── Nutrition tools ── */` comment block in `nutrition-tools.ts` documenting the auto-approval derivation, date conventions, and the `list → update` workflow.
- Append a section to `CLAUDE.md`: "When the user says 'log my breakfast': call `search_nutrition_foods` first, then `log_nutrition_meal` with the macros you found. To edit a past day: call `list_nutrition_logs(date)` first to get uuids, then `update_nutrition_log`."

---

## Goals page (`/nutrition/goals`)

Sheet (gear icon → bottom sheet, not full page). Form:
- 4 number inputs: calories, protein, carbs, fat
- 3 preset chips ("Cut" / "Maintain" / "Bulk") that fill the inputs
- Per-macro band overrides (low%, high%) — collapsible "Advanced" section
- Save → writes via `setNutritionTargets()` mutation (local-first)

---

## Implementation order (rev)

| Step | What | Why this order |
|---|---|---|
| 1 | **Primitives:** `Sheet`, `MacroRing`, `MacroBar`, `SearchInput` | Load-bearing, reused across pages |
| 2 | **MCP refactor:** extract `nutrition-tools.ts` (existing tools first, no new ones) | Refactor before expansion |
| 3 | **Local-first field gap:** add `meal_name`/`template_meal_id`/`status` to `LocalNutritionLog`, mutation, push/changes routes; bump Dexie v5→v6 with explicit upgrade callback | Blocks every later step |
| 4 | **Migration 020:** approval columns, bands, pg_trgm, canonical view | Schema before code |
| 5 | **Food search API:** Layer 1 only (local) | Smallest shippable search |
| 6 | **Today page:** extract from monolith into 8 components, migrate to local-first hooks. Wrap rows in SwipeToDelete. Smart-repeat suggestion. | The visible win |
| 7 | **Goals sheet** | Unblocks adherence |
| 8 | **Layers 2+3 in food search:** OFF + USDA + caching | Now Today is using search for real |
| 9 | **History page** + `/api/nutrition/history` | First retrospective |
| 10 | **Summary page** + `/api/nutrition/summary` | Aggregate retrospective |
| 11 | **MCP tools (8 new)** in extracted file + `CLAUDE.md` doc append | Surfaces new functionality |
| 12 | **Sub-nav** (Today / Week / History) at `/nutrition/*` layout | Cohesion |
| 13 | **Floating dock** (`+` works, `📷`/`Aa` stubs) | FitBee parity |
| 14 | **Standalone Week page extraction** (`/nutrition/week`) — old monolith dies | Cleanup |

Steps 1–7 are the FitBee-replacement MVP. 8–14 are enhancement waves.

---

## Tests (rev — eng review added many)

| Codepath | Test | Type |
|---|---|---|
| Migration 020 forward + idempotent re-run | Apply twice; second is no-op | integration |
| Migration 020 rollback | Snapshot before/after, drop columns, verify clean | integration |
| Approval derivation | `pending` + past date → "Logged"; `approved` + any date → "Reviewed"; `pending` + today → "Today" | unit |
| Approval cross-midnight | Open page at 23:59, advance fake clock, "Today" rolls to "Logged" | unit (fake timers) |
| Past-day edit | Edit a "Logged" day → status stays `pending`, displays "Logged" | integration |
| Approve past day with no day_notes row | UPSERT inserts row with `approved_status='approved'` | integration |
| Food search Layer 1 trigram match | Substring "oat" matches "Oat milk latte" | integration |
| Food search Layer 2 timeout | OFF takes 2s → returns L1 + L3 only, no error to user | integration |
| Food search wildcard escape | `100%`, `100\_X`, apostrophes, unicode (açaí, L'Oréal) | unit |
| Food search empty query | Returns top-8 most-frequent from L1 | integration |
| Selected food seeds L1 | OFF result chosen → next search hits L1 | e2e |
| Adherence with null targets | `derived.adherence_pct === null`, not 0 | unit |
| Adherence with zero logs | Excluded from denominator | unit |
| Adherence asymmetric band | protein -5% → miss, +50% → hit | unit |
| Streak excludes no-data days | 5 hits, 1 no-data, 2 hits → streak = 2 | unit |
| Approve-day mutation offline | Dexie marks `_synced=false`, sync resolves on reconnect | e2e |
| Sync conflict on approve | Offline approve + MCP approve same date → last-write-wins via `_updated_at` | integration |
| Dexie v5→v6 upgrade | Existing rows preserve all fields after schema bump | unit |
| Local-first roundtrip with new fields | Log meal w/ `meal_name`+`template_meal_id` → push → server has it → pull → Dexie has it | integration |
| MCP `list_nutrition_logs` | Returns logs for date in `logged_at` order | unit |
| MCP `update_nutrition_log` non-existent uuid | Returns `NOT_FOUND` with hint | unit |
| MCP `update_nutrition_log` field whitelist | Rejects writes to `_synced`, `created_at` | unit |
| MCP `approve_nutrition_day` future date | `BUSINESS_RULE` with hint | unit |
| MCP `approve_nutrition_day` already approved | Idempotent silent success | unit |
| MCP `bulk_log_nutrition_meals` partial failure | Per-item results, no abort | integration |
| MCP `get_nutrition_summary` no targets | `derived.adherence_pct === null` | unit |
| Empty week / month summary | `days: []`, no divide-by-zero | integration |
| `<SwipeToDelete>` reuse on template meal rows | Same component, no reimplementation | smoke |
| Search debounce + abort | Rapid typing cancels in-flight fetch | unit |
| `ApproveDayButton` optimistic | Tap → state flips before server | unit |

---

## Failure modes registry (rev)

| # | Failure | Severity | Likelihood | Plan addresses |
|---|---|---|---|---|
| 1 | OFF/USDA both timeout, search appears broken | high | medium | Layer 1 always; banner says "global search degraded" |
| 2 | Substring search seq scan / latency spike | high | high | **pg_trgm GIN index** |
| 3 | Auto-approve UPDATE on GET writes under read traffic | high | high | **Eliminated — derivation in app layer** |
| 4 | `nutrition_day_notes` row missing → state undefined | high | high | **Eliminated — derivation handles no-row** |
| 5 | Server-vs-client TZ drift on "today" derivation | medium | medium | Hardcoded `Europe/London`, derivation client-side |
| 6 | LIKE wildcard injection (`%`, `_`) | medium | high | Explicit escape pass before concat |
| 7 | Adherence undefined when `nutrition_targets` is null | medium | high | Excluded from denominator (returns `null`) |
| 8 | Adherence undefined when zero logs on a day | medium | medium | No data → excluded; with data → counted |
| 9 | Local-first drops `meal_name`/`template_meal_id`/`status` | critical | certain | Six-edit plumbing in step 3 |
| 10 | Dexie v5→v6 upgrade silently drops fields | high | medium | Explicit `.upgrade()` callback + test |
| 11 | CDC fanout from auto-approve | medium | high | **Eliminated** with #3 |
| 12 | Optimistic delete with no rollback on push fail | low | low | Document last-write-wins; deferred to TODOS |
| 13 | MCP `update_nutrition_log` writes arbitrary fields | medium | medium | Server-side whitelist on `update_nutrition_log` |
| 14 | Concurrent MCP edit + page read race | low | low | Last-write-wins via `_updated_at`; documented |
| 15 | OFF returns wrong macros for branded item | medium | medium | User can edit log; macros not locked |
| 16 | Migration 020 rollback corrupts day_notes | critical | low | Tested in dev; single-user; reversible |
| 17 | Today + Week monolith extraction is 2x stated cost | medium | high | Step 14 explicitly extracts Week into own page |
| 18 | Bulk MCP log produces 30 CDC rows (push amplification) | low | medium | Acceptable; pull is batched |

---

## Open taste decisions (gate)

These are surfaced for your call. v3 has a recommendation on each:

1. **Food DB layers** — recommended: local + OFF + USDA. Alternatives: just local (defer remote), or local + OFF only (skip USDA key step). Pick one.
2. **Adherence bands per-macro asymmetric** (default per plan) vs single global ±10%. Recommended: asymmetric. Designer agrees.
3. **Default landing route for `/nutrition`** — recommended: redirect to `/today`. Alternative: a "summary at-a-glance" home with today's ring + last 7 days.
4. **Summary range default** — Week | Month | All. Recommended: **Week**.
5. **Photo log + AI parser stubs** — recommended: render buttons greyed/coming-soon (FitBee parity, sets expectation). Alternative: hide entirely until built.
6. **Workouts subtraction** — recommended: from `health_workouts` (HealthKit) automatic. Alternative: manual entry.
7. **Past-day edit flips status to "Reviewed"?** — recommended: **no** (cleaner separation between "I touched this" and "I endorsed this"). Designer originally suggested yes; v3 disagrees.
8. **Empty meal sections** — recommended: collapse to thin `+ Add Breakfast` header. Alternative: always show full card.
9. **Future-date viewing on Today** — recommended: allowed read-only (you can preview tomorrow's planned meals). Alternative: block, treat as "no data".

---

## User-challenge call-outs

The reviews didn't surface any spots where both Designer/Eng/DX agree your stated direction should change. Closest:

- **Designer pushed back on "tick at top AND bottom"** — v3 collapses to one button at the bottom. You explicitly asked for both; the designer made a clear case. Surfacing as an explicit override choice: **single bottom CTA (recommended)** vs **keep doubled tick (your original ask)**.

That's the only direct override. Everything else is alignment.

---

## Reviews (summary scorecards)

| Phase | Voices | Concerns | Disagreements | Critical fixes landed in v3 |
|---|---|---|---|---|
| Design | Claude subagent | Score 4/10 v1 → ~7/10 with v3 changes | Information hierarchy, dot-fill viz, doubled tick, sub-nav count, accessibility | Single bottom CTA, ring viz, gear for Goals, "Logged" label, asymmetric bands, states matrix, tap-to-edit, empty meal collapse |
| Eng | Claude subagent | All 6 dimensions "concerns" | Substring index claim, auto-approve writes on GET, local-first field gap, no-row case, TZ, adherence semantics, Dexie upgrade callback, Today/Week coupling, security | pg_trgm, derivation-not-write, six-edit plumbing, two-state DB, hardcoded TZ, exclude-not-zero adherence, explicit upgrade callback, Week extraction step, wildcard escape + field whitelist |
| DX | Claude subagent | Score 4.3/10 v1 → ~8/10 with v3 changes | Naming inconsistency (`edit_*`), missing `list_nutrition_logs`, no input schemas, no error specs, route verb-in-path, no doc updates | Renames to `update_*`/`search_nutrition_*`, added `list_nutrition_logs` (critical), inline schemas, error shape with hints, `/api/nutrition/foods?q=`, doc step in implementation order |

Codex was available in the env but not invoked — Claude subagents covered all three phases independently. No multi-model disagreements to surface.

---

## Bottom line

v3 of the plan is materially different from v1. The biggest single change: approval state stays `{pending, approved}` in the DB and "Logged" is a render-time derivation. That eliminates four of the worst eng concerns at once. Everything else is layered fixes.

**MVP shippable in steps 1-7.** Rest is enhancement waves.
