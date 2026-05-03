## Photos compare v1.1 follow-ups (deferred from 2026-05-03 v0.7.7 ship)

Lou-requested after using the new /photos/compare page (chunks 1+2 shipped
2026-05-03):

- [ ] **Extend `target_horizon` to long-arc tags.** Current options are
      `3mo / 6mo / 12mo`. Add `18mo / 2yr / 3yr` so projections aligned with
      the Androgod(ess) 18-month plan + further-out vision photos can be
      labelled accurately. Bump the upload sheet picker, the badge renderer
      on PhotoCard / TimelapseViewer, and the `afterLabel` fallback in
      `/photos/compare`.

- [ ] **Inline edit of `target_horizon` and `pose` on a projection.** From
      `/photos/compare`, surface a small edit affordance on the active
      projection (next to the "Adjust projection" button or inside the
      metadata strip) that opens a quick picker for both fields. Avoids
      having to bounce out to `/projections` to retag. Existing
      `update_projection_photo` MCP tool already accepts `pose` +
      `target_horizon`, so the API is in place — just needs the UI surface.

- [ ] **Render projection edit UI on /photos/compare itself ("in front,
      without doc").** Lou's framing: every UI affordance for editing a
      projection should live inside the compare page, not in a separate
      docs page or a deep settings dive. Same place you're looking at the
      photo is the same place you change its tags. Folds into the inline
      edit item above.

- [ ] **Horizontal alignment offset (`crop_offset_x`).** Current
      `crop_offset_y` only solves head-y anchoring. For photos taken at
      different camera distances or where Lou stood off-centre, the
      person's body-centre line drifts horizontally and the comparison
      modes (especially Side-by-side / Blend / Silhouette) misalign on the
      x-axis. Add a second offset axis to mirror crop_offset_y semantics:
      column on the 3 photo tables (migration), Dexie bump, types update,
      `offsetTransform()` in `src/lib/photo-offset.ts` extends to take both
      x + y, AdjustOffsetDialog gets a horizontal drag handle alongside the
      existing vertical one. Same render path picks it up across all 5
      modes.

---

## Plan-progress: extend source-mapping for circ + InBody fields

Surfaced 2026-05-03 during Androgod(ess) plan north_star rebuild. `get_plan_progress`
auto-populates `current_value` for some metric keys but returns `null` for most:

- ✅ Mapped: `weight_kg` (reads from body_comp).
- ❌ Unmapped: `circ_hip_cm`, `circ_abdomen_cm`, `circ_right_arm_cm`, `circ_right_thigh_cm`,
  `shoulders_cm`, `shoulder_width_cm`, `whr`, `smm_kg`, `body_fat_mass_kg`,
  `seg_lean_right_arm_kg`, `seg_lean_right_leg_kg`.

Today's workaround: monthly sweep playbook reads `get_body_comp` + `list_inbody_scans`
directly and computes progress in-flight. Works but means `get_plan_progress.current_value`
is mostly null, so the on-track boolean is null too. Backlog item:

- [ ] Extend the source-mapping inside `get_plan_progress` (likely in
  `src/app/api/mcp/plan-progress/...` or wherever the metric→source resolver lives) to
  cover circ_*, shoulders_cm, shoulder_width_cm, whr (computed from waist÷hip),
  and the latest InBody fields (smm_kg, body_fat_mass_kg, seg_lean_*).
- [ ] Once mapped, remove the sweep-time direct reads from the `/androgodess` skill
  playbook.

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

## Week page v1.2 follow-ups (deferred from 2026-05-03 v1.1 ship)

Plan: `~/.gstack/projects/lewcart-Iron/feat-week-v1.1-plan-20260503-160000.md`

V1.1 (v0.8.0) shipped: Decision-engine prescription card, cardio compliance tile (split-by-intensity), data-sufficiency badges, photo cadence footer, hip-abduction catalog audit, `get_health_cardio_week` MCP tool. Previous v1.1 follow-ups from v0.7.6 either shipped, were reframed at the autoplan gate, or moved to v1.2 (see below).

V1.2 follow-ups (gated on data accumulation OR schema additions):

- [ ] **Per-muscle landmark personalization UI.** Deferred at /autoplan gate — both reviewers + Lou agreed 2 weeks of data wasn't enough to override RP-2025 defaults. Wait for the data-sufficiency badges to mature (≥8 weeks per muscle), then add a `/strategy` editor section for per-muscle MEV/MAV-min/MAV-max overrides on top of RP defaults. Schema: `body_plan.programming_dose.landmark_overrides: Record<MuscleSlug, Partial<Pick<VolumeLandmark, 'mev'|'mavMin'|'mavMax'>>>` (additive JSONB). Resolver: wrap `landmarkFor(slug)` in `resolveLandmark(slug, plan)` overlaying user values on RP-2025 defaults. New MCP tool `update_vision_landmarks(overrides)`.
- [ ] **Anchor-lift configurability UI.** Same deferral reason — defer until Lou hits a real mismatch. Then add a `/strategy` editor section: per-priority-muscle dropdown of top-5 most-logged exercises tagged with that muscle (last 12 weeks) + "use auto-resolved" option. Schema: `body_plan.programming_dose.anchor_lift_overrides: Record<MuscleSlug, string>` (exercise UUID). Resolver: extend `resolveAnchorLift()` with optional `plan` arg. New MCP tool `set_anchor_lift_override(muscle, exercise_uuid?)`.
- [ ] **HR-zone cardio classification.** Dropped from v1.1 at eng review — `healthkit_workouts.avg_heart_rate` is workout-average only and systematically misclassifies HIIT (warmup + intervals + cooldown average into zone-2 territory). Add per-second HR samples to `healthkit_workouts` (or a sibling `healthkit_workout_samples` table), then enable HR-zone classification as the primary path with activity-type fallback. Until then, classification is activity-type-only and labeled internally as "estimated cardio categories."
- [ ] **HRT trough-day chip on the prescription card.** Dropped from v1.1 at eng review — `hrt_timeline_periods` schema lacks `drug` (or `route`) + `cycle_days` columns, so injection-cycle inference isn't shippable without hardcoding Lou's regimen (brittle). Add migration: `ALTER TABLE hrt_timeline_periods ADD COLUMN route TEXT, ADD COLUMN dose_interval_days INTEGER`. Then derive `day_of_cycle` from latest dose timestamp + interval, and the engine adds a `[trough day]` reason chip on REDUCE recommendations landing on the second half of the injection cycle.
- [ ] **Mesocycle / deload state machine.** v1.1 surfaces the deload signal inside the prescription card as a one-shot recommendation. Full state machine (auto-scheduled deload weeks, regularized mesocycle accounting) waits until Lou trusts the v1.1 prescription signal in practice.
- [ ] **Per-muscle 8-week effective-set history.** v1.1's data-sufficiency badge + prescription engine confidence gate use a conservative approximation (overall `rirByWeek.length` capped at 8) for ALL priority muscles. Replace with a true per-muscle scan in `week-facts.ts` so a muscle that's been trained 6 weeks reads as 6, not as 8 just because Lou trained anything that week.
- [ ] **Per-muscle RIR drift in week-facts.** v1.1 passes `rir_drift: null` for all priority muscles to the prescription engine — engine treats null as 0. Compute median RIR per priority muscle for the last 7 days vs the 7 days before; surface drift to the engine. Without this, the per-muscle REDUCE recommendation never fires from RIR signals (only from zone='risk').
- [ ] **Per-muscle anchor-lift slope.** v1.1 passes `anchor_slope: null` and `anchor_lift_name: null`. Wire from the existing `anchor-lift-trend.ts` per-muscle output so the engine can fire `e1rm_stagnant` reason chips and the in-zone+slope-up PUSH variant.
- [ ] **Frequency-picker UI for MRV.** v1 already stores MRV as `mrvAt(freq)` exactly so a picker can be added without schema change. Surface a frequency picker on the Strategy page so Lou can shift MRV columns when the training frequency changes mid-mesocycle.
- [ ] **`projection_photos` in local-first sync.** v1.1's photo cadence footer ships the secondary "Compare projection" affordance dark because `projection_photos` isn't in `SYNCED_TABLES` yet. Add it, then enable the conditional Compare link in `PhotoCadenceFooter`.
- [ ] **Cardio MCP tool: `start_date`/`end_date` parameter validation.** The HTTP route validates window-size; the MCP tool should mirror those checks once Lou actually exercises non-default windows from MCP.

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

