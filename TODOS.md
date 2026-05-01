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

- [ ] **Re-enable the iOS 26 HKMedicationDoseEvent path safely.**
      `HealthKitPlugin.swift > fetchMedicationRecords` is currently a no-op
      after the initial real-API build crashed on launch on iPhone 17
      (iOS 26.3.1). Real implementation kept inline below the early
      `return` for fast re-enable. Steps to reproduce + fix:
      1. Plug iPhone in, install a crash-build (delete just the early
         `return` in `fetchMedicationRecords` and `read.insert(...)` in
         `allRequestedTypes`).
      2. Pull crash log: open Xcode → Window → Devices and Simulators →
         select Chill → View Device Logs, filter for "App". Or via
         `xcrun devicectl device info files` with the right domain
         identifier (CrashReporter directory).
      3. Most likely culprits to check first: (a) iOS 26 needs a new
         `Info.plist` usage description for medication reads —
         try adding `NSHealthDataMedicationsUsageDescription` alongside
         the existing `NSHealthShareUsageDescription`; (b)
         `HKUserAnnotatedMedicationQuery` faulting when called before
         the user has actually set up Medications in Health.app — wrap
         the dispatch in a try/catch and short-circuit if zero medications
         exist; (c) entitlement issue — iOS 26 may require an explicit
         `com.apple.developer.healthkit` entitlements key for medication
         data that the provisioning profile doesn't include yet.
      4. Once stable, add `HKObjectType.medicationDoseEventType()` back
         into `Self.allRequestedTypes()` so iOS surfaces the Medications
         toggle in Settings → Health → Rebirth.
      Owner: next session with USB-attached iPhone + Xcode device-log
      access. DB, sync route, MCP tools, and Meds tab UI all stay wired.

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

