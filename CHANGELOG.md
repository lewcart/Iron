# Changelog

All notable changes to Rebirth are documented here.

## [0.6.1] - 2026-05-02

### Added
- **In-app AI generation of exercise demo images.** A pencil overlay on the demo strip opens a bottom sheet with the regeneration history (each pair shown side-by-side with the active one marked) and a sticky **Generate** / **Regenerate (~$0.50)** footer. Generation runs server-side via `gpt-image-1`: frame 1 is generated, then frame 2 is generated via `images.edit` with frame 1 as the reference image so the athlete, gym, lighting, and framing stay consistent across both panels. Replaces the prior 2-panel composite + post-hoc split, which mid-cut content when `gpt-image-1` didn't honor the 50% boundary. Tap any prior pair in the history to reactivate it; the demo strip switches instantly via local-first sync.
- **`exercise_image_candidates` and `exercise_image_generation_jobs` (migration 032).** Candidate table holds every generated frame with a `batch_id`, frame index (1 or 2), Vercel Blob URL, and `is_active` flag. A unique partial index on `(exercise_uuid, frame_index) WHERE is_active` enforces exactly one active row per (exercise, frame) at the DB layer, catching concurrent activate races as 409s. The jobs table is server-side audit only (no CDC) and tracks status (running / succeeded / failed_frame1 / failed_frame2 / failed_db / rollback_orphan), OpenAI request ids, and estimated cost in cents. The active candidate's URLs are mirrored into `exercises.image_urls` / `image_count` so `ExerciseDemoStrip` keeps reading the existing column shape unchanged.
- **PWA-suspend recovery for in-flight generation.** Client stamps `localStorage` with `{ request_id, started_at }` when a generate POST starts; on `visibilitychange === 'visible'` the manager polls `GET /api/exercises/[uuid]/image-candidates?request_id=X` until the corresponding job either succeeds (sync pull, swap UI) or terminally fails. Recovery footer shows real elapsed time measured from the original POST so the counter survives suspend cycles. Service-worker retries are deduped server-side: a POST with a `request_id` that already produced a `succeeded` job replays the existing batch instead of double-spending the OpenAI bill.
- **Cumulative cost footer per exercise.** The manager's footer reads `SUM(cost_usd_cents)` from `exercise_image_generation_jobs` and renders `This exercise: 4 generations · $2.00`, including partial-failure costs so the running total is honest.

### Changed
- **Demo image flow is pair-atomic.** If frame 2 generation or upload fails, the frame 1 blob is rolled back via `del()` (best-effort) and no candidate rows are inserted, so the user never sees a half-pair in history. The jobs row records the partial cost. If `del()` itself fails, status flips to `rollback_orphan` for manual cleanup later.
- **Demo strip generation prompts split into per-frame builders.** Replaced the single 2-panel composite prompt with `buildExerciseImagePromptFrame1` (start position, sets the visual vocabulary) and `buildExerciseImagePromptFrame2` (end position, references the frame-1 image). Both text-only, the conditioning happens via `images.edit({ image })` not via prompt repetition.
- **`maxDuration` on `/api/exercises/[uuid]/generate-images` raised from 90s to 300s.** Two sequential `gpt-image-1` high-quality calls + uploads + DB writes budget 90-180s observed; 300s gives headroom. Requires Vercel Pro+ tier, verify before deploying.

### Fixed
- **OpenAI SDK call shape for `images.edit`.** The reference image is now wrapped via `toFile(pngBuffer, 'frame1.png', { type: 'image/png' })`. Passing a raw `Buffer` (or a JPEG buffer) to `gpt-image-1` returns `BadRequestError: Could not parse multipart`. The original 1024×1536 PNG buffer is held in memory across the two-stage call so we don't decode-and-re-encode through `sharp` for nothing.

### Removed
- **`src/lib/split-vertical-panels.ts`.** No longer used after the route rewrite. The two relevant lines (`.resize(600, 800).jpeg({ quality: 75 })`) inlined into a small pipeline helper.

## [0.6.0] - 2026-05-02

