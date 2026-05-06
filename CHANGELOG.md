# Changelog

All notable changes to Rebirth are documented here.

## [0.10.2] - 2026-05-07

### Fixed

- **`/api/sync/push` was logging truncated errors** so prod sync failures were unreviewable from the Vercel log viewer (`Error [Neo…` and nothing else). The catch block now serializes `message` + SQLSTATE `code` + `severity` + `detail` + `hint` + `where` to a single JSON line. Diagnostic-only — no behavior change. Reaches for the NeonDbError fields the driver populates on Postgres errors.

## [0.10.1] - 2026-05-07

### Fixed

- **iOS builds were silently shipping stale features.** The Capacitor build was generating a `next-pwa` Workbox service worker that precached `index.html` + `_next/static/*` with `CacheFirst`. After a new install, the previously registered SW kept intercepting fetches and serving last build's HTML — which pointed at last build's chunk hashes — so newly shipped UI (e.g. `MuscleMap` on the exercise page, the ✨ Steps/Tips/About generator) didn't render until the user force-quit and reopened, sometimes twice. Capacitor doesn't need a service worker — the bundle is already on local disk in the .ipa — so it's now disabled for `CAPACITOR_BUILD=1`. PWA caching stays enabled for the web/Vercel deploy. Existing devices clean up the old SW + Workbox caches on boot via a one-shot `serviceWorker.getRegistrations().unregister()` + `caches.delete()` pass in `AppBootstrap`, so this build also self-heals last build's stale cache.

## [0.10.0] - 2026-05-06

### Added

- **Volume Fit tile on `/plans`.** Routine builder now answers "is this routine good enough?" before you follow it. Per-priority-muscle weekly projection with single-glyph-per-row verdict (worst-of volume × frequency × confidence), vision-aware MAV overrides surfaced via `★`, diff-as-default — when you edit a routine, every priority row shows `before → after (Δ)` so adding a 5th lower day visibly moves glutes from `⚠ red` to `✓ green` if it does. State coverage: loading skeleton, empty-routine suppression, no-vision fallback, single-day frequency-warning footer, all-priority-optimal celebrate, MEV-undefined fallback, draft-vs-active pill, sub-muscle drilldown.
- **Adherence Gap card on `/feed`.** Retrospective closed-loop verdict — when delivered routine volume falls short of planned for 3+ priority muscle weeks, surface the gap with date-shift framing of what continues if the pattern persists ("hip 100cm: Dec 2027 → Mar 2028 +82d"). HRT 1.4× compounding multiplier, capped at 0.95 stimulus shortfall to prevent catastrophizing. Per-muscle target elasticity table — glutes hit hip + SMM, lateral_delts hit shoulder targets, hip_abductors hit hip + WHR. One bad week breaks the streak (no panel after recovery). Silent by default — renders nothing when adherence is fine.
- **`vision_muscle_overrides` table** — per-vision per-muscle MAV + frequency overrides. Lets glutes accept 14-26 sets without the projection flagging the correct volume as "over" against the default 10-20. Seeded with the androgodess science-grounded numbers (glutes 14-26 freq≥3, lateral_delts 8-16 freq≥3, hip_abductors 8-16 freq≥2 evidence:'low', core 8-16 freq≥3). Composite-key change_log emits `vision_uuid|muscle_slug` row identifiers; locally synthesized as a single string PK so generic Dexie bulkDelete works through the sync engine.
- **Lateral-delt sub-muscle resolution (option b).** New `exercises.lateral_emphasis` tag flagged on lateral-raise variants. Routine projection derives a virtual `delts_lateral` row from sets touching tagged exercises so Lou's #1 transformation goal (shoulder cap specialization) gets verdict-level visibility instead of being hidden inside an aggregate "delts: optimal" reading.
- **`workout_routines.cycle_length_days` + `frequency_per_week`.** Disambiguate weekly-cycle routines from cycle-rotated ones. A 4-day routine on a 9-day cycle delivers ~3.1×/wk effective frequency, not 4×/wk — the projection now reflects that honestly.
- **`workout_routine_sets.target_rir`.** Routine template target proximity-to-failure. Without populated `target_rir`, the projection's RIR weighting collapses to charitable-default 1.0 and effective_set_count silently equals raw `set_count` — surfaced as `⌀ uncertain` zone with a footer rollup pointing to the fix instead of a confident green tick from missing data.

