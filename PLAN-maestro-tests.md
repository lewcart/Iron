# PLAN: Maestro UI test suite for Rebirth iOS sim

Catch the UI regressions that bite Lou on the daily driver before they hit the
phone: keyboard shoving content, TabBar floating where it shouldn't, sheets
dismissing wrong, scroll containers misbehaving. Fast feedback, low ceremony.

## Goal

Stand up a Maestro test suite that runs against the iOS simulator from a single
`npm run test:maestro` command. Cover the 12-15 highest-risk UI regressions in
the Capacitor PWA. Hook into the `/ship` workflow as a pre-push gate.

## Why now

`capacitor.config.ts:11` already documents one of the bugs we're trying to
catch ("AddFoodSheet search box scrolls out of view when keyboard opens").
That regression was caught manually by Lou on-device, in production, after the
fact. We don't have any automated UI testing. As the surface grows past 31
routes and ~14 sheets/modals, manual catch-everything stops working.

Single user + ship-to-main means there's no PR review safety net. Maestro is
the safety net.

---

## Decisions

### D1: Maestro YAML, not XCUITest

| | Maestro YAML | XCUITest Swift |
|---|---|---|
| Test format | YAML, ~10 lines per flow | Swift, ~50 lines per flow |
| Compile cycle | None (interpreter) | Yes (test target build) |
| Selector model | Accessibility tree | Accessibility tree |
| Iteration speed | Seconds | Minutes |
| Maestro Studio | Yes (visual builder) | No |
| Cross-platform | Yes (Android day-1) | iOS only |
| WebView support | Native (treats WebView as native) | Workable but verbose |

**Pick: Maestro.** XCUITest's only edge is deeper iOS-only test access (XCTest
APIs, performance metrics). We don't need that for "did the keyboard cover the
input." Reserve XCUITest as a second tier later if we need pixel-precision
visual regression.

### D2: Selectors via accessibility tree, not data-testid

Capacitor exposes the WebView's accessibility tree to iOS Native Accessibility.
Maestro matches via:

- visible text (works for buttons, headings, tab labels)
- `accessibility-id` (maps from HTML `id` attribute)
- `accessibility-label` (maps from `aria-label`)

`data-testid` props **do not bridge** to native A11y. Adding them would create
a parallel testing-only attribute system that doesn't help screen readers.

**Strategy:**
- Default to visible text + existing `aria-label` coverage.
- Audit during scenario authoring; add `aria-label` where ambiguous (icon-only
  buttons, search inputs without placeholder, sheet close X).
- For elements where text changes per-data (e.g., dynamic list rows), add
  `id="m-…"` markers — `m-` prefix denotes "Maestro hook," 3-5 chars max.

This doubles as an a11y improvement. Lou doesn't use a screen reader, but
proper a11y also makes the iOS keyboard / VoiceOver / Spotlight integrations
work correctly.

### D3: Directory layout

```
.maestro/
  config.yaml                       # shared env, output dir, sim pin
  helpers/
    launch.yaml                     # launch + wait for hydration
    reset-data.yaml                 # clear Dexie via test endpoint
    seed-workout.yaml               # known-state workout for downstream flows
  flows/
    keyboard/
      nutrition-add-food.yaml
      workout-reps-input.yaml
      exercise-create.yaml
      strategy-textarea.yaml
    tabbar/
      tabbar-content-overlap.yaml
      tabbar-during-keyboard.yaml
      tabbar-during-modal.yaml
    scroll/
      exercises-list-scroll.yaml
      history-scroll.yaml
      nutrition-week-scroll.yaml
    sheets/
      sheet-swipe-dismiss.yaml
      sheet-tap-outside-dismiss.yaml
      sheet-keyboard-resize.yaml
    nav/
      tabs-cycle.yaml
      modal-back.yaml
  README.md
```

`.maestro/` (leading dot) keeps it out of `src/` searches and matches Maestro's
own convention.

### D4: Simulator pin = iPhone 17 Pro / iOS 26.0

