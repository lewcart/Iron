# PLAN — Apple Watch Companion App (revised post-review)

> **⚠ HISTORICAL — partly superseded by Day-13 architectural pivot.**
> The original plan had the watch holding an API key and calling
> `/api/sync/push` directly via a SQLite outbox + `RebirthAPI` +
> `RebirthKeychain` + `RebirthOutbox` SPM modules. Day 13 removed all of
> that: phone is the single writer; watch sends set completions via
> `WC.transferUserInfo` and the phone's existing Dexie sync engine
> handles the server push. **Refer to `docs/watch-architecture.md` for
> the current design.** This file remains for historical context — the
> Surface 1+2 routing, snapshot model, schema versioning, glance UI, HK
> live builder, and complications sections are still accurate; the
> Surface 3 (outbox + API client + keychain) sections are not.

**Status:** Revised after design + eng + DX review
**Owner:** Lou (single user)
**Branch:** worktree-watch-companion-plan
**watchOS minimum:** 10.0
**iOS minimum:** unchanged
**App Group:** `group.app.rebirth` (already configured)
**Bundle IDs:** `app.rebirth.watchkitapp`, `app.rebirth.watchkitapp.complications`

---

## Revision changelog

This plan was reviewed by three independent voices (design, eng, DX). Critical fixes applied:

