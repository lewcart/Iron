## Dark mode (app-wide)

Surfaced during 2026-05-03 Week page /qa verify pass. **Pre-existing — not a
Week page regression.** Manually setting `<html class="dark">` in DevTools
does not flip any page (body stays `rgb(246,247,248)`, cards stay
`rgb(255,255,255)`).

Root cause: nothing ever applies the `.dark` class to `<html>`.
- `src/app/globals.css:37-58` — `.dark { ... }` token block exists and is
  correct (deep-navy palette inside `@layer base`).
- `tailwind.config.ts:4` — `darkMode: ["class"]` is set correctly.
- `src/app/layout.tsx:46` — `<html lang="en">` ships with no class management.
- Repo-wide search: zero call sites for `classList.add('dark')`,
  `next-themes`, `prefers-color-scheme` listeners, or any theme toggle.

Result: every `dark:*` Tailwind utility on every page is dead code (it
compiles to a CSS rule that never matches because `.dark` is never on the
ancestor chain). The token-level `--background` / `--card` overrides
inside `.dark` likewise never fire. The QA report's note that the runtime
`.dark` rule "is missing from the loaded stylesheet" is consistent with
PostCSS / Tailwind purging it as unused content during JIT — the source
is fine, it just gets dropped because no runtime DOM ever matches it.

One-line fix sketch (to be done as a separate small PR — out of scope for
the Week page commit):
1. Add a tiny ThemeProvider in `src/app/layout.tsx` that reads
   `prefers-color-scheme` (and optionally a stored preference from
   localStorage) and sets `document.documentElement.classList.toggle('dark', isDark)`
   on mount + on `change` of the media query.
2. Add a Settings → Appearance toggle (System / Light / Dark) that writes
   to localStorage.
3. Verify by visiting `/strategy` and `/feed` in both modes — both should
   flip card + body backgrounds in tandem.

Until then, the entire app is light-mode-only by design (just not by
deliberate decision). Defer the toggle wiring rather than blocking the
Week page on it.

## Week page follow-ups (deferred from 2026-05-03 /autoplan, post-rebrief)

Plan: `~/.gstack/projects/lewcart-Iron/feat-week-page-plan-20260503-125153.md`
Test plan: `~/.gstack/projects/lewcart-Iron/lewis-week-page-test-plan-20260503-125153.md`

V1.1 follow-ups (after Week page V1 ships):
- [ ] **Catalog audit: hip abduction exercise.** No exact match in `src/db/exercises.json` today (only `Cable Hip Adduction` — opposite muscle). Add a hip-abduction exercise + tag it so the e1RM trend row for hip abductors has a target. ~15 min.
- [ ] **Per-muscle landmark personalization UI.** V1 uses RP-2025 defaults from `src/lib/training/volume-landmarks.ts`. After Lou has 2-3 mesocycles of data, add a UI to override per-muscle MEV/MAV/MRV based on personal recovery curves.
- [ ] **Anchor-lift configurability UI.** V1 uses seed config in `src/lib/training/anchor-lifts.ts`. UI lets Lou pick a different anchor lift per priority muscle (e.g., switch glute anchor from Hip Thrust to RDL during a hinge mesocycle).
- [ ] **Mesocycle / deload state machine.** Combine HRV trend + RIR drift + e1RM stagnation into a "you're at MRV, deload next week" surface.
- [ ] **Cardio compliance tile.** Plan dose says 240 min/week cardio floor; add a small ring once we're sure we have reliable cardio session tagging.
- [ ] **Photo cadence prompt.** Monthly footer prompt: "front-pose photo due in 6 days" — tied to projection comparison workflow. Surface on Week page footer, not as an inbox.

## Old Today + Inbox follow-ups (superseded by Week page rebrief 2026-05-03)

Plan artifact: `~/.gstack/projects/lewcart-Iron/feat-feed-redesign-plan-20260503-114052.md`.
Tests artifact: `~/.gstack/projects/lewcart-Iron/lewis-feed-redesign-test-plan-20260503-114052.md`.

V1.1 inbox sources to add after V1 ships:

