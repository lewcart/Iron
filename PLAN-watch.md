# PLAN — Apple Watch Companion App

**Status:** Draft → /autoplan review (no CEO)
**Owner:** Lou (single user)
**Branch:** worktree-watch-companion-plan
**watchOS minimum:** 10.0
**iOS minimum:** unchanged (matches main app)
**App Group:** `group.app.rebirth` (already configured)
**Bundle ID prefix:** `app.rebirth.*`

---

## Goal

Stop pulling the phone out mid-set. The watch shows the current/next set's target reps and weight, captures approve + RIR, supports inline weight/rep dial-in via the Digital Crown, runs the rest timer with haptics, and surfaces walk / dog-walk start as complications. Live HR + accurate kcal via `HKLiveWorkoutBuilder` replaces the current 6 kcal/min stub for strength workouts started from the watch.

## Non-goals (v1)

- Exercise swap on watch (defer — phone-side only).
- Voice notes per set.
- Sleep/HRV complications, watch nutrition logging, medication confirmation, lab-draw reminders.
- Multi-user support (Rebirth is single-user; ignore session/identity layers).
- Standalone-LTE watch operation without paired phone for first launch (we can require pairing once for keychain sync).

---

## Architecture: Hybrid (option C)

**Decision driver:** Lou usually has the phone in the gym bag; watch must not block on network for routine fetch but must continue to log if phone goes idle.

### Data flow

```
┌─ Phone web UI (src/app/workout/page.tsx)
│    │ on session start / each set mutation
│    ▼
│  Capacitor `WatchConnectivityPlugin`
│    │ WCSession.updateApplicationContext(activeWorkoutSnapshot)
│    ▼
│  iOS WCSessionDelegate (AppDelegate.swift)
│    │ writes to App Group UserDefaults (group.app.rebirth)
│    ▼
└─ Watch reads snapshot from shared UserDefaults on launch / activation

Watch active session:
  User taps ✓ + RIR
       │
       ▼
  Direct POST /api/mcp { update_sets ... }  with REBIRTH_API_KEY from shared keychain
       │
       │  on failure → enqueue in App Group UserDefaults outbox; retry on reachability
       ▼
  Server → Postgres → next phone foreground sync pulls into Dexie
```

### Why the hybrid

- **Initial routine fetch:** WC delivers a JSON snapshot in <1s when phone+watch are paired and within range. No network round-trip on session start.
- **Set logging:** Direct API write avoids dependency on phone app being foregrounded. Watch keeps working if phone screen is off.
- **Offline:** If watch loses network mid-set, mutation is queued in App Group `UserDefaults` and flushed on `NWPathMonitor` reachability change.

### Auth

API key (`REBIRTH_API_KEY`) lives in iOS keychain with access group `group.app.rebirth`. iOS app writes it once on first install. Watch reads it on first launch and caches in its own keychain item under the same access group. No key embedded in watch binary.

---

## Targets and code layout

### New Xcode targets

1. **`RebirthWatch Watch App`** (watchOS 10+, SwiftUI)
   - Bundle ID: `app.rebirth.watchkitapp`
   - Entitlements: `com.apple.developer.healthkit`, `group.app.rebirth`, keychain access group `group.app.rebirth`
2. **`RebirthWatchComplications`** (WidgetKit extension for watch)
   - Bundle ID: `app.rebirth.watchkitapp.complications`
   - Three complication kinds: `StartWorkout`, `WalkNow`, `DogWalk`
   - Smart Stack relevance: bumped during morning depart-home window; bumped for `StartWorkout` on training days from active routine.

### New Swift package

**`RebirthShared/`** (local SPM package, added to workspace)

Modules:
- `RebirthAPI` — typed client for the MCP/API endpoints used by the watch
  - `getActiveRoutine() async throws -> ActiveRoutine`
  - `getExerciseHistory(name:limit:) async throws -> [Session]`
  - `updateSet(setID:weight:reps:rir:isCompleted:) async throws`
  - `saveWorkout(workoutID:startedAt:endedAt:activityType:kcal:hrSamples:) async throws`
  - `getHealthSnapshot(fields:) async throws -> HealthSnapshot`
- `RebirthModels` — `ActiveWorkoutSnapshot`, `Exercise`, `WorkoutSet`, `RepWindow`, `HealthSnapshot`, `ActivityType`
- `RebirthKeychain` — `getAPIKey()`, `setAPIKey(_:)` with access group constant
- `RebirthAppGroup` — typed `UserDefaults` accessors for snapshot + outbox
- `RebirthOutbox` — pending mutation queue with retry policy