- **Set write path:** drop `update_sets` (it's a routine-target editor). Watch posts to `/api/sync/push` with single-row `workout_sets` CDC payload — the same path the phone Dexie sync uses.
- **HKWorkout UUID:** stamp `HKMetadataKeyExternalUUID` at builder creation (mirrors existing `HealthKitPlugin.swift:616`); never claim to generate the HK UUID watch-side.
- **Force Touch removed:** Crown click + double-tap (AssistiveTouch) only.
- **Session-end flow:** specified (Finish CTA + summary screen).
- **Empty/loading/error states:** specified per surface.
- **Outbox storage:** SQLite file in app group, one row per mutation.
- **WC pre-activation gate:** plugin buffers + flushes on activation complete.
- **Schema versioning:** every WC payload carries `schema_version: Int`.
- **MCP body shapes:** generated via `npm run gen:swift-mcp-types` (mirrors existing `gen:healthkit` pattern). Drift test in CI.
- **`cap:sync` target preservation:** `scripts/cap-post-sync.mjs` patched to re-assert watch + complications targets.
- **Mock snapshot dev flag** for fast inner loop on Days 2–6.
- **Watch logging:** os_log + rotating file in app group, phone-side `/dev/watch-log` viewer.
- **HRV pill copy:** descriptive only, no recommendation.
- **Accessibility:** VoiceOver labels, Dynamic Type, AOD treatment, Reduce Motion respect.
- **Day boundaries:** annotated with "ships to main? Y/N"; Day 7–8 split.

---

## Goal

Stop pulling the phone out mid-set. The watch shows the current set's target reps and weight, captures approve + RIR, supports inline weight/rep dial-in via the Digital Crown, runs the rest timer with haptics, and surfaces walk / dog-walk start as complications. `HKLiveWorkoutBuilder` provides live HR + accurate kcal for strength workouts started from the watch.

## Non-goals (v1)

Exercise swap on watch. Voice notes per set. Sleep/HRV complications. Watch nutrition logging. Medication confirmation. Lab-draw reminders. Multi-user (Rebirth is single-user). Standalone-LTE operation without phone for first launch.

---

## Architecture: Hybrid (option C)

### Data flow

```
┌─ Phone web UI (src/app/workout/page.tsx)
│    │ on session start / each set mutation
│    ▼
│  Capacitor `WatchConnectivityPlugin`  (buffers if pre-activate)
│    │ WCSession.updateApplicationContext(snapshotV1)   ← full snapshot
│    │ WCSession.transferUserInfo({ delta })            ← incremental
│    ▼
│  iOS WCSessionDelegate (AppDelegate.swift)
│    │ writes to App Group container (SQLite + UserDefaults latest-snapshot key)
│    ▼
└─ Watch reads on launch / activation

Watch active session — set logging:
  User taps ✓ + RIR
       │
       ▼
  Watch writes intent to local SQLite outbox
       │  (idempotent: client-generated mutation_id UUID)
       ▼
  POST /api/sync/push  with REBIRTH_API_KEY from shared keychain
  body = single-row workout_sets CDC payload
       │  on 200 → mark synced, drop from outbox
       │  on 4xx → surface "invalid value" toast, drop (do not requeue)
       │  on 401 → halt outbox, show "re-auth from phone" banner
       │  on 5xx / network → keep in outbox, retry on NWPathMonitor change
       ▼
  Server → Postgres → next phone foreground sync pulls into Dexie
```

### Why `/api/sync/push` instead of `update_sets`

`update_sets` (`src/lib/mcp-tools.ts:3611`) **fully replaces all sets for a routine exercise** (delete + re-insert) — it edits planned routine targets, not completed working-set state. The phone uses `mutUpdateSet(set_uuid, { weight, repetitions, is_completed: true, rir })` (`src/lib/mutations.ts:166`) which writes to Dexie and hands off to `syncEngine.schedulePush()` → `/api/sync/push`. The watch should use the **same** path: a single-row CDC payload for `workout_sets`. Same correctness guarantees as the phone, no new endpoint surface, server already handles PR recompute and conflict resolution.

### Auth

API key (`REBIRTH_API_KEY`) lives in iOS keychain with access group `group.app.rebirth`. iOS app writes it on first install. Watch reads it on first launch and caches under the same access group. No key embedded in watch binary.

**Same-team requirement:** both targets must share Apple Developer Team ID. Document this in `docs/watch-architecture.md`. On `errSecItemNotFound`, watch surfaces "Re-pair from phone" with deeplink (mirrors existing geofence permission deeplink in `src/lib/geofence.ts`).

**401 handling:** halt outbox immediately on first 401, show banner. Do NOT drain or retry — superuser key revocation is signal, not noise.

**Future (not v1):** mint a watch-scoped API key with whitelist `complete_set / get_active_routine / get_exercise_history / get_health_snapshot / saveWorkout`. v1 reuses the single key.

### Snapshot schema versioning

Every WC payload carries `schema_version: Int`. Decoder uses `decodeIfPresent` for unknown future fields. If `schema_version > supported`, watch shows "Watch needs update — open App Store on phone" screen. Unit test asserts a v1 watch decodes a synthetic v2 snapshot non-fatally.

### Snapshot byte budget

Hard cap **50KB**. Snapshot fields:
- routine: name, exercises[], rep_window, target_sets, target_reps, target_weight, tracking_mode (reps|time)
- per-exercise history hint: **last 1 session only**, max 10 sets per exercise
- `schema_version`, `pushed_at`, `workout_uuid`, `current_exercise_index`

Unit test: synthesize worst-case snapshot (10 exercises × 6 sets), assert encoded size <50KB. Far under WC's 262KB ceiling.

### Conflict policy: phone Dexie + watch direct

Server stamps `updated_at = NOW()` on receive for both paths; never trust client-supplied timestamps for ordering. Watch writes are direct (immediate); phone Dexie writes are batched (delayed). For a same-second race, watch typically wins. This is acceptable single-user behavior. Document in `docs/watch-architecture.md`.

---

## Targets and code layout

### New Xcode targets

1. **`RebirthWatch Watch App`** (watchOS 10+, SwiftUI)
   - Bundle ID: `app.rebirth.watchkitapp`
   - Entitlements: `com.apple.developer.healthkit`, `group.app.rebirth`, keychain access group `group.app.rebirth`
   - Info.plist: `WKBackgroundModes` includes `workout-processing` (required for HKWorkoutSession background execution)
   - Does NOT include the iOS app's medications entitlement array
2. **`RebirthWatchComplications`** (WidgetKit extension)
   - Bundle ID: `app.rebirth.watchkitapp.complications`
   - Four complication kinds: `StartWorkout`, `WalkNow`, `DogWalk`, `SessionStatus`
   - Smart Stack relevance via `TimelineEntry.relevance`

### New Swift package: `RebirthShared/`

Local SPM package at repo root `/RebirthShared/Package.swift`. Added to `ios/App/App.xcworkspace` as local package reference (NOT in Pods). Both iOS app target and watch target depend on it.

**Modules:**
- `RebirthAPI` — typed client. Methods:
  - `getActiveRoutine() async throws -> ActiveRoutine`
  - `getExerciseHistory(name:limit:) async throws -> [Session]`
  - `pushSetCompletion(_ row: WorkoutSetCDCRow) async throws` — POSTs to `/api/sync/push`
  - `saveWorkout(_ payload: SaveWorkoutPayload) async throws -> SaveWorkoutResult` — calls existing endpoint behind HealthKitPlugin.saveWorkout
  - `getHealthSnapshot(fields:) async throws -> HealthSnapshot`
- `RebirthModels` — `ActiveWorkoutSnapshot`, `Exercise`, `WorkoutSet`, `WorkoutSetCDCRow`, `RepWindow`, `HealthSnapshot`, `ActivityType`, `SchemaVersion`
- `RebirthKeychain` — `getAPIKey()`, `setAPIKey(_:)`. Access group constant.
- `RebirthAppGroup` — typed accessors for snapshot UserDefaults key + outbox SQLite path
- `RebirthOutbox` — SQLite-backed mutation queue (see below)
- `RebirthWatchLog` — wraps `os_log` with category, mirrors to rotating file in app group (last 1000 lines)

### MCP type codegen

New script `scripts/gen-swift-mcp-types.mjs` reads `inputSchema` from `mcp-tools.ts` for the 5 endpoints the watch consumes and emits Swift `Codable` structs to `RebirthShared/Sources/RebirthAPI/Generated/MCPTypes.swift`. Mirrors the existing `gen:healthkit` pattern (`scripts/gen-healthkit.mjs` + `src/lib/healthkit-drift.test.ts`).

`npm run gen:swift-mcp-types` runs as part of `cap:sync` AND as part of `npm run test` via a new `swift-mcp-drift.test.ts` that fails CI if the committed Swift file is out of date.

### Outbox storage: SQLite

`RebirthOutbox` uses a single SQLite file at `<App Group container>/outbox.sqlite`:

```sql
CREATE TABLE pending_mutation (
  mutation_id TEXT PRIMARY KEY,        -- client-generated UUID
  endpoint TEXT NOT NULL,              -- '/api/sync/push'
  body_json BLOB NOT NULL,             -- request body
  created_at INTEGER NOT NULL,         -- unix ms
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  last_error TEXT
);
CREATE INDEX idx_pending_created ON pending_mutation(created_at);
```

- Atomic single-row writes (SQLite handles suspension cleanly).
- Idempotent on server: `mutation_id` included in body; server-side dedup by mutation UUID.
- Retry policy: 3 attempts at 1s / 5s / 30s, then surface in watch settings as "X pending — tap to retry". Only `is_completed=true` mutations are retried indefinitely beyond that; partial edits drop after 3.
- 4xx → drop, surface toast. 401 → halt all retries, show re-auth banner. 5xx / network → backoff retry. 200 → remove row.

Watch UI shows a footer pip "syncing · N pending" when count > 0.

### `cap:sync` preservation

Patch `scripts/cap-post-sync.mjs` to re-assert the watch app target, complications target, and `RebirthShared` package reference into `ios/App/App.xcodeproj/project.pbxproj` after every Capacitor regen. Test: `scripts/cap-post-sync.test.mjs` asserts post-sync project has all three.

### Capacitor plugin: WatchConnectivityPlugin

`ios/App/App/WatchConnectivityPlugin.swift`:
- `load()` calls `WCSession.default.activate()` and stores a `Task` continuation
- `pushActiveWorkout(snapshot)` awaits activation continuation before calling `updateApplicationContext`. Pre-activation calls buffer the latest snapshot only (overwrite).
- `pushSetMutation(set)` uses `transferUserInfo` (queued, FIFO per session). Used only when phone edits a set mid-session that should reach the watch.
- `getWatchPaired()` returns `{ isPaired, isReachable, isWatchAppInstalled }`
- Emits Capacitor events: `watchSnapshotAcked`, `watchSetSyncedFromWatch`

### iOS AppDelegate

`AppDelegate.swift` registers `WCSession.default.delegate` via the plugin. Inbound watch acks fire a Capacitor event so phone Dexie can pull on next foreground.

### Touched JS

- `src/app/workout/page.tsx` — on session start / `mutUpdateSet`, call `Capacitor.WatchConnectivity.pushActiveWorkout(snapshot)`. Snapshot built from existing in-memory state.
- `src/lib/watch.ts` — typed wrapper over the Capacitor plugin.

---

## Watch UI surfaces (SwiftUI)

### Surface 1 — Active workout glance

```
┌──────────────────────────┐
│ Romanian Deadlift   3/4  │  ← name (line 1) · set chip top-right
│                          │
│      100                 │  ← target weight (72pt, hero)
│   kg · 10 reps           │  ← unit + target reps (15pt)
│                          │
│  ╔════════════════════╗  │  ← full-width pill, 60pt height
│  ║         ✓          ║  │     min 44pt tap target ✓
│  ╚════════════════════╝  │
└──────────────────────────┘
```

- **Hierarchy:** name + set chip > weight number > unit/reps line > approve button.
- **No "build" jargon.** Rep window is encoded in the weight × reps target; if range matters, render `100 kg · 8–12 reps` below the hero number.
- **Last session peek:** Crown rotate up at top of glance reveals a thin top-bar `↑ 95 × 11` (no RIR; that's noise mid-set). Crown rotate down (default position) returns to glance.
- **Crown maps to ONE axis per surface:** on the active glance, Crown is exercise navigation (scroll between exercises). NOT weight/reps dial — that uses tap-to-enter.
- **Tap weight number** → enters weight-dial mode (separate full-screen modal). Crown dials in 1.25kg steps with `.click` haptic per step, `.success` haptic when crossing prev session weight. Tap to confirm, swipe-down to cancel.
- **Tap reps number** → enters reps-dial mode (same pattern, 1-rep steps).
- **Tap ✓ pill** → set marked complete, transitions to RIR picker. Auto-rest starts.
- **Pause/extend rest timer:** Crown click on the rest timer screen (NOT Force Touch — deprecated). Double-tap (Series 9+ AssistiveTouch) is alternate.

### Surface 2 — RIR picker (modal)

```
┌──────────────────────────┐
│ How hard?                │
│                          │
│        3                 │  ← big number, Crown 0–5 with detents
│   reps in reserve        │
│                          │
│  [ Confirm ]             │  ← full-width pill
└──────────────────────────┘
```

- Crown 0–5 with detent labels. Default = 2 (sensible mid-stimulus default).
- Confirm tap → posts CDC row. PB haptic fires on 200 response if e1RM exceeds cached record AND the set isn't `excluded_from_pb`.
- **Dismiss without confirm:** swipe-down → set is logged with `is_completed=true, rir=null`. Banner "RIR not recorded" with tap-to-add for 30s. After that, set stays `rir=null` (matches phone behavior).

### Surface 3 — Time-mode countdown / rest timer (shared component)

Circular ring counts down. Haptics:
- Time-mode (planks): `.click` at 50%, `.click` at 90%, `.success` at finish.
- Rest timer: `.click` at 30s remaining, `.success` at finish.
- Crown click → pause/resume. Long-press → +30s extend.
- Auto-starts on set completion (configurable default 90s, source: `localStorage.restTimerDefault` already exists on phone, mirrored via snapshot).

### Surface 4 — Walk-while-working glance (conditional)

Only rendered when `HKWorkoutSession` is active with `walking` or `hiking` activity type. Otherwise, this surface does not exist in the navigation.

```
┌──────────────────────────┐
│ Walking · 1.2 km         │
│ 14:32 · 124 bpm          │
│                          │
│  [ Tag as dog walk ]     │  ← prompts for confirmation
└──────────────────────────┘
```

**"Tag as dog walk" is NOT a live-reflow.** Plan-side: this writes a metadata flag `REBIRTH_RECLASSIFY=hiking` to the in-progress builder via `addMetadata`. At `finishWorkout`, code reads that flag, ends the workout as `walking`, then immediately starts a sibling `HKWorkout` with type `hiking` and copies the route + samples. Or: simplest — keep the workout as `walking` but add metadata `REBIRTH_DOG_WALK=true`; phone-side `healthkit.ts` remap reads that metadata flag in addition to the existing Hiking-type rule. Pick the simpler one.

Confirmation sheet on tap. No silent reclassification.

### Surface 5 — Session-end flow (NEW — was missing)

After last set's RIR confirm:

```
┌──────────────────────────┐
│ Workout complete ✓       │
│ 7 ex · 28 sets · 47 min  │
│                          │
│ [ Finish & Save ]        │  ← saves HKWorkout + flushes outbox
│ [ Add another set ]      │  ← reopens active glance
└──────────────────────────┘
```

- "Finish & Save" → `HKLiveWorkoutBuilder.endCollection` → `finishWorkout` → outbox flush → confirmation haptic → "Saved" screen for 2s → app dismisses to glance.
- Auto-detect: if all sets in routine are `is_completed=true` for 5 minutes with no new activity, prompt "Looks done — finish?".
- **No auto-finish without prompt.** Lou might be resting between exercises.

### Complications (4 kinds)

1. **Start Workout** — opens routine. Empty/error states:
   - No active routine: title swaps to "No routine"; tap → "Open Rebirth on phone" deeplink.
   - Today is rest day per active plan: title swaps to "Rest day"; tap → "Start anyway?" confirmation.
2. **Walk Now** — calls `startWalkNow()`. Tap → bottom-sheet "Walking started · 0:00" → dismisses to active-walk glance (Surface 4). NOT silent.
3. **Dog Walk** — same flow with `hiking` metadata. Distinct glyph (paw print) and accent color from Walk Now (footprint).
4. **Session Status (NEW — was missing)** — ONLY rendered when a workout, walk, or dog walk is active. Tap → goes to active glance or active walk glance. Long-press → "Stop session?" sheet.

Smart Stack relevance: `Start Workout` bumped on training days (read from active routine). `Walk Now` / `Dog Walk` bumped during depart-home windows (mirror existing `geofence.ts` config). `Session Status` always relevance 1.0 when active.

### HRV deload pill

Once per session, on first set screen, conditionally:

```
┌──────────────────────────┐
│ ⓘ HRV 41 · -1.4σ vs 30d  │  ← descriptive only, no recommendation
└──────────────────────────┘
```

- Pulled from `get_health_snapshot({ fields: ['hrv'] })` cached at session start.
- Threshold: HRV >1σ below 30d baseline. (Tunable; default v1.)
- Tap to dismiss for the session. Persists otherwise.
- **NO recommendation copy.** "Consider RIR 4 today" violates CLAUDE.md prescription-engine monopoly. Pill is informational; the Week page card carries the verdict.
- Hidden silently if snapshot fetch fails. PB pill skipped on first session of a new exercise (no cache to compare against).

### Always-On Display (AOD)

Active glance AOD treatment: dim the giant weight number to 30% luminance, hide the Last-session peek and HRV pill. ✓ pill stays visible at 60% luminance (Lou might glance the watch face mid-rest).

### Accessibility

- **VoiceOver labels:** "Target: 100 kilograms by 10 reps. Set 3 of 4. Romanian Deadlift. Tap to mark complete."
- **Dynamic Type:** weight number uses `.minimumScaleFactor(0.6)`. Rep window line uses `.dynamicTypeSize(.small...xxLarge)`.
- **Reduce Motion:** PB haptic stays; co-occurring scale-up animation on the PB pill is gated by `accessibilityReduceMotion`.
- **AssistiveTouch (Series 9+ double-tap):** primary action is the ✓ pill on glance, Confirm on RIR picker. Verify with the AssistiveTouch testing flow.

### Set-completion undo

After tap ✓, banner "Marked complete · Undo" appears for 5s. Tap Undo → set returns to incomplete state, RIR picker closed if open, outbox row deleted (or, if already POSTed, a compensating CDC row sent to flip back).

---

## HKLiveWorkoutBuilder integration

Replaces 6kcal/min stub for strength workouts started from the watch.

- On "Begin workout": `HKWorkoutSession(activityType: .traditionalStrengthTraining)` + `liveWorkoutBuilder` → `beginCollection`.
- Watch generates `rebirth_workout_uuid` (Swift `UUID().uuidString`).
- Stamp `HKMetadataKeyExternalUUID` = `rebirth_workout_uuid` on the builder via `addMetadata(_:)` (mirrors `HealthKitPlugin.swift:616`).
- During session: collect `heartRate` and `activeEnergyBurned` automatically.
- On finish: `endCollection` → `finishWorkout` → `HKWorkout.uuid` is **assigned by HealthKit** at this point. Watch posts both UUIDs to phone via `transferUserInfo`: `{ rebirth_workout_uuid, hk_uuid }`.
- Phone-side: `fetchWorkouts` reads `HKMetadataKeyExternalUUID` (already does — `HealthKitPlugin.swift:949` `workoutToFullDict`). Server-side dedup matches `rebirth_workout_uuid` first, falls back to `hk_uuid` for legacy rows.

Phone-started workouts unchanged (existing `HealthKitPlugin.swift saveWorkout` path).

**Session conflict:** complications (Walk Now / Dog Walk) check for active `HKWorkoutSession` before starting. If one exists, complication tap shows "Strength session active — finish first?" sheet instead of starting a walk.

**Battery budget:** <10% for 60min session on Series 7+ (measured Day 8 device QA). If over, fall back to 5Hz HR sampling.

---

## Failure-mode UX table

| Failure | User-visible | Recovery |
|---|---|---|
| WC snapshot not yet delivered (cold launch) | Skeleton + "Syncing from phone..." for 5s, then "Open Rebirth on phone" deeplink card | Tap retry pulls fresh snapshot |
| API key not in keychain | "Re-pair from phone" screen with deeplink to phone Rebirth app | Phone app writes key; watch retries on foreground |
| HK auth denied/revoked mid-session | Banner "HealthKit off — logging without HR/kcal" | Tap → settings deeplink (matches geofence pattern) |
| Outbox 401 (key revoked) | Halt outbox; banner "Re-auth from phone"; sets stay queued | Phone refresh re-mints key; tap retry |
| Outbox 4xx (validation) | Toast "Invalid value — open phone to fix"; row dropped | Manual fix on phone |
| Outbox network failure | Footer pip "syncing · N pending"; auto-retry on connectivity | NWPathMonitor change |
| Outbox >50 pending | Banner "Many sets unsynced — check connection" | Same auto-retry path |
| HKLiveWorkoutBuilder begin fails | Fall back to `HKWorkoutBuilder` (no live session); banner "HR/kcal off" | Set logging continues uninterrupted |
| Watch app launched before phone snapshot | Cold-start empty state (above) | — |
| Active routine has no exercises | "No routine for today" with deeplink | — |
| Convert-to-dog-walk requested | Confirmation sheet, then metadata flag (no live reflow) | Cancel returns to glance |

---

## Build order (12 working days — was 10, +2 for review fixes)

| Day | Slice | Ships to main? |
|---|---|---|
| 1 | Skeleton: watch target + complications target + RebirthShared package + cap:sync preservation script | Y — empty watch app, no UI |
| 2 | Read-only glance via WC snapshot + mock snapshot dev flag | Y — read-only |
| 3 | Set approve + RIR picker + outbox SQLite | Y — Lou can complete sets |
| 4 | Outbox retry + 401 halt + reachability flush + footer pip | Y |
| 5 | Tap-to-dial weight + reps with Crown haptic detents | Y |
| 6 | Time-mode countdown + rest auto-start + finish haptics + AOD treatment | Y |
| 7 | HKLiveWorkoutBuilder: HR display only (no save) | N — partial; merge at end of Day 8 |
| 8 | HKLiveWorkoutBuilder save + UUID round-trip + dedup verification | Y — combined commit with Day 7 |
| 9 | Complications (4 kinds) + Smart Stack relevance | Y |
| 10 | Session-end flow + summary screen + auto-detect prompt + undo banner | Y |
| 11 | PB haptic + HRV pill + walk-while-working glance + tag-as-dog-walk | Y |
| 12 | Polish: VoiceOver labels, Dynamic Type, Reduce Motion, accessibility audit, docs | Y |

Each Y-row has its own commit + push to main per project ship policy. Day 7 stays on the worktree branch until Day 8 lands.

---

## Test plan

### Unit (Swift, RebirthShared)

- `RebirthAPI` request encoding: fixture-based test against `mcp-tools.ts inputSchema` for each of the 5 endpoints.
- `swift-mcp-drift.test.ts`: fails CI if generated `MCPTypes.swift` is out of date.
- `RebirthOutbox` retry policy: persists across relaunch; 4xx drops; 401 halts; 5xx retries; mutation_id idempotency.
- `RebirthKeychain` access group: round-trip; missing key returns nil cleanly.
- Snapshot codec: round-trip every type; v1 watch decodes synthetic v2 snapshot non-fatally; worst-case payload <50KB.
- WC plugin pre-activation: calls before `activate()` complete must buffer + flush, never silently drop.

### Integration (paired sims)

- WC handshake: phone pushes snapshot, watch reads. Cold-start race covered: launch watch first, then phone — assert "Syncing from phone..." renders for ≤5s.
- Set update: watch posts `/api/sync/push`, phone Dexie pulls on foreground, set shows complete with correct RIR.
- Offline outbox: airplane-mode watch sim, log 3 sets, restore — all 3 land, footer pip clears.
- 401 outbox halt: stub server returns 401, assert outbox stops draining and banner appears.
- HKLiveWorkoutBuilder: start session in sim, finish, verify HKWorkout in HealthKit with non-zero kcal AND `HKMetadataKeyExternalUUID` matches watch-generated UUID.
- Conflict race: phone Dexie + watch direct write same set within 500ms; assert documented winner (server-stamped `updated_at` ordering).
- Session conflict: start strength session on watch, tap Walk Now complication — assert sheet shown, not silent start.

### Device QA (real Apple Watch + iPhone)

- One full strength session start-to-finish on watch only, including HKLive session.
- Mid-session phone reboot — watch keeps logging, sync resumes on phone wake.
- Walk Now complication during morning depart, dog walk type-flip via metadata.
- Battery measurement: 60min strength session, ≤10% drain target.
- AOD legibility: glance visible at 30% luminance.
- VoiceOver pass: navigate full glance + RIR picker + complications.

### Regression

- `HealthKitPlugin.swift saveWorkout` path on phone-started workouts: unchanged (verified via existing test fixtures).
- Geofence morning-walk automation: unchanged (regression test exists).
- Phone workout flow when watch unpaired: `getWatchPaired().isPaired === false` → no WC calls (unit test).

---

## Documentation deliverables (Day 12)

- **`CLAUDE.md` addition:** new top-level "Watch workflow" section. Mirrors style of "Nutrition workflow / Sleep workflow / Cardio workflow / HealthKit type catalog" sections. Covers: WC snapshot push timing, outbox semantics, schema_version contract, when to call which Capacitor plugin method.
- **`docs/watch-architecture.md`:** ASCII data-flow diagram, keychain same-team requirement, conflict policy.
- **`docs/watch-debug.md`:** how to read the watch log via phone-side `/dev/watch-log` viewer.

---

## Onboarding context per day (for future Claude Code)

| Day | Context files |
|---|---|
| 1 | PLAN-watch.md, ios/App/App/HealthKitPlugin.swift (Capacitor plugin pattern), package.json, scripts/cap-post-sync.mjs |
| 2 | PLAN-watch.md §Surface 1, RebirthShared/Sources/RebirthModels/, mcp-tools.ts:get_active_routine |
| 3 | PLAN-watch.md §Surface 1+2, RebirthShared/Sources/RebirthAPI/Generated/, src/app/api/sync/push/route.ts, src/lib/mutations.ts:166 |
| 4 | PLAN-watch.md §Outbox, RebirthShared/Sources/RebirthOutbox/ |
| 5 | PLAN-watch.md §Surface 1 (tap-to-dial section), watchOS WKHapticType reference |
| 6 | PLAN-watch.md §Surface 3, src/lib/timer-utils.ts (rest timer constants) |
| 7-8 | PLAN-watch.md §HKLiveWorkoutBuilder, ios/App/App/HealthKitPlugin.swift:578-669 (saveWorkout reference) |
| 9 | PLAN-watch.md §Complications, src/lib/geofence.ts (relevance window config) |
| 10 | PLAN-watch.md §Surface 5, undo banner pattern |
| 11 | PLAN-watch.md §HRV pill, mcp-tools.ts:get_health_snapshot, src/lib/healthkit.ts:224 (Hiking remap) |
| 12 | All accessibility specs in §Surface 1, §RIR picker, §Complications |

---

## Risks (revised)

| Risk | Mitigation |
|---|---|
| `cap:sync` stomps watch target | `scripts/cap-post-sync.mjs` re-asserts, with regression test |
| Same-team Apple Developer ID for keychain | Documented; failure mode is "Re-pair from phone" deeplink |
| HKLiveWorkoutBuilder battery overrun | Day 8 measures; fallback to 5Hz HR if over budget |
| `HKMetadataKeyExternalUUID` dedup mismatch | Server-side dedup test; matches `rebirth_workout_uuid` before `hk_uuid` |
| WC pre-activation silent drop | Plugin buffers + flushes on activation complete; unit test covers |
| Cold-start latency >500ms on Series 6 | Day 2 measurement via `signpost`; Day 12 polish gates merge |
| Watch app stays on stale snapshot when phone edits a set | `transferUserInfo` delta on phone-side `mutUpdateSet`; FIFO queue eventual consistency |

---

## Open decisions

1. Tag-as-dog-walk: simple metadata flag (preferred) vs end-and-restart workout. Default: metadata flag — implement Hiking remap to also read `REBIRTH_DOG_WALK=true` metadata.
2. HRV pill threshold: 1σ (default) vs 1.5σ. Tune from feel after first 2 weeks.
3. Mock snapshot dev flag name: `WATCH_MOCK_SNAPSHOT=1` (env) vs Xcode build config flag. Default: build config (`#if WATCH_MOCK_SNAPSHOT`).