Matches Lou's daily driver and the iOS 26 HealthKit medications gate. Pinned
by name in `.maestro/config.yaml` and `scripts/maestro-run.sh`. Single source
of truth for "the device we test on."

### D5: Test data via in-app `window.__rebirthTestBridge`, NOT API routes

**[REVISED post-review]** API routes can't ship with the iOS bundle:
`package.json:12` literally moves `src/app/api/` out before
`CAPACITOR_BUILD=1 next build` runs (static export forbids API routes). A
`/__test__/reset` endpoint would never exist in the WKWebView — every Maestro
call would 404.

Replace with a client-side test bridge. When built with `NEXT_PUBLIC_E2E=1`,
the app root mounts `window.__rebirthTestBridge` with:

```ts
window.__rebirthTestBridge = {
  ready: () => Promise<void>,            // resolves after Dexie open + first hydrate
  reset: () => Promise<void>,            // clear Dexie + localStorage + sessionStorage
  seed: (name: string) => Promise<void>, // load named fixture
  setClock: (iso: string) => void,       // pin Date.now() via nowProvider() shim
  getTree: () => unknown,                // dump live a11y tree (for selector authoring)
};
```

Maestro invokes via `evalScript`. Two-layer guard against prod leak:

1. **Code-level**: bridge module (`src/lib/test-bridge.ts`) imported only inside
   `if (process.env.NEXT_PUBLIC_E2E === "1") { … }` at the app root, so
   tree-shaking elides it from prod bundles.
2. **Pre-ship grep guard**: `scripts/check-no-test-bridge.sh` greps `out/` for
   `__rebirthTestBridge`. Non-zero hits fail `/ship`. Belt and braces.

```jsonc
"scripts": {
  "build:cap:e2e": "NEXT_PUBLIC_E2E=1 npm run build:cap",
  "test:maestro:tree": "..."   // dumps current a11y tree as JSON for selector authoring
}
```

When the bridge is called against a prod build, `window.__rebirthTestBridge` is
`undefined`. `helpers/launch.yaml` `evalScript` returns `null` and emits:
"test bridge not present — did you run `build:cap:e2e`?"

### D5b: Clock injection at app layer, not via simctl

**[REVISED post-review]** `xcrun simctl set time` does not exist as a
subcommand. Drop the simulator-clock-pin path entirely. Instead:

- Add `src/lib/now-provider.ts` exporting `now()` and `setNow(iso)`.
- All test-bound code that needs "today" routes through `nowProvider.now()`.
- `bridge.setClock(iso)` calls `setNow(iso)`. Default delegates to real `Date.now()`.
- This is invasive — a sweep over `new Date()` callsites in nutrition / week /
  workout / sleep date-bound code is needed. Estimated 15-25 sites. Tracked in
  D5b implementation step.

### D6: Run via `npm run test:maestro` orchestrator (incremental by default)

`scripts/maestro-run.sh` does the boring choreography:

1. Boot pinned simulator if not booted (`xcrun simctl boot`)
2. **[REVISED]** If web sources or iOS sources changed since last build (hash
   `src/**` and `ios/App/**`), build web + cap sync. Otherwise skip (saves
   2-4 min per run). Forced via `--full`.
3. Build + install app to sim (`xcodebuild` with `-destination 'platform=iOS Simulator,name=iPhone 17 Pro'`) — also hash-skipped
4. Run flows (`maestro test .maestro/flows/ --debug-output .maestro-out/<ts>/`)
5. Drop artifacts to `.maestro-out/<timestamp>/` (screenshots, video, junit, debug-output trees)
6. On failure: print one-line summary first
   (`Maestro: 13/15 passed, 2 failed: sheet-swipe-dismiss, tabbar-during-keyboard`),
   artifact paths next, full logs only on `-v`

Subcommands:
- `npm run test:maestro` → full suite, incremental
- `npm run test:maestro:full` → cold rebuild + suite
- `npm run test:maestro -- flows/keyboard/` → path filter
- `npm run test:maestro:watch flows/sheets/sheet-swipe-dismiss.yaml` → `maestro test --continuous` (re-run on flow change)
- `npm run test:maestro:studio` → live editor against running sim
- `npm run test:maestro:failed` → re-run only flows that failed last run (parsed from junit.xml)
- `npm run test:maestro:tree -- /nutrition/today` → dump live a11y tree as JSON
- `npm run test:maestro:doctor` → verify Maestro CLI, JDK, sim by name, build resolves