Both iOS and watchOS targets depend on `RebirthShared`. Capacitor JS bridge code in iOS is separate (uses RebirthAPI only for keychain init + WC encoding).

### New iOS files

- `ios/App/App/WatchConnectivityPlugin.swift` — Capacitor plugin
  - `pushActiveWorkout(snapshot)` — sends via `WCSession.updateApplicationContext`
  - `pushSetMutation(set)` — `WCSession.transferUserInfo` for queued mutations on phone offline path (rare; phone has Dexie sync already)
  - `getWatchPaired()` — returns `{ isPaired, isReachable }`
- `ios/App/App/AppDelegate.swift` — register `WCSession.default.delegate`, mirror inbound watch acks into Dexie via Capacitor event

### Touched JS

- `src/app/workout/page.tsx` — on `mutUpdateSet` and on session start/end, call `Capacitor.WatchConnectivity.pushActiveWorkout(snapshot)`. Snapshot derived from existing in-memory state, no new server call.
- `src/lib/watch.ts` — thin wrapper over Capacitor plugin with TypeScript types matching `RebirthModels`.

---

## Watch UI surfaces (SwiftUI)

### Surface 1 — Active workout glance (the main one)

```
┌──────────────────────────┐
│ Romanian Deadlift        │  ← exercise name (1-2 lines, autosize)
│ Set 3 of 4 · 8–12 build  │  ← set N of M, rep window + goal
│                          │
│   100 kg × 10            │  ← target weight × target reps (HUGE, 60pt)
│                          │
│ Last: 95 kg × 11 @ RIR 2 │  ← prev session for this exercise (small)
│                          │
│         ✓                │  ← big tap target → opens RIR picker
└──────────────────────────┘
```

- Crown scrolls between exercises within the workout (left edge gradient hint).
- Long-press weight → modal with Crown to dial weight in 1.25kg steps. Haptic detents.
- Long-press reps → same pattern, 1-rep steps.
- Tap ✓ → set marked `is_completed=true`, transitions to RIR picker. Auto-rest starts in background.

### Surface 2 — RIR picker (modal)

```
┌──────────────────────────┐
│ How hard?                │
│                          │
│        3                 │  ← Crown 0–5 with detents, tap to confirm
│   ───────────            │
│   reps in reserve        │
└──────────────────────────┘
```

Crown 0–5 with named labels (0=failure, 5=5+ left). Single tap to confirm. PB haptic + "+2.5kg PB" pill if exceeds e1RM record from cached `get_exercise_history`.

### Surface 3 — Time-mode countdown / rest timer

Shared circular ring component:
- Time-mode (planks, holds): counts down from `target_duration_seconds`. Haptics at 50%, 90%, finish (`.success`).
- Rest timer: counts down from configured rest (default 90s). Haptics at 30s remaining + finish. Auto-starts on set completion (Tier 2 feature).
- Force-touch / Crown click → pause / extend.

### Surface 4 — Walk-while-working glance

Surfaced when an active walk workout is detected (HKWorkout in progress with activity type `walking` or `hiking`):
```
┌──────────────────────────┐
│ Walking · 1.2 km         │
│ 14:32 · 124 bpm          │
│ [ Convert to dog walk ]  │
└──────────────────────────┘
```

Tap "Convert" → flips activity type on the in-progress builder to `hiking` (your `healthkit.ts:224` remap turns it into Dog Walk).

### Complications (3 kinds, Smart Stack eligible)

1. **Start Workout** — opens routine; relevance bumped on training days.
2. **Walk Now** — calls `startWalkNow()` (already exists in `lib/geofence.ts:182`); relevance bumped during depart-home windows from existing config.
3. **Dog Walk** — same as Walk Now but explicitly tags as `hiking` (auto-remapped to Dog Walk by `healthkit.ts:224`).

### HRV-aware deload pill