- [ ] **Coaching note inbox source.** Needs migration: add `coaching_notes.actioned_at TIMESTAMPTZ` + `dismissed_at TIMESTAMPTZ`; include `coaching_notes` in `SYNCED_TABLES` (`src/lib/sync.ts`); bump Dexie version (v17). Then add inbox rule + `markActioned` mutation. ~1 day CC.
- [ ] **"Tonight: <routine>" Hero priority.** Implement `summary.todayPlanned` derivation: pick the routine with the longest gap since its exercises were last logged in the active plan. ~4-6 hr CC. See Codex eng review notes for the heuristic.
- [ ] **Plan reevaluation trigger evaluator.** Implement "BF% stalled 8 weeks" rule: read last 4 InBody scans, compute |Δ pbf_pct|, fire if < 0.5 over ≥ 56 days. ~3 hr CC.
- [ ] **HRT inbox source — product decision required.** `hrt_logs` was dropped (migration 020); CLAUDE.md says HRT adherence lives outside Rebirth. Options: (a) re-add an adherence schema; (b) integrate HealthKit medications via `get_hk_medication_summary`; (c) drop entirely and remove from Inbox spec. Currently dropped from V1.
- [ ] **Cross-page invalidation: photo upload.** Add `queryClient.invalidateQueries({ queryKey: ['feed'] })` to the progress photo upload mutation so projection nudge clears immediately on photo capture.
- [ ] **Pull-to-refresh haptic.** Wire `@capacitor/haptics` light impact on PTR trigger. Confirm whether plugin is already installed.
- [ ] **Mount-stagger animation.** Optional polish. CSS-only stagger using `transition-delay` per card; only if it improves the feel.
- [ ] **Time-of-day adaptive Today.** Telemetry-driven: morning vs evening surface different inbox priorities. Consider after 2 weeks of V1 telemetry.
- [ ] **Kill-the-/feed-tab decision.** After 2 weeks of V1 telemetry, evaluate whether Today tab pulls weight vs the dock. If Lou opens it <30% of sessions, drop it and make Workout the default landing.

---

## Exercise image generation follow-ups (deferred from 2026-05-02 in-app gen ship)

- [ ] **Tests for the new image-gen flow.** Test plan artifact is on disk at
      `~/.gstack/projects/lewcart-Iron/feat-exercise-image-gen-inapp-test-plan-20260502-091008.md`
      and lists 22 tests across 5 new test files: route success/rollback paths,
      activate ownership predicate + concurrent-race 409, candidates list +
      `?request_id` recovery, prompt builder snapshots, manager component
      a11y/recovery. Tests deferred at /autoplan time to keep the
      implementation pass focused; should be the next concrete follow-up.
- [ ] **Vercel Pro+ tier preflight.** `maxDuration = 300` on
      `/api/exercises/[uuid]/generate-images` requires Pro tier. Hobby caps at
      60s and the route 502s mid-frame-2. Confirm tier before the first deploy
      that exposes the new flow externally.
- [ ] **Per-call AbortController on the OpenAI calls.** Two sequential
      `gpt-image-1` high calls have observed p99 ~150s each; back-to-back p99
      can saturate the 300s `maxDuration` with zero buffer for sharp resize +
      blob put + DB write. Wrap each `openai.images.{generate,edit}` in an
      AbortController with a per-call timeout (e.g. 130s) so the function
      fails fast and writes a clean `failed_frame*` job row instead of being
      killed by the platform mid-DB-write.
- [ ] **Pagination cursor IN-subquery refactor.** GET
      `/api/exercises/[uuid]/image-candidates?cursor=…` uses an
      `IN (SELECT batch_id FROM ... WHERE created_at < $cursor GROUP BY batch_id)`
      shape that's structurally O(rows²) per page. Fine at single-user volume
      (a handful of batches per exercise) but worth flattening to a direct
      `created_at <` comparison + tiebreaker on uuid if history ever grows
      large or starts feeling slow.
- [ ] **Candidate row pruning policy.** No upper bound on batch history per
      exercise, every regenerate inserts 2 rows forever. At ~80KB per
      `600×800` JPEG a year of regular use is still <10MB total Blob, but the
      DB row count grows monotonically. Decide on a soft cap (e.g. last 20
      batches per exercise, oldest-inactive auto-pruned) before storage cost
      becomes visible.
- [ ] **Orphan-blob cleanup on exercise delete.** `exercise_image_candidates`
      cascades on `exercises.uuid` deletion, but the cascade only drops DB
      rows — Vercel Blob URLs are orphaned. Add a server-side hook that
      enumerates candidates and `del()`s each blob URL before the cascade
      fires. Defer until exercise deletion is actually wired up in the UI.
- [ ] **Migration filename hygiene cleanup.** Pre-existing 028 collision
      (`028_exercise_uuid_dedupe.sql` + `028_rir_column.sql`) and 029 gap
      noted in 031's comment. Lexicographic sort makes 031 deterministic but
      the duplicate-028 is hygiene debt. One-line follow-up PR: rename one of
      the two 028s to 029_<name>.sql if neither has been applied to prod
      (otherwise leaves a phantom row in `schema_migrations`).
- [ ] **Cost-attack rate limit.** `NEXT_PUBLIC_REBIRTH_API_KEY` ships in the
      public JS bundle, so anyone visiting the PWA could scrape it and
      trigger unbounded ~$0.50/call generations. Single-user threat model
      accepts this for now (`/review` decision 2026-05-02), but if the URL
      ever leaks more broadly, add a soft daily cap:
      `SELECT COUNT(*) FROM exercise_image_generation_jobs WHERE started_at > NOW() - INTERVAL '1 day'`
      and reject 429 over a configured ceiling (e.g. 20/day = $10).