### D7: CI position = local pre-ship gate, no GitHub Actions yet

- **Pre-ship**: `/ship` skill runs `npm run test:maestro` after vitest, before
  push. Failure blocks the push. Output is one-line summary + artifact paths,
  not raw logs. Override with `SKIP_MAESTRO=1` for true emergencies.
- **[REVISED] SKIP_MAESTRO observability**: each skip appends to
  `.maestro-out/skip-log.txt` with timestamp + commit. `/ship` surfaces count:
  "SKIP_MAESTRO used 4 times in last 14 days — fix the suite or relax the
  flake."
- **GitHub Actions**: deferred. macOS runners are 10x cost, slow (5+ min boot),
  and a single-user repo with direct-to-main has no PR-time gate to attach to.
  Revisit only if drift becomes a problem (manual `npm run test:maestro` skips
  start happening).
- **Manual ad-hoc**: always available; expected during active feature work.

### D8: Inner-loop ergonomics

**[NEW post-review]** First-class authoring is a stated goal. The orchestrator
exposes:

- `:watch` — `maestro test --continuous` against a single flow file. Hot-reloads on
  YAML save. **The killer feature for authoring.**
- `:studio` — Maestro Studio session, visual flow builder against running sim.
- `:tree` — dumps current a11y tree as JSON. Used by both Lou and CC to find
  selectors without guessing. Hits `bridge.getTree()`.
- `:failed` — parses last `junit.xml`, re-runs only failed flows.
- `:doctor` — pre-flight: Maestro CLI version, JDK present, sim by name resolves,
  app builds. Single command to verify "is my dev env ready."

### D9: CC-pair authoring contract

**[NEW post-review]** Half the developers writing Maestro flows are CC agents
in pair-programming. They can't open Maestro Studio. `.maestro/AGENTS.md`
provides:

- Skeleton flow template (copy-edit pattern).
- Helper inventory (signature + when-to-use for every `helpers/`).
- Selector preference order: `id="m-…"` > `accessibility-label` > visible text.
- Workflow: `npm run test:maestro:tree -- <route>` → grep tree → write flow →
  `:watch` until green.
- Failure recovery: read `junit.xml` + screenshots in `.maestro-out/<ts>/`,
  propose fix.

---

## Initial scenarios (13 flows, prioritized by user pain)

### Keyboard (the bugs Lou reported)

**1. nutrition-add-food** — `/nutrition/today` → "+" → AddFoodSheet → tap search
input → keyboard appears → assert search input visible above keyboard → type
"chicken" → assert results scroll under input, not behind keyboard.

**2. workout-reps-input** — Open active workout → tap reps field on a set →
keyboard appears → assert reps input + RIR chip strip visible, not covered.
Tap RIR chip with keyboard up → assert chip registers tap.

**3. exercise-create** — `/exercises` → "+ Create exercise" → form opens → tap
each input in sequence → assert each visible above keyboard → blur final input
→ keyboard dismisses cleanly, no layout jump.

**4. strategy-textarea** — `/strategy` → tap Vision textarea → keyboard appears
→ type a paragraph → assert textarea grows to fit, doesn't push save button
off-screen.

### TabBar overlap

**5. tabbar-content-overlap** — For each of 5 tabs (Week, HRT, Workout, Measure,
Nutrition): scroll to bottom → assert last interactive element is tappable
(not visually under TabBar). Detects missing `pb-[var(--tab-bar-height)]` on
new pages.

**6. tabbar-keyboard-zindex** *(renamed post-review)* — `/nutrition/today` →
AddFoodSheet → keyboard up → assert TabBar either hidden or below keyboard.
This is a z-index / safe-area concern, NOT the `Keyboard.resize: body` regression
— that one is exercised by scenario #1 (`nutrition-add-food`), which has an
explicit assertion: "after keyboard up, search input bottom-edge Y < keyboard
top-edge Y."

