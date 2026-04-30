# Changelog

All notable changes to Rebirth are documented here.

## [0.2.0] - 2026-04-30

### Added
- **FitBee-style Today page at `/nutrition/today`.** Calorie ring with remaining/consumed/workouts split, horizontal-scroll macro cards (protein/carbs/fat/steps), four meal sections (breakfast/lunch/dinner/snack) with collapsing-when-empty behavior, swipe-to-delete + tap-to-edit on each food row, smart-repeat suggestion ("Log Dinner from yesterday"), and a single bottom-anchored "Mark day reviewed" CTA. Floating dock with `+` (works), camera and text buttons (coming soon stubs).
- **Three-layer food search.** Type a food name in the Add sheet and it searches your own logged history first (instant), then Open Food Facts (free public DB, no key, ~3M branded products), then USDA FoodData Central (free with API key, ~2M foods including raw ingredients). Selecting a result from the public DBs seeds it into your local history so the next search is instant. Graceful degradation: if a remote DB times out or returns empty, your local history still works.
- **Goals editor (`/nutrition/goals`).** Gear icon on Today opens a sheet with four macro inputs, three preset chips (Cut / Maintain / Bulk), and a collapsible advanced section for per-macro adherence bands. Bands are asymmetric by default — protein under-shoot misses but over-shoot is fine, calories over is the harder fail.
- **History view (`/nutrition/history`).** Day-by-day list with macro adherence bars, badge ("Reviewed" / "Logged" / "no data"), filter chip (7d / 30d / 90d / all). Tap a day to open it in the Today view for full editing.
- **Summary view (`/nutrition/summary`).** Week / month / all segmented control. Adherence percent (days within band), current streak, approval counts, daily macros line chart with goal as reference line, macro averages grid.
- **Day approval semantics.** Today shows "Today" badge until you tap the CTA, then "Reviewed". Past days that were never reviewed display as "Logged" automatically — no nag, no scolding. The label is derived in the app layer; the database only stores `pending` or `approved`, eliminating writes-under-read and CDC fanout.
- **Eight new MCP tools** in `src/lib/mcp/nutrition-tools.ts`: `list_nutrition_logs`, `update_nutrition_log` (named params with field whitelist), `delete_nutrition_log`, `bulk_log_nutrition_meals` (per-item results, partial failures don't abort), `approve_nutrition_day` (idempotent, future-date rejected), `search_nutrition_foods` (3-layer), `get_nutrition_summary` (adherence + streak), and `get_nutrition_rules` (discovery). Uniform error shape with actionable hints.
- **Sub-nav across `/nutrition/*`** (Today / Week / History / Summary).
- **Reusable UI primitives** at `src/components/ui/`: `Sheet` (drag-to-dismiss bottom sheet with focus-trap and scroll-lock), `MacroRing` (pure-SVG donut with band-aware colour), `MacroBar` (horizontal % bar), `SearchInput` (debounced wrapper).
- **Migration 021** adds `approved_status`/`approved_at` columns to `nutrition_day_notes`, a `bands` JSONB column to `nutrition_targets`, the pg_trgm extension + GIN index on `food_name`, and a `nutrition_food_canonical` view (deduped foods with frequency-and-recency ranking).
- **Local-first plumbing** for the new fields. `LocalNutritionLog` gains `meal_name` / `template_meal_id` / `status` (already on the server). Dexie schema bumps from v6 to v7 with an explicit upgrade callback that backfills existing rows.

### Changed
- **Sync push handler for `nutrition_day_notes` now uses `ON CONFLICT (date)`** instead of `ON CONFLICT (uuid)`. The previous behaviour would throw on the date UNIQUE constraint when a page-originated row and an MCP-originated row collided, stalling sync; the new behaviour merges the two paths.
- **Food search query input is escaped before LIKE concatenation.** Searching for `100%` no longer matches the entire table.

## [0.1.2] - 2026-04-30

### Added
- **Shoulder Width** is now a tracked measurement on /measurements alongside Waist, Hips, Upper Arm, and Thigh. The input shows up in the log-entry form, the current snapshot, the history list, and the trend chart with its own colour (rose-500). In physique tracking "shoulder width" refers to the tape-over-deltoids measurement (a circumference that grows with training), not biacromial bone-to-bone breadth.
- One-off backfill script `scripts/backfill-shoulder-width.mjs` imports historical Shoulder Cir values from the Notion "Body" database. Reads from a committed JSON snapshot at `scripts/data/body-measurements.json` (40 entries, 33 valid). Migrates legacy `site='shoulders'` rows to `site='shoulder_width'`, then inserts new ones, skipping date collisions. Idempotent via `source='notion_body_db'` + `source_ref=<notion page_id>`. Run `node scripts/backfill-shoulder-width.mjs` for a dry run, or `--apply` to write.
- One-off backfill script `scripts/backfill-progress-photos.mjs` for importing progress photos from the same Notion database. Refetches fresh Notion file URLs at run time (Notion signs them with a ~1hr TTL), uploads to Vercel Blob, and records in `progress_photos`. Pose defaults to `'front'` because Notion has no pose tagging — manually re-classify in-app after import. Requires `NOTION_TOKEN` env.

### Changed
- Renamed the `MeasurementSite` enum value `'shoulders'` to `'shoulder_width'` across the type system, the MCP `update_body_comp` tool schema, and the UI. Existing rows with the legacy `'shoulders'` literal continue to display correctly under the Shoulder Width tab via SITE_ALIASES.

## [0.1.1] - 2026-04-30

### Fixed
- iOS Safari / WKWebView no longer auto-zooms when tapping text inputs, and the user can no longer get permanently stuck in a zoomed-in state. All inputs are forced to 16px on mobile and the viewport is pinned at scale 1.
- "Unknown Exercise" no longer flashes on workout and history views during cold start. Fixed at three layers: the bundled exercise catalog UUIDs are now lowercased on hydrate (matching how sync pull stores them), the rendering fallback shows empty space instead of "Unknown Exercise" during the brief Dexie-read window, and the sync engine consistently lowercases exercise UUIDs on every fetch.
- Pages no longer show a forced 500ms loading skeleton when local data is already available. The full-screen "Loading exercises…" overlay that blocked every cold start has been removed entirely.

### Added
- Foundation for local-first-everywhere: every domain table the app reads now has a Dexie schema entry (12 new local tables for plans, routines, nutrition, measurements, InBody, body composition, wellbeing, HRT, photos). Page migrations to use these tables ship in a follow-up.
- Postgres change-data-capture (CDC) layer (migration 019). Every domain table now has an `updated_at` column with auto-bump trigger and a `change_log` trigger that appends to a global monotonic seq stream. Replaces per-table timestamp cursors.
- New `/api/sync/changes` endpoint backed by the CDC stream. Single seq cursor, paginated, atomic per-page apply on the client. Replaces `/api/sync/pull`.
- Foreground sync hook in `providers.tsx` consolidates `visibilitychange` + Capacitor `App.appStateChange` into a single trigger alongside HealthKit's resume sync. MCP-driven server changes appear in the app within ~15 seconds (or instantly on foreground).

### Changed
- Sync engine (`syncEngine.start()`) is now idempotent — repeated calls under React StrictMode or route remounts no longer create duplicate intervals or listeners.
- Polling reduced from 60s to 15s while the document is visible, suspended when hidden. MCP changes propagate ~4× faster while consuming less cellular data when the app is backgrounded.
- `/api/sync/push` now handles all 23 synced tables. Push payload structure is unified across domains.

### Removed
- `/api/sync/pull` endpoint and its test (replaced by `/api/sync/changes`).
- Full-screen "Loading exercises…" overlay (`SyncStatus` is now a passive bottom indicator only).
- Debug console.warn block in `useLocalDB.ts` that was added as a band-aid for the Unknown Exercise bug — root cause is now fixed.

### Notes for next deploy
- Run `npm run db:migrate` to apply migration 019 before the new sync endpoints will work. The migration is additive (no data loss) and includes a backfill of `change_log` from existing rows so the first post-migration pull is consistent.
- Existing Dexie installs upgrade from v3 to v4 automatically and additively (12 new tables added, no existing tables modified or dropped).