## iPad — future work (deferred from 2026-04-20 web-first pivot)

- [ ] If iPad usage is real, evaluate native universal binary + one wedge feature
      (Pencil on progress photos OR InBody scan scrub-compare OR weekly review cockpit)
- [ ] If going native: update FitspoControlExtension + RestTimerLiveActivity
      device family to 1,2 for widget parity
- [ ] Consider Stage Manager / keyboard shortcut / macOS Catalyst surfaces at that point
- [ ] Chart enrichment polish round — currently added reference lines + multi-site overlay
      at lg:+; consider making trend metric selectable (weight, SMM, BMR) rather than hardcoded PBF%
- [ ] ios-section / ios-row standardization — both reviewers flagged as visual debt,
      out of scope for the 2026-04-20 iPad pass
- [ ] Success metric before graduating to native: N weekly iPad sessions, mostly on
      /measurements or /body-spec

## Local-first migration follow-ups (deferred from 2026-04-30 /plan-eng-review)

- [ ] **change_log retention policy.** After the local-first migration ships, the
      `change_log` Postgres table grows unbounded — every INSERT/UPDATE/DELETE on
      a synced domain table appends a row. With single-user usage, growth is slow,
      but after ~12-18 months first-pull pagination will start to feel sluggish and
      after years it could become real Postgres bloat. Add a Vercel cron in
      `vercel.ts` that nightly deletes `change_log` rows older than 90 days
      (or older than `MIN(last_seen_seq) - 90 days` if a "last seen" cursor is
      tracked server-side per device). The seq is monotonic so retention is just
      `DELETE WHERE created_at < NOW() - INTERVAL '90 days'`. Pre-req: confirm
      sync clients always pull within 90 days (foreground sync + 15s polling
      makes this safe).

- [ ] **Photo upload queue parity for body-spec and progress photos.** The
      `inspo_photos` Dexie table has full offline-capture + upload-retry
      semantics (Blob field, `uploaded: '0'/'1'` flag, retries until upload
      succeeds). The local-first migration only caches photo metadata + lazy
      thumbnails for body-spec/progress photos — capture-while-offline doesn't
      work for those flows. Extend the inspo_photos pattern: add Blob fields
      and upload retry to body-spec and progress photo Dexie tables; share an
      upload-queue worker. ~1.5 hours with CC. Reason for deferral: out of
      scope of the user-stated pain (instant render + MCP-seamlessness +
      no-zoom); offline photo capture is a separate UX win.

- [ ] **Evaluate generic `defineDomain<T>()` factory after migration ships.**
      Codex flagged that copy-pasting the mutations + useLocalDB pattern across
      8 domains will drift. We chose copy-paste to avoid premature abstraction.
      After shipping, audit the 8 mutations modules for actual drift. If two
      domains diverge on `_synced` filter or `_updated_at` semantics or sync
      envelope serialization → extract a `defineDomain` factory from working
      code. If they stayed clean → leave it. Don't extract until you can see
      the abstraction in three working examples.

- [ ] **Split mcp-tools.ts (2693 lines) and queries.ts (2552 lines) per-domain.**
      Pre-existing tech debt, surfaced during the local-first migration review.
      Both files become more painful to navigate after the migration adds 8 new
      domain mutation surfaces. Recommended split: `mcp-tools-{workouts,plans,
      nutrition,measurements,wellbeing,hrt,body-spec,exercises,inbody,inspo,
      healthkit}.ts` and similar for queries. Mechanical refactor, ~2 hours.

- [ ] **Audit remaining online fetches** (`/settings`, `/inspo`, exercise
      history/detail, workout repeat/history endpoints, HealthKit writeback,
      imports, upload routes, global capture components). Local-first covered
      the 8 main pages; auxiliary paths still hit production. Decide per-path
      whether to migrate or accept online-only.

- [ ] **HealthKit conflict resolution with newly-local domains.** When
      nutrition/InBody/bodyweight become local-first, HealthKit writeback +
      mirror records race with local writes. Define explicit precedence:
      who wins between (a) local Dexie write, (b) HealthKit→Postgres mirror
      write, (c) MCP write. Currently implicit; document and test.


## Nutrition upgrade follow-ups (deferred from 2026-04-30 nutrition page upgrade)

- [x] **Kill the legacy `/nutrition/page.tsx` monolith (937 lines).** Replaced
      with a server redirect to `/nutrition/today`. The legacy 937-line
      component lives at `/nutrition/week/page.tsx` (defaults to the Week
      template editor; the Today subtab inside it remains as a back-door to
      hydration + day-notes editing until the new Today page absorbs those).
      Sub-nav now points Week → `/nutrition/week`. **Completed:** v0.2.1 (2026-05-01)