**7. tabbar-during-modal** — `/history` → tap workout to open ExerciseDetailModal
→ assert TabBar not visible above modal (z-index stacking).

### Scroll

**8. exercises-list-scroll** — `/exercises` → scroll to bottom of long list →
scroll back to top → assert first item visible, no momentum overshoot, no
ghost rows.

**9. history-scroll** — `/history` → scroll long workout history → assert no
jank (>50ms frame stalls flagged by Maestro), last item reachable above
TabBar.

**10. nutrition-week-scroll** — `/nutrition/week` → horizontal day swipe → assert
no vertical hijack, all 7 days reachable.

### Sheet behavior

**11. sheet-swipe-dismiss** — Open each of 6 sheets (AddFoodSheet, EditFoodSheet,
GoalsSheet, ProjectionUploadSheet, InbodyScanSheet, AdjustPBHistorySheet) →
swipe down → assert dismiss + focus returns to underlying screen.

**12. sheet-tap-outside-dismiss** — Same 6 sheets → tap dim backdrop → assert
dismiss.

**13. sheet-keyboard-resize** — AddFoodSheet open → tap input → keyboard up →
assert sheet height shrinks (Capacitor `Keyboard.resize: body`), inner content
scrolls within remaining height.

### Nav

**14. tabs-cycle** — Tap each of 5 tabs in order, then return to Week → assert
no white screen, no stuck spinner, every tab content paints.

**15. modal-back** — `/history` → tap workout → ExerciseDetailModal opens → tap
back / swipe-back → modal closes, scroll position preserved.

That's 15 scenarios, not 13. Boil the lake.

---

## Test ID a11y additions (audit-driven, not pre-emptive)

Add `aria-label` only when Maestro selector authoring fails. Don't blanket-
annotate. Expected adds based on the surface I've seen:

- `src/components/ui/sheet.tsx` close X button → `aria-label="Close"`
- `src/components/SetActionSheet.tsx` 3-dot menu → `aria-label="Set actions"`
- `src/app/nutrition/today/AddFoodSheet.tsx` search input → `aria-label="Search foods"`
- `src/components/TabBar.tsx` Link → already has visible text; defer

Total expected a11y patches: ≤6 files. Audited during scenario writing.

---

## Test data state contract

Every flow assumes:
- App is fresh (`/__test__/reset` ran in `helpers/reset-data.yaml`)
- Lou is "signed in" (single-user app — local seed user)
- Date is **fixed** to `2026-05-01` via simulator clock pin (`xcrun simctl … set time …` if available, else accept date drift in date-bound assertions)

Each flow that needs specific data calls `helpers/seed-<name>.yaml` first.

---

## Risks & rescue

| Risk | Detection | Rescue |
|---|---|---|
| Maestro WebView a11y tree empty until hydration done | Selectors fail with "no match" right after launch | `helpers/launch.yaml` waits for "Week" text (post-hydration sentinel) before yielding |
| Keyboard doesn't dismiss between flows | Next flow fails on focus | Append `hideKeyboard` to every flow tail |
| Wrong sim booted | Maestro picks wrong device | Pin by udid resolved from name in `scripts/maestro-run.sh`; fail loudly if not found |
| Test data drift across flows | Flaky text assertions | Per-flow `helpers/reset-data.yaml`; never share state |
| Maestro version mismatch dev↔CI | Selector behavior differs | Pin via `mise.toml` (preferred) or document required version in README |
| Capacitor sync stale | Tests run against old build | `scripts/maestro-run.sh` always rebuilds + cap-syncs before running |
| `__test__` endpoints leak to prod | Security hole | Endpoints check `process.env.NEXT_PUBLIC_E2E === '1'` at module top; throw 404 otherwise |
| Long flow >60s timeout | Maestro kills the flow | Per-flow timeout override in config.yaml only where justified |

---

## Test plan diagram (user flow → codepath → coverage)