### Added
- **Projections** — a new photo surface for AI-generated future-self images. Generate them elsewhere (ChatGPT, Midjourney, etc.) and upload them here so they line up against progress photos at the same pose for side-by-side comparison.
- **`/projections` gallery.** Pose filter chips with live counts, grid layout, pose + horizon badges on each thumbnail, body-positive empty state framed as planning.
- **Single-screen upload sheet.** Pose selector, source-progress-photo picker (filtered to the chosen pose, excludes still-uploading photos), target-horizon segmented control (3mo / 6mo / 12mo), notes input.
- **Strategy page split.** The single inspo strip is now two distinct sections: **Projections** (above, dominant — trans-blue Sparkles, larger landscape thumbs, ring accent) and **Inspiration** (below, secondary — trans-pink Camera, 4-col strip). They look like different kinds of thing on first read.
- **Compare-with-projection dialog.** Open from any progress photo on `/measurements?tab=photos`. Full-screen draggable before/after divider — slide to reveal more of either side. Pose chip strip with per-pose counts and a `(Source)` marker on the source pose. Alternate-projection carousel when multiple exist at the same pose. Source-linked projection (when uploaded with `source_progress_photo_uuid`) sorts first.
- **Pose-mismatch UX.** Switching to a pose with no projection shows a sparkle empty state with a primary Upload CTA and `View {other-pose}` fallback chips. Never silently empty.
- **Banner CTA on the photos tab.** "Compare your latest with your projection →" appears at the top of `/measurements?tab=photos` when at least one projection exists.
- **MCP tools for projections.** `upload_projection_photo`, `list_projection_photos`, `delete_projection_photo` — same shape as the existing photo tools, plus optional `source_progress_photo_uuid` and `target_horizon` for compare-pair linking.
- **CLAUDE.md gets a Projection workflow section** in the same shape as the existing nutrition/sleep/strength sections.