### Changed

- **RIR weighting moves from 4-tier to 5-tier** (TD2 ACCEPTED). `RIR 5 = 0.25` (was `0.0`). Pump finishers at RIR 5 aren't worthless; the new tier preserves that signal. RIR 0 (failure) stays at 1.0 — same hypertrophy stimulus as RIR 1-3, extra fatigue cost, no bonus. Mirrors `src/lib/training/volume-math.ts`. Both the SQL aggregation in `getWeekSetsPerMuscle` AND the new TS projection use identical math; conformance test guarantees no drift.
- **`/feed` PrescriptionCard unchanged in behavior** — Volume Fit is design-time guidance, not adaptive prescription. AdherenceGap copy is retrospective ("you've been delivering 57%") not prospective ("PUSH glutes +2"). The two surfaces stay deliberately complementary per the "no two coaches" rule in CLAUDE.md.

### Notes

- This shipped via `/autoplan` with seven independent voices (Codex × CEO/Design/Eng, Claude subagent × CEO/Design/Eng, Androgodess PT × CEO/Eng-math). All seven returned RESHAPE on the original draft. The locked plan + decision log live in `docs/plans/routine-volume-fit-check.md`.
- Migration 044 is fully idempotent (`IF NOT EXISTS` on every ALTER/CREATE; `ON CONFLICT DO NOTHING` on the seed). The androgodess vision overrides only seed against the active vision row; if `vision-androgodess-001` wasn't `status='active'` at migration time, the seed silently inserts nothing — re-run manually via SQL.
- `lateral_emphasis` tag was applied to ~5 catalog exercises (lateral raise variants, cable Y raise) by the migration via title-prefix LOWER LIKE matching. New variants added later won't auto-tag — flag for catalog hygiene.

### Tests

- `volume-math.test.ts` (48 tests) — RIR tier behavior, primary/secondary credit, in-both-arrays, kg_volume aggregation, vision override resolution, range-driven volumeZone classifier. Property assertions: effective ≤ raw, primary wins, no double-count.
- `routine-projection.test.ts` (19 tests) — 8 fixture scenarios including the load-bearing 5-day LULUL motivating case (proves glutes lands `optimal + freq=3 green` with overrides applied; current 4-day correctly reads `under + freq red`).
- `adherence-engine.test.ts` (15 tests) — catastrophizing caps (1 bad week / 2 bad weeks both produce no panel), 3-week threshold fires, one good week breaks the streak, ratio clamping, HRT compounding amplifies slip, slip bounded at 28d max per metric, two-zone model never multiplies into single number.
- 1617 / 1617 total green on main after merge.

### Fixed

- **Bundled exercise hydration missing `lateral_emphasis`** — caught at `next build` time by TypeScript, fixed during /qa pass. Vitest didn't exercise the bundled-hydration code path; build did. One-line charitable default added to match the v22 Dexie upgrade hook.

## [0.9.4] - 2026-05-06

### Fixed

- **Auto-recover from iOS WKWebView IndexedDB eviction.** iOS suspends the WebView's IndexedDB worker when the app stays backgrounded long enough; on resume, every Dexie call throws `UnknownError: Connection to Indexed Database server lost. Refresh the page to try again` and stays broken until the page reloads. The sync engine's push/pull catch blocks now match that exact message and call `window.location.reload()` instead of parking behind a red sync-error pill — IDB reconnects on the fresh page and the next foreground sync clears the dirty queue. 30-second sessionStorage cooldown guards against a reload loop.

## [0.9.3] - 2026-05-05

### Added