```
USER FLOW                           CODEPATH                                     COVERED BY
──────────────────────────────────────────────────────────────────────────────────────────
Launch app, land on /feed           src/app/feed/page.tsx, TabBar.tsx            tabs-cycle, launch helper
Switch tab                          Next Link prefetch, layout                    tabs-cycle
Tap reps input on a set             workout/page.tsx + Capacitor Keyboard         workout-reps-input
Open AddFoodSheet, search           AddFoodSheet.tsx + Sheet portal               nutrition-add-food
Sheet keyboard resize               Keyboard.resize=body (capacitor.config.ts)    sheet-keyboard-resize
Sheet swipe dismiss                 sheet.tsx onClose                             sheet-swipe-dismiss
Sheet tap-outside dismiss           sheet.tsx backdrop click                      sheet-tap-outside-dismiss
Open ExerciseDetailModal            ExerciseDetailModal.tsx + route               modal-back
Long-list scroll                    exercises/page virtualized list               exercises-list-scroll
TabBar at scroll bottom             TabBar fixed bottom-0 + safe-area             tabbar-content-overlap
TabBar during keyboard              keyboard event handler                        tabbar-during-keyboard
TabBar during modal                 modal z-index + backdrop                      tabbar-during-modal
Strategy textarea grow              StrategyEditors textarea autosize             strategy-textarea
Create exercise form                CreateExerciseForm full-screen + keyboard     exercise-create
Tabs round-trip                     Next prefetch + layout shells                 tabs-cycle

NOT COVERED (deferred):
- HealthKit permission sheet (native iOS, not WebView)
- Camera / photo capture flows (native bridge)
- LocalNotifications scheduling (background)
- Workout LiveActivity / RestTimer widget (native target)
- Offline route behavior (requires sim airplane mode)
- WalkTracker geofence flow (covered by Swift unit tests in ios/App/Tests)
```

---

## Architecture (where the test infra sits)

```
                    ┌──────────────────────────────┐
                    │ scripts/maestro-run.sh       │
                    │ (orchestrator)               │
                    └──────────┬───────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
    ┌───────────────┐  ┌──────────────┐  ┌─────────────────┐
    │ npm           │  │ xcodebuild   │  │ maestro CLI     │
    │ build:cap:e2e │  │ install      │  │ test .maestro/  │
    └───────┬───────┘  └──────┬───────┘  └────────┬────────┘
            ▼                 ▼                   ▼
    ┌──────────────────────────────────────────────────────┐
    │           iPhone 17 Pro / iOS 26.0 Simulator         │
    │                                                       │
    │   ┌──────────────────────────────────────────────┐   │
    │   │  Rebirth.app (Capacitor)                     │   │
    │   │   ┌──────────────────────────────────────┐   │   │
    │   │   │  WKWebView                           │   │   │
    │   │   │   Next.js out/ static                │   │   │
    │   │   │   /__test__/reset, /__test__/seed   │◄─────── reset/seed via maestro
    │   │   │   accessibility tree exposed to     │   │   │
    │   │   │   iOS Native A11y                    │◄─────── maestro queries here
    │   │   └──────────────────────────────────────┘   │   │
    │   └──────────────────────────────────────────────┘   │
    └──────────────────────────────────────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ .maestro-out/<ts>/   │
                    │  ├── screenshots/    │
                    │  ├── video.mp4       │
                    │  └── junit.xml       │
                    └──────────────────────┘
```

---

## Effort *(revised post-review — original estimate was 2-3x light)*

