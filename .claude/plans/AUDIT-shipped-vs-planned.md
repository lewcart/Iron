# Plan-vs-shipped audit (2026-05-01)

Scope: every plan/spec doc found in the repo, mapped to current `main` HEAD (`f2f2a70`).

## Plan docs reviewed

1. `PLAN.md` — Nutrition v3 (FitBee upgrade)
2. `PLAN-sleep.md` — Sleep tracking surface v2
3. PR #34 description — Vision/Plan strategic layer (no in-repo plan doc)
4. PR #14–#18 descriptions — Local-first migration (no in-repo plan doc)
5. PR #30 description — Exercise demo images + YouTube + AI gen
6. PR #38 description — Strength canonical muscle taxonomy (Phase 1 of 3)
7. CLAUDE.md — Strength workflow (mentions Phases 1/2/3)

No `.claude/plans/photos-browse-and-tag.md` exists yet — the parent agent hasn't written it. No `docs/` dir in the repo. The legacy `~/.gstack/projects/lewcart-Iron/lewis-sets-per-muscle-plan-20260501-134440.md` referenced by PR #38 lives outside this repo and was not read.

## Summary

- 7 plan surfaces reviewed
- ~62 promised items
- 47 fully shipped
- 9 partial / deferred-by-design (clearly marked in TODOs.md or follow-ups)
- 6 missing or deferred without ticket-level visibility (the things Lou is probably noticing)

The "missing-feeling" pieces cluster in three places:

1. **Strategy is read-only** — no editor, no write MCP tools, and the entry point moved off the TabBar to a card on /feed (so it can feel hidden)
2. **Strength Phases 2 + 3** — RIR collection and effective-set weighting promised in CLAUDE.md, none of it is in schema/UI
3. **Nutrition dock buttons (camera + Aa)** — visible "coming soon" stubs

---

## Per-doc breakdown

### PLAN.md — Nutrition FitBee upgrade

Status: Mostly shipped. Anything not shipped is captured in TODOS.md.

Step 1 — Primitives (Sheet, MacroRing, MacroBar, SearchInput)
- ✅ Shipped — `src/components/ui/sheet.tsx`, `macro-ring.tsx`, `macro-bar.tsx`, `search-input.tsx`

Step 2 — MCP refactor (extract `nutrition-tools.ts`)
- ✅ Shipped — `src/lib/mcp/nutrition-tools.ts` exists. v0.2.1 changelog confirms all 15 tools moved.