- **Cardio · weekly minutes row in the 12-Week Trends section.** TwelveWeekTrendsSection grew a 6th row (between HRV and the compliance note) plotting total cardio minutes per ISO Mon→Sun week from HealthKit, with a direction chip vs the umbrella weekly target from the active body plan. Tappable like the other rows — opens TrendDetailModal with the full series. The /autoplan dual-voice review surfaced this as the genuine signal gap (Section B already plots priority muscles, anchor lifts, bodyweight, HRV — cardio was missing); the broader page-wide week-scrubber + new W-o-W section idea was deferred for 4 weeks of v1.1 usage data first.
- **`GET /api/health/cardio-trend?weeks=12` endpoint.** Loops the existing `computeCardioWeek` helper per ISO Monday and returns weekly totals oldest→newest, plus the umbrella target. Mirrors the cardio-week envelope: same 401/503/400/no_targets/ok status shapes. Default 12 weeks, max 12 (so the trailing window stays inside `computeCardioWeek`'s 90-day budget).

### Notes

- No schema change. No new aggregation logic — pure composition over the v1.1 cardio-week aggregator.
- The row collapses cleanly to its empty state when fewer than 4 weeks are available, when no cardio targets are set on the active plan, or when HealthKit isn't connected.

### Tests

- 11 new tests on `cardio-trend/route.test.ts` — auth, not_connected, invalid weeks, default=12 count, weekly array shape, oldest→newest order, 7-day window inclusivity, no_targets envelope passthrough, totals aggregation.
- 3 new tests on `TwelveWeekTrendsSection.test.tsx` — row renders with target suffix, row renders without target suffix, falls back to empty state under 4 weeks. Existing label/empty-state tests updated for the new 6-row layout.

## [0.9.2] - 2026-05-05

### Added

- **Metric selector on the InBody trend chart.** Was hard-coded PBF%; now a horizontally-scrollable chip strip with 13 metrics grouped build → segmental → fat → summary. Default switched to **Skeletal Muscle Mass** — plan-aligned for an intentional build phase, and the androgodess monitoring protocol explicitly flags InBody PBF% as unreliable for Lou (~7–8 points low). Section heading, tooltip, goal reference line, and previous-scan reference line all reactively follow the selected metric. Includes the segmental-lean rows (R/L arm + R/L leg) named in `north_star_metrics` so shoulder-cap and glute-shelf progress now have a visible trend, plus `seg_fat_trunk_pct` for HRT-driven redistribution.
- **Weight option on the Log/Trend chart.** Bodyweight was already shown as a history list below the chart; now also selectable in the trend strip and rendered as a single-series line in the user's display unit (kg/lb) — same data source (`bodyweight_logs`) as the history rows so the values match. Trend section now appears when only bodyweight has 2+ entries (previously gated on cm-site logs).
- **Multi-site overlay handling.** Selecting Weight on `lg:+` switches to the single-series chart (mixing kg with cm on one axis would have been wrong); cm sites still produce the all-five overlay.

### Changed

- **`<ChipGroup>` extracted** to `src/components/ui/ChipGroup.tsx` — used by both trend selectors. Variants: `wrap` (Log selector, 6 short chips) and `scroll` (InBody selector, 13 longer chips). Each chip carries `aria-pressed` and a `focus-visible` ring so keyboard tabbing through the strip is visible.

### Notes

- No schema changes. Segmental lean / trunk fat % were already populated on every InBody scan row and surfaced on the detail page; they were just not exposed in the trend selector before.

## [0.9.1] - 2026-05-04

### Fixed

- **iOS exercise page now reflects edits without a force-quit.** `/exercises` held `selectedExercise` as a `useState` snapshot of `allExercises` at click time, so edits made via `ExerciseDetail` (description, tracking_mode, image regeneration, muscle map, steps, tips) didn't reflow until the page remounted. Capacitor's WKWebView keeps the page alive across iOS app suspension, so the only way to clear the stale state was to force-quit the app — Lou's reported "I literally have to close the app." Fix: store keys (`selectedUuid`, `selectedMuscle`, `selectedEquipment`) and derive live objects via `useMemo` over the live `useExercises()` query on every render. Auto-clears `selectedUuid` when the open exercise leaves the visible list (deleted / hidden).
- **`/workout` [i] info modal defensive fix.** Same snapshot pattern — `infoExercise` was a `useState` of the exercise object. Doesn't manifest as a bug today (`chrome="modal"` gates all mutation UI), but now stored as `infoExerciseUuid` and derived from the live current-workout via `useMemo`. Identity stays stable across 500ms rest-timer ticks (so the `React.memo` on the modal still skips renders), but Dexie writes flow through immediately.

### Added

- **`useRefetchOnVisible` hook** (`src/lib/useRefetchOnVisible.ts`) — wires `document.visibilitychange` + Capacitor `App.appStateChange` so server-fetched pages refresh on iOS foreground transitions. Belt-and-braces because iOS visibilitychange has been flaky across versions. Wired into `/projections`, `/inspo`, `/measurements/inbody/compare`, `/nutrition/history`. MCP uploads, other-device changes, and background sync now appear without reload.

### Architecture notes

- **Why this is a single-page bug class.** The Dexie + `useLiveQuery` layer correctly propagates updates to consumers. The bug only manifests when a parent component snapshots a live row into `useState` before passing it to a mutating child. Audited the rest of the app: `/history`, `/plans`, `/workout` mostly consume only the UUID and re-query live (safe). The `/exercises` page was the only genuine offender; `/workout` [i] modal and the API-fetched gallery pages got defensive fixes.
- **Why store UUIDs over objects.** Survives Dexie writes (live query rotates the array reference), keeps `React.memo` working (prop identity stays stable through unrelated re-renders), and forces every render to re-derive from the source of truth.

### Tests

- Snapshot regression test for `/exercises` (3 cases: live re-render of detail, auto-back when the open exercise is deleted, filtered list reactivity).
- 5 unit tests for `useRefetchOnVisible` (no fire on mount, fires on visibilitychange, listener cleanup, Capacitor `appStateChange` subscription + cleanup, latest-callback-after-rerender).
- Pre-existing 1392 tests all still pass; total suite now 1454.

## [0.9.0] - 2026-05-04

### Added (in-workout stopwatch for time-based exercises)

- **Stopwatch overlay on time-mode SetRows.** Tap the new Timer icon next to the duration input to launch a count-up stopwatch. Stop manually; elapsed seconds drop into the duration field. Mirrors the rest-timer's background-safe persistence model (`Date.now()` against absolute `startedAt`, separate `rebirth-stopwatch-state` localStorage key) so a running rest timer and stopwatch coexist. New files: `src/app/workout/stopwatch-utils.ts` (pure-fn state machine + tests), `useStopwatch.ts` (hook with appStateChange resync), `StopwatchSheet.tsx` (full-screen sheet with all 7 phases).
- **Switch-sides countdown for unilateral exercises.** New `exercises.has_sides` boolean (toggle on the exercise edit page) drives a 10-second "switch sides" countdown after side 1 stops, then resumes counting up for side 2. Logs the longer-of-two side as `duration_seconds` with a 1.5s confirmation card showing both side times. Force-quit during the switch lands on a new `switch_expired_paused` phase that requires explicit "Start second side" rather than silently crediting time-away. Sticky resume bar surfaces when the sheet is closed but the stopwatch is still running.
- **RPE 1-10 chip strip replaces RIR on time-mode SetRows.** RIR is the wrong proxy for held-duration sets — the literature uses RPE for isometrics. New chip strip (own row, post-completion) with anchor labels at chips 6-10 (`easy / mod / hard / near / fail`). Legacy time-mode rows with `rir` populated but no `rpe` pre-fill the chip strip from `10 - rir` (display only — not written until the user taps a chip).
- **Server-side RIR bridge.** `pushWorkoutSet` derives `rir = clamp(10 - rpe, 0, 5)` for time-mode rows so the existing RIR-weighted `effective_set_count` SQL at `queries.ts:1367` keeps crediting hypertrophy volume without a SQL change. Single source of truth: client only writes `rpe` for time-mode; server overwrites `rir`. Defends against PWA two-tab races and bridge-formula drift.
- **Two-tab arbitration.** `ownerTabId` + `storage` event sync — only the tab that opened the stopwatch commits on Stop; other tabs render read-only with a recovery affordance.
- **Has-sides toggle on exercise edit page.** iOS-style switch on `/exercises/:uuid` page chrome (mirrors the existing tracking_mode toggle).

### Changed

- **Migration 041** drops the legacy `workout_sets_rpe_check` (allowed 7.0–10.0 only — would have rejected the new 1–10 range) and adds `CHECK (rpe IS NULL OR (rpe BETWEEN 1 AND 10 AND rpe = floor(rpe)))`. Defense-in-depth: rejects decimal RPE at the database boundary regardless of which client wrote it.
- **`handleComplete` skips `rir` auto-fill on time-mode rows.** First-completion auto-fill (carry-over from previous session's RIR) was silently faking the RPE→RIR bridge for time-mode sets — Lou would tap "complete" and the row got `rir = rirDefault` before any RPE was selected, credit-pinning the muscle math. Now time-mode requires an explicit RPE chip tap. Rep-mode behavior unchanged.
- **Dexie v20** upgrade backfills `has_sides = false` on existing exercise rows. Adds a `versionchange` handler that closes + reloads when a future SW activates mid-workout.

### Architecture notes

- **Why not unify with `useRestTimer`.** Both hooks share `appStateChange` listener, persistence pattern, and `setInterval` poll, but they differ on direction (count-up vs countdown), persisted shape, and state-machine semantics. Plan-eng-review agreed: unifying behind a `useTimer({direction})` would couple a state machine into a primitive used by every SetRow — wrong abstraction. Two hooks, separate localStorage namespaces, no contention.
- **Why server-side bridge instead of client-side.** Three problems with deriving `rir` in client `mutations.ts:updateSet`: (1) the function lacks exercise context — would need a Dexie load that races under concurrent tabs; (2) two PWA tabs racing on different `rpe` values would push inconsistent `(rpe, rir)` pairs; (3) any future bridge-formula change is irreversible because the server already stored the bridged value. Server-side derivation makes `rpe` the single source of truth.
- **Why longer-of-two for unilateral, not sum.** Each side is its own work bout. Summing would double-count and compare unfavorably against historical bilateral holds. Confirmation card surfaces both side times before close.
- **Why `setInterval(1000ms)` for stopwatch (not 500ms like rest timer).** Count-up display only ever shows whole seconds. Halving the wakeup rate matters under iOS background-CPU budget when both timers run.
- **Why audio is inlined, not extracted.** Plan called for a shared `playBeep` util with single AudioContext + 200ms collision lock. Deferred — single-user app, low collision risk in practice. TODO documented in `useStopwatch.ts`.

### Tests

- 21 new tests in `src/app/workout/stopwatch-utils.test.ts` covering the full state machine: `restoreState` switch-expired-paused gating, `onStop` for non-unilateral / side-1 / side-2, `onSwitchComplete`, `onResumeFromPause`, `onLogFirstOnly`, `finalDurationSeconds` longer-of-two, `isOwnerTab` two-tab arbitration. Total suite: 1407 tests, all passing.
- Build green; tsc has 12 fewer errors than main pre-merge (test fixture cleanup along the way), zero new production errors.

### Process

- First feature shipped via `/autoplan` with CEO phase explicitly skipped at the user's request. Design + eng dual voices ran (Codex + Claude subagent each). 35 auto-decisions logged in `PLAN-exercise-timer.md`. Notable critical fixes the reviews caught before any code was written: legacy RPE check constraint blocking the new range, restore-after-expired-switch silently crediting fake elapsed, client-side bridge race across PWA tabs, `handleComplete` auto-fill faking the bridge.

## [0.8.2] - 2026-05-04

### Changed (Recent Workouts visual differentiation)

- **Recent-workout rows in `HealthSection` now color-code by activity family** instead of every row showing the same blue Activity glyph. Mirrors the existing pastel triad already used by rep-windows + muscle chips: purple = strength, blue = cardio, pink = recovery. Same `bg-{color}-500/15` + `text-{color}-300` pattern, so it feels native rather than a new palette. Per-type icons: Dumbbell (Strength/Functional/Core), Zap (HIIT), Footprints (Walking), Mountain (Hiking), Activity wave (Running/Elliptical/Mixed/Cross/default), Bike (Cycling), Waves (Rowing/Swimming), Dog (Dog Walk), Flower2 (Yoga). New helper at `src/lib/workout-style.ts` keyed on the post-remap activityType strings emitted by the iOS HealthKit plugin (so Hiking → Dog Walk remap from `healthkit.ts` resolves to the rose/Dog style, not the sky/Mountain one).
- **Tailwind content-scan now includes `src/lib/**`.** Previously the JIT scanner only covered `src/pages`, `src/components`, `src/app`, so any class string constructed inside a `lib/` helper got pruned at build time. Caught during browser validation when the new style helper's tints rendered as plain transparent circles. Fix is general — any future `lib/` helper that builds class names will now work without a per-class safelist workaround.

## [0.8.1] - 2026-05-04

### Added (MCP chunked-upload protocol)

- **Five new MCP tools** (`start_upload`, `upload_chunk`, `finalize_progress_photo`, `finalize_inspo_photo`, `finalize_projection_photo`) that let Claude iOS upload images in chunks. Fixes "Error: No approval received" — Anthropic's mobile MCP client silently rejects tool calls whose serialized arguments exceed a sub-64k char threshold, which made the existing `image_base64` path unusable from chat for any image larger than ~48KB. Protocol: `start_upload(kind)` returns an `upload_id` + recommended chunk size; caller sends N chunks of ~30k base64 chars each via `upload_chunk(upload_id, sequence, data_b64)`; `finalize_<kind>_photo(upload_id, ...)` reassembles + pushes to Vercel Blob + creates the photo row. Three finalize tools (one per kind) over a single conditional schema for cleaner Claude tool-call accuracy. Existing `upload_progress_photo` / `upload_inspo_photo` / `upload_projection_photo` tools retain their `image_base64` / `image_url` paths for non-Claude clients (server-to-server, curl, future Codex agents); their descriptions now point Claude clients at the chunked path explicitly.
- **`mime_type` allowlist on `start_upload`** — rejects non-image MIME types with `MIME_INVALID` so Vercel Blob can never be coerced into serving `text/html` or `application/javascript` from the public bucket. Defense in depth on a single-trusted-operator deployment.
- **Migration 039 (`mcp_upload_chunks.sql`)** — adds two staging tables (`mcp_upload_sessions`, `mcp_upload_chunks`) with `STORAGE EXTERNAL` on the base64 chunk column to skip useless LZ compression, plus a `created_at` index for the GC sweep. Opportunistic GC runs on every `start_upload` (deletes orphan sessions older than 24h); explicit cleanup on every successful finalize.

### Architecture notes

- **Why chunked-tool-call protocol over presigned URLs:** The MCP spec has no native file-upload primitive, and Vercel Blob's client-direct path (`@vercel/blob/client`) requires the caller to issue real HTTP PUTs. Claude can't drive PUTs from chat, only MCP tool calls. Postgres staging is the only path that lets Claude complete an upload end-to-end inside the MCP boundary. (This already-investigated tradeoff is captured as a project learning.)
- **SQL combine for latency:** `upload_chunk` does INSERT + SELECT-totals in a single CTE (1 Postgres roundtrip per chunk, not 2). `loadAndAssemble` does session lookup + chunk fetch in a single LEFT JOIN. For a 1MB image at ~47 chunks on Neon serverless HTTP, this saves ~10s of cumulative latency.
- **Adversarial-review hardening (commit 5191f11):** Both /review's Claude adversarial subagent and the Codex pass independently flagged the same four issues that single-user trust does NOT neutralize — sequence DoS via INT_MAX (one legitimate row would make the missing-chunk loop allocate billions of ints), cap not re-checked at finalize (caller could ignore SIZE_CAP_EXCEEDED), invalid UUID hitting Postgres 22P02 before the FK check, and orphan blob on DB-create failure. All four are now guarded with dedicated tests.
- **Lazy-load `@vercel/blob`** inside finalize via dynamic `await import()` — keeps the SDK out of the cold-start path for every other MCP tool call (read tools vastly outnumber finalize calls).
- **`createPhotoOrCleanupBlob` helper** wraps each `dbCreate*Photo` in a try/catch that `del()`s the blob on any DB failure. Without this, a Postgres timeout / FK violation on `source_progress_photo_uuid` / invalid `taken_at` would leak a public blob and silently cost storage forever.

### Tests

- 29 new tests in `src/lib/mcp/upload-tools.test.ts` covering happy paths, every error envelope code (`KIND_INVALID`, `MIME_INVALID`, `SESSION_NOT_FOUND`, `MISSING_CHUNKS`, `EMPTY_UPLOAD`, `KIND_MISMATCH`, `POSE_REQUIRED`, `POSE_INVALID`, `SIZE_CAP_EXCEEDED`, `DECODE_FAILED`, `INVALID_ARGS`), idempotent chunk re-send, GC behavior, the four hardening guards (sequence cap, UUID pre-validate, finalize cap re-check, orphan blob cleanup), and tool-registration regressions for both new and existing surfaces. End-to-end QA: 30/30 scenarios passing live against the dev server + Neon DB + Vercel Blob.

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