- [x] **Extract existing nutrition MCP tools from `mcp-tools.ts`.** All 7
      pre-existing nutrition tools (`log_nutrition_meal`, `get_active_nutrition_plan`,
      `get_nutrition_plan`, `set_nutrition_day_notes`, `set_nutrition_targets`,
      `load_nutrition_plan`, `update_week_meal`) plus the DOW_NAMES /
      parseDayOfWeek helpers now live in `src/lib/mcp/nutrition-tools.ts`
      alongside the 8 new tools. The whole nutrition MCP surface is in one
      file. Main `mcp-tools.ts` is ~2200 lines lighter. **Completed:** v0.2.1 (2026-05-01)

- [x] **Workouts subtraction wiring on Today page.** New endpoint
      `GET /api/nutrition/today-workouts?date=YYYY-MM-DD` aggregates
      `total_energy_kcal` from `healthkit_workouts` for the local day; new
      hook `useTodayWorkoutCalories(date)` consumes it; CalorieBalanceCard
      now shows real burned calories instead of hardcoded 0. **Completed:** v0.2.1 (2026-05-01)

- [x] **Trigram threshold tuning for nutrition food search.** Both the HTTP
      endpoint (`/api/nutrition/foods`) and the MCP tool
      (`search_nutrition_foods`) now use `similarity(canonical_name, $q) >= 0.22`
      explicitly instead of the `%` operator. Per-query threshold beats the
      session-wide `pg_trgm.similarity_threshold` default of 0.3 — typos in
      branded foods like "Loreal latte" still match without affecting other
      queries. **Completed:** v0.2.1 (2026-05-01)

- [ ] **Materialize `nutrition_food_canonical` view.** Currently a regular VIEW
      that does `DISTINCT ON + count() OVER` on every query. Fast enough at
      ~10K-50K rows. After ~200K imports it will start to bite (typing search
      latency). Convert to MATERIALIZED VIEW refreshed nightly by a cron, OR
      denormalize a `food_name_canonical` column on `nutrition_food_entries`
      with a trigger. Deferred — current corpus is well below the threshold.

- [ ] **Photo log + AI text parser dock buttons.** The floating EntryDock
      renders camera + Aa buttons that show "coming soon" sheets. Real
      integrations: photo → meal-estimation via Claude Vision, text →
      meal-extraction via Claude with structured tool output. ~half a day
      each — proper prompt engineering + image upload pipeline + structured
      output validation + error UX. Deferred from this batch.

- [x] **Absorb hydration + day-notes editing into the new
      `/nutrition/today` page.** New `DayNoteSection` component on Today
      shows hydration in ml with +250/+500/+750 quick-add buttons, plus a
      day-notes textarea. Both auto-save (600ms debounce) via the existing
      `setDayNote` local-first mutation. The legacy `/nutrition/week` page
      shrinks from 937 lines to 398 — the Today subtab and all its state
      have been deleted; the file is now just the Week template editor.
      **Completed:** v0.2.2 (2026-05-01)

## HRT / Apple Health Medications follow-ups (deferred from 2026-05-01)

- [ ] **HealthKit medications dose-to-name linkage.** The iOS 26.3.1 medications
      API doesn't publicly expose a way to map an `HKMedicationDoseEvent` back
      to its parent `HKUserAnnotatedMedication`: the dose's
      `medicationConceptIdentifier` is nil despite a non-Optional Swift
      signature, and `HKUserAnnotatedMedication` exposes no UUID/syncIdentifier.
      Today's ship works around this by returning the medication list
      (`annotatedMedications: AnnotatedMedication[]`) and the dose stream
      (`medications: MedicationRecord[]`) as separate arrays, with every
      `medication_name` set to "Unknown medication". UI can render
      "you have these meds" + per-day dose totals from the unified stream.
      Full investigation, attempted fixes, repro steps, and four next-attempt
      strategies (descriptor-based query, per-medication predicate, Feedback
      Assistant report, wait for iOS 26.4) live in
      `docs/healthkit-medications-name-linkage.md`. Re-test on every iOS 26.x
      point release — the day a real medication name appears on a dose, this
      is closed.

- [ ] **Wire `requestPermissions` into foreground sync so new HK types
      auto-prompt.** Currently `connectHealthKit()` is the only call site
      for `HealthKit.requestPermissions()`, and that's only reachable via
      a button that hides once status is `connected`. Result: when a new
      build adds HK types, existing users never see the auth sheet for
      them. Fix: call `await HealthKit.requestPermissions()` at the top
      of `runForegroundSync` in `src/features/health/healthSync.ts`.
      Apple's runtime de-dupes — no UI shown if every requested type is
      already determined; only genuinely new types trigger the sheet.
      Bundle this with the medication re-enable so the flow tests
      end-to-end.