Step 3 — Local-first field gap (Dexie v5→v6, meal_name/template_meal_id/status)
- ✅ Shipped — Dexie now at v11 (per PR #38), schema migrated.

Step 4 — Migration 020 (approval, bands, pg_trgm, canonical view)
- ✅ Shipped — landed as migration **021** (not 020 — slot got reused for HRT). `src/db/migrations/021_nutrition_upgrade.sql` exists.

Step 5 — Layer 1 food search
- ✅ Shipped — `/api/nutrition/foods` route exists.

Step 6 — Today page extraction
- ✅ Shipped — full component split exists at `src/app/nutrition/today/` (CalorieBalanceCard, MacroCardScroller, MealSection, FoodRow, EditFoodSheet, AddFoodSheet, ApproveDayButton, SmartRepeatSuggestion, EntryDock, DayNoteSection — added in v0.2.2).

Step 7 — Goals sheet
- ✅ Shipped — `src/app/nutrition/goals/`

Step 8 — Layers 2+3 (OFF + USDA)
- ✅ Shipped — three-layer search confirmed in PR #24 description.

Step 9 — History page
- ✅ Shipped — `src/app/nutrition/history/`

Step 10 — Summary page
- ✅ Shipped — `src/app/nutrition/summary/`

Step 11 — 8 new MCP tools
- ✅ Shipped — `list_nutrition_logs`, `update_nutrition_log`, `delete_nutrition_log`, `bulk_log_nutrition_meals`, `approve_nutrition_day`, `search_nutrition_foods`, `get_nutrition_summary`, `get_nutrition_rules` all in `nutrition-tools.ts`.

Step 12 — Sub-nav (Today / Week / History)
- ✅ Shipped — `src/app/nutrition/NutritionSubNav.tsx`, `layout.tsx`.

Step 13 — Floating dock (`+` works, 📷/Aa stubs)
- ⚠️ Partial-by-design — `EntryDock.tsx` exists with `+` working; camera + Aa buttons are stubbed "coming soon" sheets. Tracked in TODOS.md ("Photo log + AI text parser dock buttons" — explicitly deferred). This is intentional but is one of the visible "missing feature" feelings.

Step 14 — Standalone Week page extraction (kill 937-line monolith)
- ✅ Shipped — TODOS.md confirms v0.2.1 redirect-to-today + v0.2.2 absorbed hydration/day-notes; `/nutrition/week` is now Week-only at 398 lines.

Other promised pieces:
- ✅ Workouts subtraction wiring — TODOS.md confirms `useTodayWorkoutCalories` shipped in v0.2.1.
- ❓ Materialize `nutrition_food_canonical` — explicitly deferred in TODOS.md ("not until corpus grows past threshold").

---

### PLAN-sleep.md — Sleep tracking surface

Status: Fully shipped. PR #36 / commit a680938.

Step 1 — Migration 025 + sync route persistence (start_at, end_at, is_main, anchor reset)
- ✅ Shipped — `src/db/migrations/025_healthkit_sleep_nights.sql`. Anchor reset confirmed in PR #36 description.

Step 2 — `get_health_sleep_summary` MCP tool + cross-references
- ✅ Shipped — present in `mcp-tools.ts`. CLAUDE.md has the Sleep workflow stanza (visible in current CLAUDE.md).

Step 3 — Page primitives (StageBar, RangeTabs)
- ✅ Shipped — `src/components/ui/stage-bar.tsx`, `range-tabs.tsx`.

Step 4 — LedeCard
- ✅ Shipped — page assembled at `src/app/sleep/page.tsx`. PR #36 confirms verdict-first + HRV inline.

Step 5 — WeeklyAveragesCard
- ✅ Shipped (per PR #36 description).

Step 6 — StageStackChart
- ✅ Shipped.

Step 7 — HrvSparkline
- ✅ Shipped.

Step 8 — Day / Week / Month / 3-Month tabs
- ✅ Shipped.

Step 9 — `/wellbeing` cleanup (remove sleep_hours input, add deep-link row)
- ✅ Shipped (per CHANGELOG 0.3.0).

Step 10 — CLAUDE.md Sleep workflow stanza
- ✅ Shipped — present in current CLAUDE.md.

Documented limitation:
- ⚠️ HK sleep deletion → night UUID mapping is NOT wired (PR #36 acknowledges this as TODO requiring native plugin extension; `deleted_sleep` is currently `no_op`). Not a regression vs plan — plan flagged this as a follow-up.

---

### Vision/Plan strategic layer (PR #34 — no committed plan doc)

Status: **Step 1 + Step 2 shipped. Step 3 partial. Step 4 (the editor) NEVER SHIPPED.**

This is the biggest visible gap. PR #34 explicitly framed itself as steps 1+2 of a four-step rollout.

Step 1 — schema + sync (migration 024)
- ✅ Shipped — `src/db/migrations/024_vision_plan.sql` (body_vision, body_plan, plan_checkpoint, plan_dose_revision, FKs, CDC, Androgod(ess) seed + 7 quarterly checkpoints).

Step 2 — `/strategy` read-only page
- ✅ Shipped — `src/app/strategy/page.tsx`. Renders Vision card, Plan card, north-star metrics, programming dose, re-eval triggers, checkpoints, prose.

Step 3 — MCP read tools (`get_active_vision`, `get_active_plan`, `get_plan_progress`)
- ✅ Shipped — confirmed at `src/lib/mcp-tools.ts` lines 2652–2669.

Step 4 — Editor UI on `/strategy` + write MCP tools
- ❌ **MISSING.** No `update_vision`, `update_plan`, `log_plan_checkpoint`, `create_plan`, `archive_*` tools in `mcp-tools.ts` or `src/lib/mcp/`. The `/strategy` page is purely read-only — it has no edit affordance, no "edit Vision" button, no markdown editor for `body_md`. The Androgod(ess) seed has `body_md = NULL` so the page shows "No prose yet — Vision body will render here once written" placeholder.
- Where you'd expect them if shipped: `src/app/strategy/edit/page.tsx`, `src/components/StrategyEditor.tsx`, MCP tools named `update_vision` / `update_plan` in `mcp-tools.ts`.

Where to access Strategy today:
- `/strategy` route — but **no entry in TabBar**. The TabBar has 5 tabs: Feed / HRT / Workout / Measure / Nutrition. Strategy was originally added as a 6th tab in commit `8603785` then moved to a `/feed` card in commit `2f89bdb` (PR #34 description: "Six tabs is borderline on phones — happy to move it behind /feed later"). The decision landed as: only entry point is a card on `/feed`, no nav tab.
- Direct URL `/strategy` works.

Other PR #34 follow-ups marked "not in this PR":
- ❌ Auto-stub future checkpoints at `create_plan` time — moot until create_plan exists
- ❓ Decide longer-term home for Strategy nav (6th tab vs `/feed` card vs overflow) — currently `/feed` card; no resolution committed

---

### Local-first migration (PR #14–#18)

Status: Foundation + 8 page migrations shipped. Several auxiliary surfaces deferred.

Lane A — viewport (iOS zoom fix)
- ✅ Shipped (PR #14)

Lane B1 — Postgres CDC layer (migration 019)
- ✅ Shipped — `019_local_first_sync_layer.sql`

Lane B2 — Dexie v3→v4 with 16 new local tables
- ✅ Shipped — Dexie now at v11 (later bumps for nutrition v6, plans v5, sleep, exercise images, muscles)

Lane C/C2 — Sync engine + `/api/sync/changes`
- ✅ Shipped

Lane D/D2 — Per-domain mutations + hooks
- ✅ Shipped — mutations-* and useLocalDB-* files exist for plans, nutrition, hrt, exercises, measurements, wellbeing, body-spec, strategy

Lane E — 8 page migrations (plans, nutrition, measurements, wellbeing, hrt, body-spec, exercises)
- ✅ Shipped (PR #15–#18) — pages render from Dexie

Lane F1 — Feed aggregator (replace `/api/feed`)
- ❓ **Unclear** — TODOS.md still lists "Audit remaining online fetches" but doesn't explicitly call out feed. Feed page imports MusclesThisWeek which uses `summary.setsByMuscle` from server. Worth Lou checking whether the perceived feed slowness is from this.

Lane F2 — 7 of 8 critical sync tests
- ❓ Unclear status. PR #14 deferred them. No follow-up commit visible.

Lane G — Old REST route audit + delete
- ⚠️ Partial. TODOS.md still has open item: "Audit remaining online fetches (`/settings`, `/inspo`, exercise history/detail, workout repeat/history endpoints, HealthKit writeback, imports, upload routes, global capture components). Local-first covered the 8 main pages; auxiliary paths still hit production."

Other deferred items (still in TODOS.md, never closed):
- ❌ change_log retention policy (90-day cron) — never shipped
- ❌ Photo upload queue parity for body-spec/progress photos — never shipped (only `inspo_photos` has Blob+retry; body-spec/progress photos remain online-only for capture)
- ❌ Generic `defineDomain<T>()` factory evaluation — never shipped
- ❌ Split `mcp-tools.ts` (still 2693+ lines) and `queries.ts` per-domain — never shipped
- ❌ HealthKit conflict resolution policy — never shipped (currently implicit/undocumented)

These are intentionally-deferred-but-not-completed items. They're in TODOS.md so they're tracked, but they may contribute to the "missing pieces" feeling.

---

### Exercise demo images + YouTube + AI gen (PR #30)

Status: Fully shipped.

- ✅ Migration 023 (`023_exercise_demo_assets.sql`) — image_count, youtube_url, image_urls
- ✅ 3-frame demo strip on exercise detail + in-workout `[i]` modal — `ExerciseDemoStrip.tsx` exists
- ✅ Inline edit for description/steps/tips — `EditableTextSection.tsx` exists
- ✅ AI image generation endpoint (auth-gated)
- ✅ Build-time scripts (`fetch-everkinetic-images`, `gen-exercise-images`, `db-apply-image-counts` — all in package.json)
- ✅ 147 catalog demo images bundled (commit e261631)
- ✅ Letterbox + 2-panel femme prompt (commit 307c273)

Out-of-scope-by-design (PR description called these out explicitly):
- Custom-exercise user-uploaded images
- In-app video player
- Bulk batch-gen UI (script-only V1)

---

### Strength canonical muscle taxonomy + sets-per-muscle (PR #38)

Status: **Phase 1 fully shipped. Phase 2 + Phase 3 NEVER STARTED.**

CLAUDE.md says:
> "Phase 1 ships set counts only. RIR (reps in reserve, 0–5) collection arrives in Phase 2; effective-set weighting in Phase 3."

Phase 1 (PR #38, commit f2f2a70):
- ✅ Migration 026 (canonical_muscles), 027 (audit), 028 (uuid dedupe)
- ✅ `get_sets_per_muscle`, `list_muscles` MCP tools
- ✅ `get_weekly_summary` extended with `by_muscle[]`
- ✅ `find_exercises({ muscle_group })` accepts canonical or synonym
- ✅ `create_exercise` validates canonical slugs
- ✅ MusclesThisWeek component on `/feed`
- ✅ Canonical-only multi-select in CreateExerciseForm
- ✅ Tooling scripts (normalize-muscle-tags, audit-exercise-muscles, generate-audit-migration)

Phase 2 — RIR collection in workout UI:
- ❌ **MISSING.** `workout_sets` schema has `rpe` (0–10, since migration 001) but no `rir` column. The workout logging page doesn't ask for RIR. No mention of RIR in workout UI components. Where to expect it: schema migration adding `rir` to `workout_sets` (also Dexie v12+ adding the field), workout `page.tsx` adding an RIR input alongside reps/weight.

Phase 3 — RIR-weighted effective sets:
- ❌ **MISSING.** Depends on Phase 2. No effective-set weighting code; `get_sets_per_muscle` description still says "full credit, no fractional weighting." MusclesThisWeek.tsx comment line 18 mentions "Phase 3 junk-set / RIR-derived recovery debt" as a future concept (red color is reserved for it).

The plan reference (`~/.gstack/projects/lewcart-Iron/lewis-sets-per-muscle-plan-20260501-134440.md`) is outside this repo so I couldn't read it, but PR #38's own description confirms Phases 2 + 3 are unstarted.

---

### Other surfaces worth flagging

HRT timeline + labs + Apple Health meds (PR #23, commit 6fd5a1b)
- ✅ Mostly shipped, BUT
- ⚠️ TODOS.md flags two open follow-ups: `HKMedicationDoseEvent` is a no-op (early-return) on real iOS hardware after a launch crash; `requestPermissions` not wired into foreground sync so users miss new HK type prompts. These are two real pieces of HRT/meds functionality that are coded but switched off.

Photo upload (mentioned in local-first + nutrition plans)
- `inspo_photos` has Blob + retry; body-spec and progress photos do not. Capture-while-offline doesn't work for the latter two flows. Tracked in TODOS.md, not shipped.

Photos plan (browse-and-tag — referenced in your prompt)
- ❓ Doesn't exist in repo yet. `.claude/plans/photos-browse-and-tag.md` was not present at audit time. Either the parent agent is still writing it or it landed somewhere else.

Tab nav home for Strategy
- The `/strategy` route exists, MCP can read it, but the only entry point in the UI is a card on `/feed`. PR #34 explicitly left this open. If Lou hasn't seen Strategy lately it may be because the card is buried.

---

## Top concrete gaps (Lou should triage these)

Ranked by "this is probably what you're feeling":

1. **Strategy editor + write MCP tools** — the whole point of the Vision/Plan layer is iterative refinement; right now you can only read it (and the seed `body_md` is NULL so the page mostly shows placeholders). PR #34's "step 4 follow-up" never landed. ~1–2d effort. Tools: `update_vision`, `update_plan`, `log_plan_checkpoint`, `create_plan`, `archive_*`. UI: edit page or inline-edit affordance on `/strategy`.

2. **Strategy nav placement** — only entry point is a `/feed` card. If you don't scroll there it's invisible. Add to TabBar (would need 6th slot or replacement) OR pin a Strategy row to the top of `/feed`. ~1h effort.

3. **Strength Phase 2 — RIR collection** — schema add (`rir` column on `workout_sets`, Dexie bump), workout-page input, MCP `update_sets` extension. CLAUDE.md mentions it as if planned but there's no commit for it. ~0.5–1d effort.

4. **Strength Phase 3 — effective-set weighting** — depends on #3. Updates `get_sets_per_muscle` to weight sets by RIR. ~0.5d after Phase 2.

5. **HRT meds re-enable on iOS hardware** — code is inline below an early-return. Needs a USB-attached device + Xcode crash log, then probably an Info.plist usage description. TODOS.md owner is "next session with USB-attached iPhone." ~0.5d when device is available.

6. **Body-spec + progress photo offline-capture parity** — copy `inspo_photos` Blob + retry pattern. ~1.5h per TODOS.md estimate.

7. **Nutrition camera + Aa AI logging** — `EntryDock` buttons render "coming soon" sheets. Real impl: Claude Vision for photo, Claude tool-output for text. ~0.5d each per TODOS.md. Visible "missing" feeling because the buttons exist and don't do anything.

8. **change_log retention cron** — silent ticking debt; not user-visible until performance bites in 12+ months.

9. **Local-first auxiliary REST audit** — `/settings`, `/inspo`, exercise history/detail, etc. still hit network. Will manifest as "this page feels slow when offline / on cellular."

10. **Feed aggregator local-first migration** — never explicitly closed in TODOS.md; if `/feed` ever feels laggy this is a likely cause.

---

## Where existing features live (Lou access guide)

- `/feed` → home; contains MusclesThisWeek card (Phase 1 sets-per-muscle) AND the only Strategy entry point (a card linking to `/strategy`)
- `/strategy` → read-only Vision + Plan view (Androgod(ess) Vision + Q2'26→Q4'27 Plan + 7 checkpoints). **No edit UI.** Direct URL only.
- `/sleep` → verdict-first sleep + HRV view (Day/Week/Month/3-Month tabs)
- `/wellbeing` → mood/energy/etc; sleep-hours input was removed and replaced by a `/sleep` deep-link row
- `/nutrition` → redirects to `/nutrition/today`
- `/nutrition/today` → FitBee-style ring + meals + hydration + day-notes
- `/nutrition/week` → Week template editor (legacy file, slimmed to 398 lines)
- `/nutrition/history`, `/nutrition/summary`, `/nutrition/goals` → as planned
- `/workout` → main logging surface (RPE only, no RIR)
- `/exercises` → catalog with demo strips, YouTube link field, inline text editing, AI-gen button
- `/measurements`, `/body-spec`, `/hrt` → all local-first reads
- `/inspo` → mood-board photos with offline-capture
- `/settings` → not local-first yet

MCP-only surfaces (no UI):
- Coaching notes (`create_coaching_note`, `list_coaching_notes`, etc.) — no `/coaching-notes` page
- Training blocks (`create_training_block`, etc.) — no `/training-blocks` page
- Lab draws (`create_lab_draw`, etc.) — no `/labs` page (HRT page may surface some)
- HRT timeline (`list_hrt_timeline`, etc.) — under `/hrt` tabs
- Inspo upload (`upload_inspo_photo`) — `/inspo` page exists
- Plan checkpoint logging — no UI; tool doesn't exist either

---

## Notes on uncertainty

- I didn't read `~/.gstack/projects/lewcart-Iron/lewis-sets-per-muscle-plan-...md` (outside repo). PR #38's body suggests Phase 2/3 are well-specified there.
- I couldn't verify the photos-browse-and-tag plan since `.claude/plans/photos-browse-and-tag.md` doesn't exist yet.
- The "feed aggregator" lane status is genuinely unclear — TODOS.md elides it.
- The `body_md` placeholders on `/strategy` may be deliberate (you write them via direct DB edit) but more likely indicate the editor never shipped.