Once per session, on the first set screen:
```
┌──────────────────────────┐
│ ⓘ HRV 41 · -1.4σ         │  ← only shown if HRV >1σ below 30d baseline
│   consider RIR 4 today   │
└──────────────────────────┘
```
Pulls from `get_health_snapshot({ fields: ['hrv'] })` cached at session start. Read-only nudge — does NOT prescribe set/load changes (preserves the Week-page prescription engine's monopoly per CLAUDE.md).

---

## HKLiveWorkoutBuilder integration

Replaces the 6kcal/min stub for strength workouts started from the watch.

- On "Begin workout" tap: `HKWorkoutSession(activityType: .traditionalStrengthTraining)` + `liveWorkoutBuilder` → `beginCollection`.
- During session: collect `heartRate` and `activeEnergyBurned` automatically.
- On finish: `endCollection` → `finishWorkout` writes to HealthKit with real kcal.
- Workout UUID is generated watch-side and pushed back to phone via WC; phone's `workouts.healthkit_uuid` field is updated so dedup against `fetchWorkouts()` works.

For workouts started on phone, the existing `HealthKitPlugin.swift` saveWorkout path is unchanged.

---

## Build order (10 working days for Tier 1+2)

Day 1 — Skeleton: add watchOS target + complications target + RebirthShared package. Wire WCSession both sides. Push a static "hello" snapshot.
Day 2 — Read-only glance: real `get_active_routine` data via WC, Crown navigation, no writes.
Days 3–4 — Set approve + RIR: tap-to-complete, RIR picker, optimistic UI, API write, App Group outbox, reachability flush.
Day 5 — Weight/rep dial: long-press + Crown with haptic detents.
Day 6 — Timers: rest auto-start, time-mode countdown, finish haptics.
Days 7–8 — HKLiveWorkoutBuilder: HKWorkoutSession lifecycle, live HR display, save with real kcal, UUID round-trip.
Day 9 — Complications: three Smart Stack widgets with relevance.
Day 10 — Polish: PB haptic, HRV pill, walk-while-working glance + type flip.

## Test plan (high level)

### Unit (Swift)
- `RebirthAPI` request encoding: each endpoint has a fixture-based test verifying body shape matches what `mcp-tools.ts` expects.
- `RebirthOutbox` retry policy: queue persists across watch app relaunch; flush on connectivity restore; max retry count + dead-letter behavior.
- `RebirthKeychain` access group: round-trip get/set, missing-key path returns nil cleanly (no crash).
- Snapshot encoder/decoder (UserDefaults): round-trip every type with edge cases (empty exercises, 0-set workout, time-mode mixed with reps-mode).

### Integration (iOS sim + watch sim paired)
- WC handshake: phone pushes snapshot, watch reads, log assertion.
- Set update flow: watch posts mutation, phone Dexie shows the change after `mutListSync` runs.
- Offline outbox: airplane-mode the watch sim, log 3 sets, restore connectivity, verify all 3 land.
- HKLiveWorkoutBuilder: start session in sim, finish, verify HKWorkout in HealthKit with non-zero kcal.

### Device QA (real watch + iPhone, gym session)
- One full strength session start-to-finish on watch only.
- Mid-session phone reboot — watch keeps logging, syncs on phone wake.
- Walk Now complication during morning depart.
- Dog walk Hiking → remap verified in HealthKit on phone.

### Regression
- Existing iOS workout flow: nothing changes when watch is not present or not paired (`getWatchPaired().isPaired === false`).
- `HealthKitPlugin.swift saveWorkout()` path on phone-started workouts: unchanged.
- Geofence morning-walk automation: unchanged (just gains a complication entry point).

## Risks and open questions

| Risk | Mitigation |
|---|---|
| API key in shared keychain — what if phone app is uninstalled, watch app remains? | On watch launch, if keychain returns nil, show "Re-pair from phone" screen with deeplink. Single-user, low blast radius. |
| HKLiveWorkoutBuilder requires user to start session on watch (can't be triggered from phone). | Document explicitly in UI; phone-started workouts get the existing 6kcal/min stub. |
| WCSession.updateApplicationContext is best-effort (overwrite-only, not queued). For mid-session set mutations from phone, use `transferUserInfo`. | Use `updateApplicationContext` for full snapshot only; `transferUserInfo` for incremental set mutations (FIFO queue, delivered eventually). |
| Cold-start latency on watch app launch: snapshot read + UI render. Target <500ms. | Use App Group UserDefaults (in-memory after first read), prebuilt SwiftUI views, no network on cold path. |
| Sims don't fully reproduce HealthKit + WC behavior; some bugs only show on real device pair. | Include device-QA day in build plan (built into Day 7–8 + Day 10 polish). |

## Open decisions

1. Watch face complication design — minimal numeric vs glyph + label. Bias: glyph + 1-word label for legibility (Smart Stack tile is small).
2. HRV deload pill threshold — `>1σ below 30d baseline`. Could be 1.5σ to reduce noise. Default 1σ for v1, tune from feel.
3. Set order display — newest exercise first or routine order? Bias: routine order matches phone, less confusing.