### Fixed
- **Orphan-blob bug on photo delete.** `deleteProgressPhoto` and `deleteInspoPhoto` were leaving the Vercel Blob behind on user-initiated delete. Both now clean up the blob alongside the row (skipping `local:*` stubs that aren't on Blob yet).

## [0.5.0] - 2026-05-02

### Added
- **Rep-window vocabulary across the app.** Strength (4–6) · Power (6–8) · Build (8–12, hypertrophy default) · Pump (12–15) · Endurance (15–30, catch-only). Single source of truth at `src/lib/rep-windows.ts` — backend, frontend, MCP, and the progression rule all import from here so the vocabulary never drifts. Boundary policy is inclusive on the upper bound: a set of exactly 8 reps stays in Power; the 9th rep is what escalates the lifter into Build. The next-window edge is the trigger to add load, not the goal-window edge.
- **`goal_window` per routine exercise.** Migration 031 adds the column to `workout_routine_exercises` with a CHECK constraint; Dexie v15, sync pull/push, and the public `WorkoutRoutineExercise` type all carry the field end-to-end. Setting a window cascades its min/max to every set on the exercise so the routine editor and the workout-time spawn agree.
- **Window picker on the routine editor.** Four pills under each reps-mode exercise (Strength/Power/Build/Pump — Endurance is catch-only and excluded from the picker). Tap to assign, tap the active one to clear. Trans-flag-mapped palette: Strength + Endurance get solid bg + white text (rare/extreme), Power/Build/Pump get soft tinted pills with a purple bridge in the middle.
- **Goal-window pill on the workout exercise card.** Renders inline next to the recommendation badge with the window label (e.g. "Build 8–12"). Distinct visual weight from the recommendation badge so the goal vs cue read as different kinds of information.
- **Window-aware progression rule.** `recommendForExercise` takes an optional `goalWindow`. When set, classifies each completed set by which window its reps land in (via `windowForReps`), then compares to the goal: in window with RIR room → "more reps"; spilled one window up → "↑ go heavier" (medium); spilled two+ windows up or avg RIR ≥ 4 → "↑↑ go heavier" (high); below goal window → "↓ back off"; in window with RIR 0–1 → "= hold". Falls back to the legacy set-level min/max path when no window is assigned.
- **MCP `list_rep_windows` tool.** Returns the canonical registry (key, label, min, max + boundary policy + hypertrophy default) so AI agents understand the vocabulary without inferring it. `create_routine` and `add_exercise` accept `goal_window` per exercise (silently normalized — unknown values fall to NULL rather than erroring). `get_active_routine` returns it on each routine_exercise.
- **`db:audit-routines` and `db:assign-rep-windows` scripts.** Audit groups every routine exercise by current set-level min/max and whether it snaps to a registered window. Auto-assignment is a one-shot heuristic by movement pattern (compound vs accessory vs isolation) with hypertrophy bias — conservative, never overwrites. Initial run assigned 78 exercises (8 Power, 42 Build, 28 Pump) and reconciled 246 sets.

### Changed
- **Per-set RIR strip collapsed into an inline pill on the set row.** Each completed set now has a single `RIR n` (or dashed `RIR` if unset) pill between reps and the green checkmark, not a second 30-px row of chunky 0–5 chips. Tap the pill to expand the chips for that one set; tap a chip to set + auto-collapse. Three pill states: dashed-border (unset, suggests tap), filled `RIR n` (set), neutral filled (open). Net: a 3-set exercise stays 3 rows tall instead of 5+, RIR still one tap away when you actually want to set it.

## [0.4.0] - 2026-05-02

### Added
- **Anatomical muscle indicator on the exercise detail page.** Front + back female silhouettes render side-by-side under a "Target muscles" section, with primary muscles filled in their parent-group hue (chest blue / back orange / shoulders purple / arms pink / core amber / legs green) and a darker stroke ring, and secondary muscles filled in a lighter variant of the same hue. Pills above name the precise muscle (e.g. "Chest", "Lats", "Rhomboids") sorted by display_order, primary first. Two of the canonical 18 slugs that the library can't visualize, `rotator_cuff` and `hip_abductors`, surface as deep-pill-only with a Layers icon prefix, so a face pull or a side-glute exercise still shows the precise name even if the diagram can't paint it. Uses [`react-muscle-highlighter`](https://github.com/soroojshehryar/react-muscle-highlighter) (MIT, no transitive deps). Modal mode (`chrome === 'modal'`, the in-workout exercise peek) keeps the existing dense text-row UI on purpose: mid-set, eyes-on-bar, the diagram is the wrong call.
- **`normalizeMuscleTags(rawPrimary, rawSecondary)` helper in `src/lib/muscles.ts`.** Pure function that takes whatever shape the DB/Dexie boundary returns (including null, non-array, or arrays containing legacy synonyms like "shoulders" / "rear delts") and yields canonical-slug arrays with primary winning over secondary on duplicates. Exercised by 10 unit tests covering null/non-array/empty/dedup/synonym-resolution edge cases.
- **Typed `getMuscleGroupColor`, `getMuscleGroupColorLight`, `getMuscleGroupColorDark` accessors in `src/lib/muscle-colors.ts`.** Replaces the substring-matching `getMuscleColor(string[])` for new callers (legacy is preserved). Three palettes per muscle parent group — saturated for primary fills, lighter for secondary fills, darker for primary borders.

### Changed
- **`next.config.ts` pins `outputFileTracingRoot` to `__dirname`.** Without it, Next.js running inside `.claude/worktrees/...` infers the parent repo as the workspace root and module resolution can pick up a duplicate copy of React from outside the worktree, triggering "Cannot read properties of null (reading 'useInsertionEffect')" in dev. Anchoring the trace root keeps every worktree (and the main checkout) consistent.

## [0.3.0] - 2026-05-01

### Added
- **`/sleep` page — verdict-first recovery view.** Opens with a one-word verdict ("Solid" / "OK" / "Light" / "Restless") computed from last night's total + deep %, with the stage breakdown and HRV inline. Window averages card shows Avg sleep / Consistency (label, not raw score) / Avg deep / Avg REM / HRV(7d) with delta vs 30-day baseline. Two charts split for legibility at 375px: a 7-day stacked stage bar chart and a separate HRV sparkline. Day / Week / Month / 3-Month range tabs change the window in one tap. Bad-night UX adapts the lede instead of punishing it ("Light night. Your 7-night average is still 7h 22m."). Empty states for "no data last night," "<5 nights for consistency," "HK disconnected," and offline are all specified inline.
- **`get_health_sleep_summary` MCP tool.** One-call sleep + recovery rollup for AI coaching agents, replacing the previous "call `get_health_series` six times" pattern. Returns per-stage averages, consistency score (circular stdev of bedtime/waketime in minutes — main-night-filtered, n>=5 required), HRV trend with 30-day baseline + delta_pct, and per-night detail when requested. `fields` projection drops branches you don't need (~30 tokens for `consistency` only vs ~250 for the full payload). `window_days` parameter sidesteps `start_date` math for "last week"-style questions. Errors mirror `get_health_snapshot`'s `not_connected`/`invalid_range`/`invalid_input` shapes. Cross-references appended to `get_health_snapshot` and `get_health_series` descriptions so agents can find it.
- **`healthkit_sleep_nights` table (migration 025).** One row per night with the bed/wake envelope (`start_at`/`end_at`, both nullable for historical samples), per-stage minutes, and `is_main` filter (true when in_bed >= 4h AND wake >= 04:00 Europe/London). The Capacitor plugin's `SleepNight` payload already exposed `start_at`/`end_at` — no native code change required. Migration includes a one-shot anchor reset on `healthkit_sync_state.metric='sleep'` so the next iOS sync re-pulls the last 90 days into the new table.

### Changed
- **`/wellbeing` no longer asks you to type sleep hours.** The manual `Sleep hours (optional)` text input is gone — Eight Sleep + Apple Watch already write nightly sleep into HealthKit, and the manual field was vestigial. In its place: a Sleep deep-link row at the top of the Daily tab showing last night's total and verdict ("Sleep / Last night 7h 42m · Solid ›") that taps through to `/sleep`. The `wellbeing_logs.sleep_hours` column is preserved (no data loss) — only the input is removed.
- **HealthKit sync route persists per-night sleep envelopes.** `src/app/api/healthkit/sync/route.ts` now writes both the existing `healthkit_daily.sleep_*` aggregate rows AND a new `healthkit_sleep_nights` row per `SleepNight`, including the `is_main` flag computed via Europe/London-aware `Intl.DateTimeFormat` (server timezone irrelevant). `healthSync.ts` no longer drops the `deleted: string[]` array from `fetchSleepNights`; it's accepted server-side and counted in the response as `sleep_deletions_acknowledged_no_op` (mapping back to derived nights requires a future plugin extension that emits per-night HK UUIDs — documented as TODO).
- **HealthKit sync surfaces server failures instead of silently returning ok.** Previous behavior: any DB error during sync (schema drift, payload validation, etc.) returned `ok:true` to the client. Now: `res.ok` is checked and a non-2xx response is surfaced as a network-style sync failure so the caller sees the data didn't land. (Codex adversarial review caught this.)

### Fixed
- **Consistency-score math is timezone- and midnight-safe.** Earlier sketch used JavaScript `Date.getHours()` (returns server-local time) and a noon-pivot wrap-around for clock arithmetic — both broken for redeyes, naps, BST/GMT transitions, or any server not running in Europe/London. Replaced with circular statistics on the 24-hour clock circle, with all clock-time extraction routed through `Intl.DateTimeFormat({timeZone:'Europe/London'})`. `n` threshold raised from 3 to 5 (a working week) so the score isn't statistically meaningless on tiny windows.

## [0.2.2] - 2026-05-01

### Added
- **Hydration + day-notes editing on `/nutrition/today`.** New section above the "Mark day reviewed" CTA shows your hydration in ml (with +250 / +500 / +750 quick-add buttons sized to common pours) and a free-text notes textarea. Both auto-save with a 600ms debounce — no Save button to remember. Lives on the same `nutrition_day_notes` row that the legacy page wrote to, so existing data shows up automatically.

### Changed
- **`/nutrition/week` is now Week-only.** The legacy 937-line component had a "Today" subtab that was acting as a back-door to hydration / day-notes editing. With those features now native to `/nutrition/today`, the subtab + all its state (deviation editing, planned-meal logging, protein-target localStorage, dayBundle query) is deleted. The file is 398 lines and only does the Week template editor.

## [0.2.1] - 2026-05-01

### Added
- **Calories burned from Apple Health workouts now subtract from your daily remaining.** The CalorieBalanceCard no longer shows a hardcoded 0 for workouts; new endpoint `/api/nutrition/today-workouts?date=YYYY-MM-DD` aggregates `total_energy_kcal` from `healthkit_workouts` for the local calendar day, consumed by a new `useTodayWorkoutCalories(date)` hook. Refreshes when you change date.

### Changed
- **`/nutrition` now redirects to `/nutrition/today`.** The legacy 937-line `page.tsx` was preserved at `/nutrition/week` (Week template editor as the primary view; the legacy "Today" subtab is kept inside as a back-door to hydration + day-notes editing until the new Today page absorbs those features). Sub-nav points Week at `/nutrition/week`.
- **All 15 nutrition MCP tools now live in one place.** The 7 pre-existing tools (`log_nutrition_meal`, `get_active_nutrition_plan`, `get_nutrition_plan`, `set_nutrition_day_notes`, `set_nutrition_targets`, `load_nutrition_plan`, `update_week_meal`) moved out of the 2900-line `mcp-tools.ts` god file into `src/lib/mcp/nutrition-tools.ts` alongside the 8 new tools. Main `mcp-tools.ts` is ~200 lines lighter. Errors now use the uniform `{ error: { code, message, hint } }` shape.
- **Food search trigram threshold is now explicit per-query (0.22).** Both `/api/nutrition/foods` and `search_nutrition_foods` use `similarity(canonical_name, $q) >= 0.22` instead of the bare `%` operator. The session-wide `pg_trgm.similarity_threshold` default of 0.3 was too strict for branded-food typos (e.g. "Loreal latte" → "L'Oreal latte"). 0.22 keeps single-character typos matching without flooding results with unrelated foods.

### Fixed
- **Database migration runner now correctly handles `--` line comments and single-quoted strings.** A semicolon inside a comment ("uses the same sync route + state") would cause migrate.ts to split mid-statement, blocking PR #23's HRT migration from applying. The splitter now recognises line comments, block comments (with nesting), and quoted strings — any future migration with rich prose comments works without contortion. Migration `020_hrt_labs_meds.sql` applied cleanly to Neon as a result.

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
