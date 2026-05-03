# Changelog

All notable changes to Rebirth are documented here.

## [0.8.0] - 2026-05-03

### Added (Week page v1.1)

- **Next-Week Prescription banner** at the top of the Week page. Synthesizes the 5 v1 tile signals + HRT context into per-priority-muscle PUSH / REDUCE / DELOAD recommendations with reason chips and a tap-to-expand explanation sheet. Replaces the originally-planned "deload status chip" with an actionable surface — the autoplan dual voices both flagged a passive chip as "the worst middle ground" between status and prescription. Confidence-gated: per-muscle requires ≥3 weeks of effective-set data + ≥3 sessions in last 14 days; whole-body DELOAD requires ≥14 days of HRV baseline. Quiet warming-up state below those thresholds. Total-added-sets cap of +4/week across all PUSH recommendations (eng-review safety constraint). HRT context: reads `hrt_timeline_periods` and surfaces a "Recent protocol change — strength variance expected" footer line + suppresses e1RM stagnation as a DELOAD trigger when the active protocol is < 4 weeks old. Built on three new pure modules: `prescription-engine.ts`, `reason-chip-registry.ts`, `hrt-context.ts`.
- **Cardio compliance tile** (Section A slot 4, between Recovery and Weight EWMA — both reviewers' "systemic load cluster" placement). Activity-type classification only for v1.1; the planned HR-zone path was dropped at the autoplan eng review (workout-avg HR systematically misclassifies HIIT, per-second HR samples not in `healthkit_workouts` schema yet). Renders single-ring mode against the umbrella `programming_dose.cardio_floor_minutes_weekly` target, OR split rows when either / both of the new `cardio_zone2_minutes_weekly` and `cardio_intervals_minutes_weekly` sub-targets are set on the active body_plan. HealthKit not connected → "Connect HealthKit" CTA. No targets set → tile renders nothing (silent). All-strength-week → 0/target silently (no warning copy).
- **Data-sufficiency badges** on Priority Muscles tile rows. Small `[N wks]` pill rendered only when a muscle's history is below the personalization threshold (8 weeks). Foundation for v1.2 landmark personalization UI — silently disappears once the muscle accumulates enough weeks. 0-weeks renders distinct `[no data]` copy. Tap opens an explanation sheet (iOS PWA — touch has no hover, so tooltip would never be discovered).
- **Photo cadence footer** — monthly front-pose progress photo prompt. 28-day cadence matches HRT silhouette change (van Velzen 2018). Three render states: `soon` (22-28d, gentle muted-tone footer), `overdue` (>28d, amber tone, promoted above Section B), `no-photo-ever` (onboarding copy with "take your first front-pose photo"). Capture link always present; "Compare projection" secondary affordance ships dark in v1.1 (projection_photos not yet in local-first sync set).
- **Hip Abduction exercise** added to the catalog (`Cable Hip Abduction`, primary: `hip_abductors`, secondary: `glutes`). Closes the v0.7.6 deferred TODO — the Hip-Abductors anchor-lift trend row no longer renders the data-needs flag once Lou logs a set with this exercise.
- **`get_health_cardio_week` MCP tool** mirroring `get_health_sleep_summary`'s shape. Returns total / zone-2 / intervals minutes vs `programming_dose` targets + 7-day breakdown. Status envelopes: `not_connected` (503), `invalid_input` (400), `no_targets` (200), or happy (200). Backed by the same `computeCardioWeek` server helper as the HTTP route.
- **`/api/health/cardio-week` HTTP route** mirroring `/api/health/snapshot`'s shape (auth + connection check + error envelope). Accepts `start_date`/`end_date` OR `window_days` (default 7, max 90).
- **`src/lib/training/cardio-classification.ts`** — pure activity-type → category (zone2 / intervals / uncategorized) mapping. Single source of truth shared by route + MCP tool.
- **`src/lib/vision/programming-dose.ts`** — Zod schema for the previously-untyped `body_plan.programming_dose` JSONB blob, with `resolveCardioTargets()` helper. Replaces 3+ inline parsers, prevents future type drift.

### Changed

- `body_plan.programming_dose` (JSONB) now optionally accepts `cardio_zone2_minutes_weekly` and `cardio_intervals_minutes_weekly` sub-targets alongside the existing `cardio_floor_minutes_weekly` umbrella. Backwards-compatible: existing plans continue to work; the cardio tile falls back to single-ring rendering when only the umbrella is set.

### Architecture notes

- **Decision-engine reframe:** the original v1.1 plan bundled 7 features (landmark personalization UI, anchor-lift override UI, deload status chip, cardio tile, photo cadence, dark mode, catalog audit). Both /autoplan dual voices independently challenged this as "knobs and tiles instead of synthesis." Lou rebriefed at the premise gate: ship the synthesis surface (prescription card with HRT context), defer personalization editors to v1.2 once data accumulates, drop dark mode entirely.
- **Two scope drops at the eng review** for schema reasons, both gated on v1.2 follow-ups: HRT trough-day chip (needs `route` + `dose_interval_days` schema additions on `hrt_timeline_periods`); HR-zone cardio classification (needs per-second HR samples in `healthkit_workouts`).
- **Architecture pattern:** `PrescriptionCard`, `CardioComplianceTile`, and `PhotoCadenceFooter` all live OUTSIDE `resolveWeekTiles()` — they self-decide rendering based on their own data sources. Keeps the `WeekTile` discriminated union and its 12 test snapshots unchanged. The prescription engine is a pure sibling resolver next to `resolveWeekTiles`, sharing the same WeekFacts input.
- **Future-Lou-developer ergonomics** (DX-review pattern): adding a new reason chip touches the engine rule + one entry in `reason-chip-registry.ts` (label + ariaLabel + explanation + severity). Engine emits `{kind, ...payload}` tagged-union values; UI renders by `chip.kind` from the registry.

### Tests

1201 → 1351 (+150 net). All passing. Coverage: prescription engine (29 cases including HRT recent-protocol suppression, total-added-set cap, RIR boundary 0.49 vs 0.50, HRV boundary -0.99σ vs -1.0σ, determinism), HrtContext (16), reason-chip registry (10), cardio classification (16), programming-dose Zod (12), cardio-week HTTP route (12), CardioComplianceTile component (11), PrescriptionCard component (12), SufficiencyBadge (10), photo-cadence math (12), PhotoCadenceFooter component (14).

### Documented

- v1.1 plan + decision audit (40 rows): `~/.gstack/projects/lewcart-Iron/feat-week-v1.1-plan-20260503-160000.md`

## [0.7.6] - 2026-05-03

### Added
- **Week page (`/feed`, dock label "Week").** Replaces the old Feed accretion with a science-grounded weekly training dashboard. Five tiles (Priority Muscles vs MEV/MAV/MRV using RP-2025 landmarks, Effective-Set Quality % at RIR ≤3, Anchor-Lift e1RM trend, Recovery via HRV vs personal 28-day baseline, Weight 10-day EWMA), then a 12-Week Trends section (5 sparklines with inline direction chips and tap-to-expand chart modal showing axis labels, numbers panel, and rule explanation), then top-of-page entry-point chips for Strategy / Sleep / Photos. Honest data-needs flags per tile when data is insufficient, with per-source actionable copy (no generic "Fix this"). Anchor lifts resolve via muscle-tag-first lookup (most-frequent exercise tagged with the priority muscle), so user's actual lifts surface instead of name-match misses.
- **MCP `update_vision` now validates muscle slugs against the canonical taxonomy.** Accepts canonical slugs ("delts") and legacy synonyms ("rear delts" → "delts"); rejects unknowns with `UNKNOWN_MUSCLE` + `list_muscles()` hint; dedupes after normalization.
- **Edit pencil on Priority Muscles tile** links to `/strategy` for editing build_emphasis / deemphasize.
- **Color key on Priority Muscles tile** (priority pink / de-emphasis blue / other gray / over-MAV amber / at-MRV red).
- **`/api/health/snapshot` REST route** mirroring existing sleep-summary route, wraps HealthKit HRV / sleep snapshot for client use.

### Changed
- **TabBar first tab "Feed" → "Week"** (icon `BarChart2` → `LineChart`). Route stays `/feed` to keep URLs stable.
- **`/api/feed` defensive guard** for HRT timeline rows with missing `started_at` (pre-existing RangeError 500 in `timeline-entries.ts:141` exposed by Week-page polling, now returns 200 with the bad row filtered).
- **RIR-quality wait threshold:** Effective-Set Quality tile no longer nags below 3 sessions in the last 14 days; quiet bootstrap message instead.

### Documented
- **`TODOS.md` Week page V1.1 follow-ups:** catalog audit (hip-abduction tagging), per-muscle landmark personalization UI, anchor-lift configurability UI, mesocycle / deload state machine, cardio compliance tile, photo cadence prompt.
- **`TODOS.md` Dark mode (app-wide):** pre-existing — `globals.css:37-58` defines `.dark { ... }` correctly but no code ever applies the class to `<html>`. Affects every page equally; not a Week-page regression.

## [0.7.5] - 2026-05-03

### Changed
- **RIR capture is now a one-tap, in-row drag slider.** The old flow took two taps — tick the green check, then tap a separate "RIR" pill that expanded a 0–5 chip strip below the row. Now ticking the set immediately writes a default RIR (your previous-session RIR for that set position, or 2 if there's no prior session) and surfaces a compact "RIR N" pill inline on the right of the same row. Press-and-hold the pill and slide vertically to adjust — up = more reps in reserve, down = fewer, clamped 0–5. Commits on release; arrow keys also work for keyboard. Weight and reps/time are now left-aligned on the row to free up the right-hand space for the slider, so post-completion rows don't expand vertically the way the old chip strip did.

## [0.7.4] - 2026-05-03

### Added
- **Magic ✨ button on exercise content fields.** A Sparkles icon next to the Pencil on About / Steps / Tips opens the editor and AI-fills the section in ~3-5s. Single-shot draft mode — generated content goes into the editable draft, never auto-saves. User reviews, tweaks, and Checks to commit (or Cancels to discard). Editing is disabled during the spinner so generation can't stomp mid-keystroke. Cancel actually aborts the OpenAI call (signal threaded into the SDK), not just the spinner. Cross-field context: tips generation sees existing description + steps but never the existing tips (rephrase trap). Cross-field is wrapped in `<exercise_context>` data tags so user-typed content can't act as instructions. Hidden in modal chrome (mid-workout reference is read-only). Disabled when offline with a clear "Magic needs internet" tooltip.
- **Auto-fill ✨ button on the new-exercise creation form.** Single bundled call (kind='all') populates description + steps + tips in one OpenAI roundtrip, gated on title + at least one primary muscle being set. Asymmetric stomp policy: only fills empty fields, preserving anything the user has already typed (the create form is itself a draft, unlike the detail page's section editor).
- **CreateExerciseForm now has Steps and Tips fields** (previously you had to add them later on the detail page). Reuses the same `ProseOrListEditor` sub-component as the detail page so the editor behaviour is identical across both surfaces.
- **MCP `create_exercise` and `update_exercise` tool descriptions punched up** with concrete example outputs to nudge agents (Claude in chat) to populate steps + tips at creation time. Today they default to title + muscles only because the schema marked steps/tips silently optional; examples in the prose shape behaviour where bare prose nudges don't.

### Changed
- **`/api/exercises/generate-content` route added.** Discriminated body: `{ uuid, kind: 'description'|'steps'|'tips', exercise: {...} }` for existing exercises, `{ kind: 'all', exercise: {...} }` for the create-form draft. Client always passes the **live** exercise object (not just the uuid) — Rebirth is local-first; Dexie has the truth and Postgres lags any unsynced edits, so a server-side lookup would feed stale data to the LLM. Strict OpenAI structured outputs (gpt-4o-mini) with bounds (description ≤280, steps 3–8 × ≤120, tips 2–6 × ≤100) plus defensive post-parse validation. AbortController wired end-to-end; per-call 30s timeout, route maxDuration 60s.
- **Test infra: `@testing-library/react` + `jsdom`** added to support component tests. vitest 4.x deprecated `environmentMatchGlobs`; the `.tsx` test files opt into jsdom via the `// @vitest-environment jsdom` docblock comment. node-env tests are unaffected.

## [0.7.3] - 2026-05-03

### Fixed
- **Duplicate custom exercises in /exercises/custom collapsed.** 13 case-insensitive title clusters (28 rows) merged into one row each. Smart merge preserves any descriptions and muscle tags split across the duplicates, so nothing is lost. Workout history is repointed onto the keeper before the loser rows are deleted, so set logs and routines stay attached. Warm-up cues normalized to "(Warm-Up)" to match the rest of the catalog.
- **Two cross-type duplicates also collapsed:** "Cable Hip Adduction" and "Cable Kickback" each had a stub custom row sitting alongside the richer stock catalog row. The custom rows are gone, the stock rows kept their workout history, and the custom's unique aliases were unioned into the stock row's alias list.

### Changed
- **Tapping "Add Custom Exercise" with a name you already have now fails fast** with an inline "You already have a custom exercise named X" message, instead of silently creating row #2. Case-insensitive and trim-aware, so "Warm-Up" vs "Warm-up" and " Cable Kickback " vs "Cable Kickback" all collide.
- **MCP `create_exercise` returns a structured `DUPLICATE_TITLE` envelope** with a `find_exercises` hint when an agent tries to create a duplicate, instead of a 500 from the unique-violation.

### Schema
- **Migration 034** smart-merges within-custom duplicates and adds `exercises_custom_lower_title_unique` — a partial UNIQUE on `LOWER(TRIM(title))` scoped to `WHERE is_custom = true`. From now on the database rejects a duplicate-title custom write regardless of whether it came from the sync push, the MCP server, or hand-rolled SQL.
- **Migration 035** repoints two cross-type custom rows onto their stock catalog twins, unions their alias arrays, and drops the orphans.

## [0.7.2] - 2026-05-03

### Added
- **Cross-browser auto face-detection for photo alignment.** Adjust alignment now auto-detects the face on open and prefills `crop_offset_y` so heads land at the comparison head-anchor automatically. Works on iOS Safari (incl. Capacitor) via lazy-loaded `@tensorflow-models/face-detection` with MediaPipe's long-range "full" model — the variant designed for full-body shots where faces are small in frame. Native `window.FaceDetector` is still tried first on Chromium-on-Android for the zero-cost path. Bundle cost: ~630KB JS + ~250KB model on first call, browser-cached after that.
- **`AUTO-DETECTING…` overlay** while detection runs and a trans-blue **AUTO** badge when the prefilled offset came from auto-detection. Drag-to-nudge still overrides without losing the badge until save.

## [0.7.1] - 2026-05-02

### Added
- **Custom notes textarea on regenerate.** Optional collapsible "Customize" section in the demo-image manager sheet, with a 280-char textarea labeled "Notes for this regeneration". Server validates the length and threads the trimmed text into BOTH frame 1 + frame 2 prompts as `Additional guidance from the user: …`, so the model sees the correction whether it's painting frame 1 from scratch or chaining frame 2 off it. Notes persist on the `exercise_image_generation_jobs` audit row. One-shot per generation: cleared after success so the next run starts fresh.
- **Reference image upload on regenerate.** Optional file picker in the same Customize section. PNG/JPEG/WebP, ≤8MB. When attached, the route sends multipart form-data instead of JSON; the server resizes the reference to 600×800 PNG via sharp, uploads it to Vercel Blob at `exercise-images/{uuid}/{batchId}/ref.png`, and uses `openai.images.edit({ image: ref })` for **frame 1** instead of `images.generate`. Frame 2 still chains from frame 1 via the existing edit-call, so the reference's aesthetic flows through both panels. Reference URL is preserved on the jobs row even on rollback (it's a source artifact; retries can re-use it).
- **All catalog steps now reach the prompt.** Previously capped at the first 3 steps; now every step on `exercises.steps` is included, joined as a single instruction string.
- **Catalog tips now reach the prompt.** Surfaced as `Things to watch for: {tips.join('. ')}` so form-correctness hints (e.g. "back flat", "elbows tucked") guide the image generator the same way they'd guide a real athlete. Tips were previously invisible to the model.

### Changed
- **Soft cap on prompt length** (~2000 chars). When `steps` and/or `tips` are unusually long, the truncation prefers trimming the catalog content over the user's `notes` (the user's correction is the most valuable signal).
- **Generate-images route accepts both JSON and `multipart/form-data` bodies.** JSON path stays the fast path for note-only customizations; multipart kicks in only when a reference image is attached. Validation (notes ≤280, reference ≤8MB, MIME in PNG/JPEG/WebP) returns 400 with a helpful message.

### Schema
- **Migration 033** adds two nullable columns to `exercise_image_generation_jobs`: `notes TEXT` and `reference_image_url TEXT`. Both are server-side audit fields; no CDC trigger and no client sync impact.

## [0.7.0] - 2026-05-02

### Added
- **Same-date photo grouping.** The Photos tab gallery now collapses photos taken on the same calendar day into a single card with a 3-up pose strip (front → side → back). One capture session reads as one entry instead of three.
- **Photo alignment via `crop_offset_y`.** New nullable column on `progress_photos`, `inspo_photos`, and `projection_photos` (CSS object-position y%, 0-100). Renderer applies it everywhere photos appear in compare context so heads can line up across the divider. NULL = renderer defaults to 50 (center).
- **Adjust alignment mode.** Long-press menu on any photo opens a full-screen modal: drag the photo up or down to position the head against the trans-blue anchor line at 25%. Reset, Save, persists via PATCH (and through the sync layer for progress photos).
- **Best-effort face detection on upload.** `window.FaceDetector` (Shape Detection API) where supported (Chromium-based browsers) auto-fills `crop_offset_y` to anchor the face at ~25% from the top. Returns null on Safari (incl. iOS via Capacitor) and back-pose photos; manual drag is the safety net. No model download.
- **Unified Compare dialog with Projection / Inspiration toggle.** One dialog, one slider primitive, two data sources. Top-of-dialog tab switches between target types with live counts. Pose chip strip uses the active target's accent color (trans-blue for projection, trans-pink for inspo).
- **Pose-aware compare-to-inspo flow.** Tap Compare → Inspiration on any progress photo to auto-pick a matching-pose inspo. Pose-mismatch UX with `View {other-pose}` fallback chips and `+ Capture inspo` CTA.
- **Per-photo action menu.** Each photo tile gets an overflow `⋯` menu: Compare to projection, Compare to inspo, Adjust alignment, Delete. Compare items hide when there's nothing to compare against.
- **Adjust source / Adjust target buttons** inside the Compare dialog so you can fine-tune both sides without leaving the comparison.

### Changed
- Sync layer (push + pull) now round-trips `crop_offset_y` for progress photos so manual adjusts persist across devices.
- `CompareWithProjectionDialog` removed; replaced by the unified `CompareDialog` with a `defaultTarget` prop.

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