| Step | Human time | CC time |
|---|---|---|
| Install Maestro + write `scripts/maestro-run.sh` (incremental + hash-skip) | 3 hours | 30 min |
| `:doctor`, `:watch`, `:failed`, `:tree`, `:full` subcommands | 2 hours | 30 min |
| `window.__rebirthTestBridge` impl + tree-shake guard + grep guard | 4 hours | 1 hour |
| `now-provider.ts` + sweep ~15-25 `new Date()` callsites in date-bound code | 3 hours | 45 min |
| `helpers/` (launch, reset, seed, **actions/** primitive library) | 2 hours | 30 min |
| 15 scenario flows (with `:studio` + `:tree` + `:watch`) | 2 days | ~2 hours |
| a11y audit + `aria-label` + `id="m-…"` patches (~15-25 sites) | 2 hours | 45 min |
| `selector-lint.mjs` (flag ambiguous text matches) | 1 hour | 20 min |
| `/ship` hook + one-line summary + skip-log | 1 hour | 20 min |
| `.maestro/README.md` (10 sections) + `.maestro/AGENTS.md` | 3 hours | 45 min |
| First-run stabilization (Xcode signing, sim variance, flake) | 4 hours | 1.5 hours |
| **Total** | **~5-6 days** | **~9-10 hours** |

Compression: ~12x. Still worth it — ~3 days human-equivalent of test infra
shipped in a long afternoon. But not the original ~3-hour CC fantasy.

---

## Out of scope (deferred to TODOS.md)

- Android Maestro runs — no Android build today.
- Maestro Cloud — paid; local CLI is enough for one user.
- Visual regression / screenshot diffing — separate concern, separate tool.
- Performance assertions (FPS, TTI) — Maestro doesn't measure these well.
- Real-device runs — sim catches the bugs we care about.
- HealthKit permission flow tests — native, not WebView; XCUITest territory.
- LiveActivity / RestTimer widget tests — native target; defer.
- Offline mode flows — requires sim network state manipulation; later.
- GitHub Actions CI integration — revisit if local skips become a pattern.

---

## What already exists (don't rebuild)

- `capacitor.config.ts:11-25` — Keyboard.resize=body fix for the AddFoodSheet
  regression. Already in. Tests will assert this fix stays working.
- `scripts/ios-device-build.sh` — physical-device build script. We add a
  sibling `scripts/maestro-run.sh` for sim, don't reuse this one.
- `npm run cap:sync` — already does cap sync + healthkit gen. We invoke it.
- `npm run build:cap` — strips API routes for static build. We extend with
  `build:cap:e2e` that keeps the `__test__/*` routes.
- `ios/App/Tests/` — Swift unit tests for WalkTracker. Orthogonal. Leave alone.
- `vitest` — web component unit tests. Orthogonal. Leave alone.

---

## Acceptance *(revised post-review)*

This plan is done when:

- [ ] `npm run test:maestro` runs all 15 flows green against fresh sim
- [ ] Failure of any one flow blocks `/ship` (output: one-line summary + paths)
- [ ] `.maestro/README.md` + `.maestro/AGENTS.md` let a fresh Lou or CC pair
  write a new flow in <20 min cold (not the original <15 min target — review
  pushed back on TTHW)
- [ ] `__rebirthTestBridge` is `undefined` in any prod build; pre-ship grep
  guard fails build if string is found in `out/`
- [ ] Total flow runtime <3 min after first warm build (incremental orchestrator
  default); cold rebuild via `:full` is acceptable at 5-7 min
- [ ] `npm run test:maestro:doctor` passes on a fresh laptop in <5 min (after
  Maestro CLI install)

---

## Decision Audit Trail

| # | Decision | Source | Principle | Rationale |
|---|---|---|---|---|
| 1 | Maestro YAML over XCUITest | original | P5 (explicit) + P3 (pragmatic) | YAML auth, no compile, Studio support |
| 2 | A11y-tree selectors, not data-testid | original | P5 + P1 | data-testid doesn't bridge to native A11y; bonus a11y improvement |
| 3 | `.maestro/` directory layout | original | P5 | Maestro convention, clean separation |
| 4 | Pin sim to iPhone 17 Pro / iOS 26 | original | P3 | Matches Lou's daily driver |
| 5 | **Test bridge via `window.__rebirthTestBridge`, NOT API routes** | eng review F1 | P1 (works at all) + P5 | API routes literally deleted by `mv` step in `build:cap`; static export forbids API routes |
| 6 | **Two-layer prod-leak guard** (tree-shake + grep) | eng review F3 | P2 (boil the lake) | NEXT_PUBLIC_* is build-time inlined — env check alone insufficient |
| 7 | **Clock injection at app layer**, drop simctl path | eng review F2 | P1 + P5 | `xcrun simctl set time` doesn't exist as a subcommand |
| 8 | **Default to incremental rebuild**, `:full` opt-in | eng review F4, dx review #2 | P3 + P1 (TTHW) | Cold rebuild every run kills <3 min target and authoring loop |
| 9 | **Rename scenario #6, retarget #1** to be the actual `Keyboard.resize: body` regression test | eng review F5 | P5 (explicit) | Coverage map was misattributed |
| 10 | **`bridge.ready()` promise** instead of text sentinel | eng review F6 | P5 + P1 | Hydration races; text doesn't distinguish "painted" from "data-loaded" |
| 11 | **`SKIP_MAESTRO` skip-log + count surfacing** in /ship | eng review F9 | P2 | Silent escape hatch decays single-user repos fast |
| 12 | **Sheet roster generated from `find`**, not pre-picked | eng review F7 | P3 | Hand-picked list goes stale |
| 13 | **`.maestro/AGENTS.md` + `:tree` subcommand** for CC pair-programming | dx review #8 | P1 (completeness) | Half the developers are CC; can't open Studio |
| 14 | **`:watch`, `:failed`, `:doctor` subcommands** for inner loop | dx review #2, #1 | P1 | Without watch + :failed, gate dies in 2 weeks |
| 15 | **`helpers/actions/` primitive library** | dx review #3 | P3 + P4 (DRY) | Keyboard-overlap assertion alone justifies extraction |
| 16 | **Selector preference: `id="m-…"` > `aria-label` > visible text**, plus `selector-lint.mjs` | dx review #4 | P5 + P3 | Visible text matches collide; ambiguity must surface at author time |
| 17 | **README must have 10 enumerated sections**, not just "lets you write a flow" | dx review #5 | P1 | "Write a flow in <15 min" is an outcome, not a spec |
| 18 | **/ship failure output: one-line summary + artifact paths**, full logs only on `-v` | dx review #7 | P3 | Wall of logs → SKIP_MAESTRO=1 becomes default |
| 19 | **Pin Maestro version in `scripts/maestro-run.sh`**, not mise.toml | eng review F11, dx review #10 | P3 | mise isn't adopted in this repo; one source of truth |
| 20 | **Skip GitHub Actions** | original (both reviews concur) | P3 | Single-user direct-to-main has no PR-time gate; macOS minutes are 10x |
| 21 | **Effort revised to 9-10h CC + half-day stabilization** | eng review F10 | honest accounting | Original 3h missed bridge impl, clock sweep, signing, flake debug |
| 22 | **Local persistence reset includes localStorage + sessionStorage** in `bridge.reset()` | eng review F13 | P1 | Auth tokens / cursor state crosses Dexie boundary |
| 23 | **Retries: opt-in per flow**, default 0 | user (taste) | P5 | Surfaces flake → forces fix. Each flow declares `retries: 1` in frontmatter only when network/animation-bound. |
| 24 | **`id="m-…"` markers: audit-driven**, not pre-emptive | user (taste) | P3 + P5 | Visible text first; add `id="m-…"` only when authoring fails. `selector-lint.mjs` catches ambiguity at author time. |

---

## NOT in scope (deferred)

- **GitHub Actions CI**: revisit only if SKIP_MAESTRO usage > 3/14d window
- **Visual regression / screenshot diffing**: separate tool (Percy / Chromatic)
- **Performance assertions (FPS, TTI)**: Maestro doesn't measure these well
- **Real-device runs**: sim catches the bugs we care about
- **HealthKit permission flow tests**: native iOS, not WebView; XCUITest territory if ever needed
- **LiveActivity / RestTimer widget tests**: native target
- **Offline mode flows**: requires sim airplane mode manipulation; later
- **Android Maestro runs**: no Android build today
- **Maestro Cloud**: paid, not needed for one user
- **`now-provider.ts` sweep beyond date-bound test paths**: the sweep targets
  the ~15-25 callsites that test data assertions hit. A full audit of every
  `new Date()` is out of scope.
