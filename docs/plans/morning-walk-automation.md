<!-- /autoplan restore point: /Users/lewis/.gstack/projects/lewcart-Iron/feat-morning-walk-automation-autoplan-restore-20260504-061252.md -->
# Plan: Morning walk automation (all-iPhone, no Watch app)

**Branch:** `feat/morning-walk-automation`
**Worktree:** `/Users/lewis/Developer/projects/Rebirth-morning-walk`
**Date:** 2026-05-04

## Problem

Lou wants morning logging to be hands-off:

1. Walk to the gym at ~04:30 weekdays / ~05:00 weekends
2. Lift at the gym
3. Walk home

Today: Lou manually opens Apple Fitness, taps "Outdoor Walk", taps stop at gym, opens Rebirth, starts strength session, taps finish, opens Fitness again, starts second walk, stops at home. Five+ taps across two apps before fully awake. Friction is highest at the moment willpower is lowest.

Existing `GeofencePlugin.swift` partially addresses this — home-arrival detection works and sends an `endWorkout` message to a Watch app. But:

- The Watch app was never built (no watchOS target in repo)
- The iPhone-side `homeArrival` listener in `src/lib/geofence.ts` only `console.log`s — never calls `finishWorkout()`
- No outbound walk tracking, no walk save, no exit triggers

## Decisions confirmed by Lou (prior conversation)

1. **Walk type**: Real Apple Health Outdoor Walk workouts with GPS routes (saved as `HKWorkout` + `HKWorkoutRoute` after the walk completes — iOS cannot run a live `HKWorkoutSession`, only watchOS can)
2. **Triggers**: Geofence-only (exit home, enter gym, exit gym, arrive home). Gym is a single fixed location.
3. **Time-window gate**: Depart-home → walk-start only fires during:
   - Weekdays (Mon–Fri): 04:30–06:00 Europe/London
   - Weekends (Sat–Sun): 05:00–08:00 Europe/London
   Outside these windows, exiting home does nothing.
4. **Background behaviour**: Auto-start walk silently + push notification ("Walk started · 04:32"). No confirmation tap.

## Flow diagram

```
[04:30–06:00 weekday OR 05:00–08:00 weekend]
       │
       ▼
EXIT home geofence (175m)
       │
       ▼
Native: gate-check (window OK?) → start CLLocationManager
        bg location, accumulate route
        local notification: "Walk started · HH:MM"
       │
       ▼
ENTER gym geofence (100m)
       │
       ▼
Native: stop tracking → build HKWorkout(.walking)
        + HKWorkoutRouteBuilder → save both
        local notification: "Walk saved · 1.2 km · 18 min"
       │
       ▼
[Lou taps Start in Rebirth app, lifts, taps Finish]
       │
       ▼
JS: finishWorkout mutation completes → bridge to native
       │
       ▼
Native: startWalkNow() → CLLocationManager again
        local notification: "Post-workout walk started"
       │
       ▼
ENTER home geofence (existing 30s dwell)
       │
       ▼
Native: stop tracking → save HKWorkout + route
        local notification: "Home · walk saved"
JS homeArrival listener: finishWorkout() fallback
        (only fires if a strength session is still open)
```

## Build list

### 1. Native (Swift) — `ios/App/App/`

**Extend `GeofencePlugin.swift` (revised post-Eng review):**

Current state: hardcoded single region identifier (`GeofencePlugin.regionIdentifier`), home-only persistence, `getStatus()` returns home only, dwell uses `Timer` (note: unreliable when app is suspended — see fix below).

Required changes:
- Region identifier schema: `home` and `gym` (string constants, not the legacy single value). Migration: on first load, if old key exists, rename region to `home`. Persisted state moves from `geofence-home-prefs` to a unified `geofence-regions-prefs` dictionary
- Multi-region monitoring (max 20 regions per Apple cap, we use 2)
- New handler: `didExitRegion(home)` with native time-window gate + `isWorkoutActive` guard at depart-time AND finish-time
- New handler: `didEnterRegion(gym)` → end active outbound walk
- New handler: `didExitRegion(gym)` → optional safety net; primary trigger remains `finishWorkout` JS bridge
- **Existing dwell `Timer` fix**: replace the home-arrival `Timer` with timestamp-based check (`enteredAt: Date`) reconciled on next location update or scheduled background task. `Timer` does not fire reliably when the app is suspended, which is exactly when home arrival happens. Use `BGProcessingTask` with a 30s deadline OR drop dwell for active-walk stop entirely (immediate end on entry; only apply dwell to the JS `finishWorkout` fallback path)
- Delete `WCSession`/`WatchSessionDelegate` dead code now (one-line removal). Comment in current code admits "the actual workout-end logic lives on the Watch side" but no Watch side exists. Leaving it activated misleads future devs and burns a tiny amount of energy on every plugin load
- Notification IDs become event-typed + flow-scoped: `rebirth-walk-started-<flowId>`, `rebirth-walk-completed-<flowId>`, etc. The current reused `rebirth-home-arrival` ID would clobber notifications that fire close together
- New JS-callable methods exposed via Capacitor `@objc`:
  - `setGymLocation({ lat, lng, radius })`
  - `setDepartWindows({ weekday: { start, end }, weekend: { start, end } })` — stored in UserDefaults
  - `startWalkNow()` — arms post-workout walk pending state (waits for first movement)
  - `cancelActiveWalk()` — manual override; also wired as the notification action handler
  - `getActiveWalkState()` — returns `WalkSnapshot { phase, flowId, startedAt, distanceMeters, durationSeconds, lastSampleAt }`
- New event: `walkStateChanged` (notifies JS on any phase transition; payload = `WalkSnapshot`)
- Notification action wiring: register `UNNotificationCategory` with a "Cancel" action in `application(_:didFinishLaunchingWithOptions:)`. The action handler runs in `UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:)` — entirely native, does NOT depend on JS being alive. From there, native calls `WalkTracker.cancel()` directly

**New: `WalkTracker.swift` (revised post-Eng review):**

Coordinator boundary: `GeofencePlugin` remains the region/event coordinator and owns the single shared `CLLocationManager` used for region monitoring + low-power location. `WalkTracker` is a stateful collector (struct/actor) that:
- Receives `didUpdateLocations` callbacks routed through the plugin
- Accumulates `[CLLocation]` in memory
- Throttle-flushes route samples to a JSONL file at `Application Support/walks/<flow-id>/route.jsonl` every 30s OR every 50m of movement (whichever first). UserDefaults stores only `flowId`, `phase`, `startedAt`, `lastFlushAt` — small state, frequent writes okay
- Exposes `start(reason:)`, `finish() -> HKWorkout?`, `cancel()`, `currentSnapshot() -> WalkSnapshot`

When a walk is active, the plugin temporarily reconfigures the manager:
- `desiredAccuracy = kCLLocationAccuracyBest`
- `distanceFilter = 5` (meters)
- `allowsBackgroundLocationUpdates = true` (already on)
- `pausesLocationUpdatesAutomatically = false`

When the walk finishes, restore the manager to region-only state (`desiredAccuracy = kCLLocationAccuracyHundredMeters`, `distanceFilter = 50`) so battery cost returns to baseline.

**Explicit state machine:**

```swift
enum WalkPhase: String, Codable {
    case idle
    case walkOutboundActive
    case atGymWalkSaved
    case strengthActive
    case walkInboundActive   // begins immediately on JS finishWorkout event
    case completed
    case partialMissedInbound
    case failedSaveAwaitingRetry
    case permissionRevoked
}
```

Persisted to UserDefaults as `currentPhase` + `flowId` (a per-day UUID). All transitions go through a single `transition(to:reason:)` method that logs and notifies JS via `walkStateChanged`. JS treats native as source of truth; on app foreground, pull `getActiveWalkState()` to reconcile, then subscribe to `walkStateChanged` for live updates.

**HealthKit save (current API, iOS 17+):**

The deprecated `HKWorkout(activityType:start:end:...)` initializer is NOT used. Sequence:

```swift
let config = HKWorkoutConfiguration()
config.activityType = .walking
config.locationType = .outdoor

let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: .local())
try await builder.beginCollection(at: startDate)
try await builder.addSamples([distanceSample, energySample])
builder.addMetadata([HKMetadataKeyWorkoutBrandName: "Rebirth"])
try await builder.endCollection(at: endDate)
let workout = try await builder.finishWorkout()  // workout finalized FIRST

let routeBuilder = HKWorkoutRouteBuilder(healthStore: store, device: .local())
try await routeBuilder.insertRouteData(locations)
try await routeBuilder.finishRoute(with: workout, metadata: nil)  // associate AFTER
```

**Permission auth caveat (Apple anti-fingerprinting):** `HKHealthStore.authorizationStatus(for:)` returns `.sharingAuthorized` for write scopes EVEN IF THE USER DENIED. There is no truthful read-side check. Pattern:
1. Call `requestAuthorization` once at first-enable (best-effort prompt)
2. Attempt the save
3. On `HKError.errorAuthorizationDenied`, set `hkWriteLikelyDenied = true` in UserDefaults and surface the "Repair permissions" UI state
4. Clear that flag on next successful save

The settings UI shows "Health write requested · tap to retry" if the flag is set, never claims "granted."

**HealthKit type catalog:**
- Edit `src/lib/healthkit-types.json` to add:
  - `workoutType` (write)
  - `HKSeriesType.workoutRoute()` (write) — needs a JSON schema entry that the codegen recognizes
- Run `npm run gen:healthkit` to regenerate `ios/App/App/HealthKitTypes.swift`
- Per CLAUDE.md, the drift test (`src/lib/healthkit-drift.test.ts`) will fail CI if this is skipped

**Permissions / entitlements:**
- Verify `NSLocationAlwaysAndWhenInUseUsageDescription` exists in `Info.plist` (geofence already needs this; double-check current copy is appropriate for background-walk tracking)
- Add `UIBackgroundModes` → `location` (likely already present for current geofence; confirm)
- HealthKit write scope already requested (workouts, route series new)

### 2. JS / TypeScript — `src/lib/`, `src/app/`

**`src/lib/geofence.ts`:**
- Expose `setGymLocation`, `setDepartWindows`, `startWalkNow`, `cancelActiveWalk`, `getActiveWalkState`
- Fix `onHomeArrival` listener to actually call `finishWorkout(currentWorkoutUuid)` if there's an open strength session (this is the documented intent, never wired)

**Workout finish hook:**
- In whichever module owns the finish-workout mutation (likely `src/app/.../finishWorkout.ts` or a sync-engine action), after success call `Geofence.startWalkNow()` if (a) auto-walk is enabled and (b) the workout was a morning gym session (we can use simple time-of-day heuristic, or a flag set by the auto-flow)

**Settings UI — extend the existing geofence settings page (revised post-Design review):**

Order matters. Once configured, Lou opens this page when something feels off — not to fiddle with settings. So the live answer comes first.

1. **Today's flow** (status, top of section)
   - Empty state: "No morning flows yet. Tomorrow at 04:30, leaving home will start one."
   - Complete: stacked + labeled
     ```
     Today
     Home → Gym    1.2 km
     Strength      48 min
     Gym → Home    1.1 km
     ```
   - Partial: missing leg in muted color, " — missed" suffix
   - Failed save: "Route captured but Health save failed" with "Repair permissions" tap-target
2. **Active walk banner** (only when a walk is recording)
   - "Walk recording · 0.3 km · Cancel" — Cancel is a destructive-style button, no confirmation modal (cancel during a false start must be one tap)
3. **Setup** (below a divider)
   - Master toggle: "Auto-log morning walks" (defaults OFF; first time enabling triggers Always-location + HealthKit write permission flow)
   - Gym location picker (map drop-pin, default 100m radius). Reuses home-location picker component if extracted; otherwise call out as a sub-task
   - Time windows: two iOS-native time pickers per row (weekday / weekend), defaults 04:30–06:00 / 05:00–08:00
   - Permissions status row: green "Always location · HealthKit write" or red "Always location revoked · Tap to repair"

UI state matrix (every state must have a surface):

| State | Status row | Active banner | Notification | Settings affordance |
|---|---|---|---|---|
| Not set up | hidden | — | — | "Set up" CTA |
| Ready, no flow yet | empty-state copy | — | — | edit setup |
| Window-just-missed (left at 06:01) | "Window closed at 06:00 — no walk started" muted | — | — | edit windows |
| Active outbound walk | hidden | "Walk recording · X km · Cancel" | walk-started (with Cancel action) | — |
| At gym, walk 1 saved | "Home → Gym · 1.2 km" partial | hidden | silent (no buzz mid-lift) | — |
| Strength active | unchanged | hidden | — | — |
| Active homebound walk | unchanged | "Walk recording · X km · Cancel" | silent (Lou knows they hit Finish) | — |
| Complete | full timeline | hidden | "Morning walks saved · 1.2km + 1.1km" (single end-of-flow) | — |
| Partial (walk 2 missed) | walk 2 muted "— missed" | hidden | "Morning flow incomplete — walk 2 not saved" | — |
| HK route insert failed | "Route captured but Health save failed" | hidden | "Could not save walk — tap to retry" | "Repair permissions" |
| Always-location revoked | "Permission revoked · location" | hidden | "Auto-walks paused — re-enable Always Location" | red banner + tap to settings |

Accessibility:
- All interactive elements ≥44pt touch target (iOS HIG)
- Cancel button: red destructive style + 56pt height (one-tap reliability when half-asleep)
- Dynamic Type: status row scales; truncation rules use ellipsis on the rightmost value first
- Dark mode: low-glare at 04:30 — notifications use system default (no custom-color hero), settings page respects user-preference
- Notification copy avoids exclamation marks and emoji (no celebratory tone before sunrise)

### 3. Storage / persistence (revised post-Eng review)

| Data | Storage | Rationale |
|---|---|---|
| Settings (gym, windows, master toggle) | localStorage + mirrored to UserDefaults via plugin | Existing pattern; small, infrequent writes |
| `currentPhase`, `flowId`, `startedAt`, `lastFlushAt` | UserDefaults | Tiny state, frequent writes acceptable |
| GPS route samples (active walk) | JSONL file at `Application Support/walks/<flowId>/route.jsonl` | Append-only; UserDefaults is wrong for sample-rate writes (sync I/O, encoding overhead, backed up to iCloud unnecessarily) |
| Saved walks (post-finish) | HealthKit (`HKWorkout` + `HKWorkoutRoute`) | Source of truth |
| `hkWriteLikelyDenied` flag | UserDefaults | Permission-repair surface |
| Per-day flow log (`flowId` → status, summary) | JSONL file at `Application Support/walks/index.jsonl` | Drives the "Today's flow" status row; survives reinstall iff backup is on |

Recovery rules:

- **App relaunch with active phase persisted:**
  - If `phase == walkOutboundActive` and `startedAt < 4h ago`: resume CLLocationManager, continue tracking
  - If `phase == walkOutboundActive` and `startedAt >= 4h ago`: finalize partial workout with last samples, mark `partialMissedInbound`, clear active state
  - If `phase == strengthActive`: no-op, wait for JS `finishWorkout` event
  - If `phase == walkInboundActive` and `startedAt < 4h ago`: resume
  - If `phase == walkInboundActive` and `startedAt >= 4h ago`: finalize partial walk-2 with last samples, mark `partialMissedInbound`
- **Reboot (app does not auto-relaunch):** region monitoring is system-managed and survives reboot. Next region transition relaunches the app, which then reads persisted phase and applies recovery rules above
- **Force-quit by user:** iOS suspends background location updates when the user force-quits. The plan does NOT promise walk continuity through force-quit. Instead, on next launch the recovery rules detect a stale active walk and surface a "Walk recording was interrupted" partial state. Manual test #4 below revised accordingly

### 4. Notifications (revised post-Design review)

Local notifications via existing Capacitor `LocalNotifications` plugin. Routine success is quiet; failures are loud.

| Event | Notification | Actions | Reason |
|---|---|---|---|
| Walk 1 start | "Morning walk started" | **Cancel** (in-band, no confirm) | Lou is half-asleep; this confirms the system is working. Cancel is the safety net for a false start at 04:35 (e.g., taking out trash) |
| Walk 1 saved (gym arrival) | silent | — | Lou is unlocking phone to lift; a buzz here costs willpower at the wrong moment |
| Walk 2 start (post-finish) | silent | — | Lou just hit Finish; they know what's next. In-app banner suffices |
| All saved (home arrival, both walks present) | "Morning walks saved · 1.2 + 1.1 km" | — | End-of-flow confirmation |
| Partial save (walk 2 missing) | "Morning flow incomplete — walk 2 not saved" | — | Lou should know |
| HK save failed | "Could not save walk — tap to retry" | **Retry** | Failure must be loud |
| Always-location revoked between flows | "Auto-walks paused — re-enable Always Location" | **Settings** | Repair flow |

Net: typically 2 notifications/morning (start + final). Errors get their own, unmissable.

Notification action wiring uses `LocalNotifications.registerActionTypes` + `addListener('localNotificationActionPerformed')`. Native posts the notification; JS handles the action, calls back into native via the plugin. The Cancel action MUST work even if the JS side is killed — implement as a notification extension or rely on the native plugin handling the action in `application(_:didReceiveLocalNotification:)`.

## What's NOT in scope (revised post-Eng review)

- **Watch app**: Explicitly skipped per Lou's earlier decision. The existing `WatchSessionDelegate` and `WCSession.activate` calls in `GeofencePlugin.swift` are DELETED in this PR (not left as cruft).
- **Auto-start strength workout in Rebirth**: Lou taps Start in the app at the gym. Auto-detection of "you're at the gym, want to start a workout?" is a v2 idea.
- **Multiple gyms**: One fixed gym. Travel gyms = manual.
- **Walk classification heuristics**: Walks are saved as plain `HKWorkout(.walking)` — no zone-2 inference, no pace targets. v2.
- **Reverse-geofence fallback for missed exits**: If iOS misses the home-exit event (rare), no walk gets logged. Adding a "scheduled wakeup at 04:25 to verify location" is a v1.1 hardening pass.
- **HRV/sleep gating**: Don't auto-start walks on terrible-sleep days. v2 idea, depends on `get_health_snapshot` integration.
- **Continuity through user-force-quit**: iOS suspends background location after force-quit; recovery on next launch uses partial-state surfacing instead.

(NOTE: cancel-from-notification action is NOW IN scope for v1 per Design review consensus — moved out of this list.)

## What already exists

| Sub-problem | Existing code |
|---|---|
| Home geofence entry detection | `ios/App/App/GeofencePlugin.swift` (CLCircularRegion + 30s dwell) |
| JS bridge for geofence config | `src/lib/geofence.ts` (`setHomeLocation`, `onHomeArrival`) |
| Settings UI for geofence | existing geofence settings page (radius, enable toggle) |
| HealthKit read access | full pipeline: `src/lib/healthkit-types.json` → codegen → `HealthKitTypes.swift` |
| HealthKit drift detection | `src/lib/healthkit-drift.test.ts` (CI gate) |
| Workout finish JS path | `finishWorkout()` mutation (already used by manual finish button) |
| Local notifications | Capacitor `LocalNotifications` plugin already wired for other features |

## Risks

1. **Background `CLLocationManager` reliability**: iOS aggressively suspends location updates when the app is killed. Region monitoring is rock-solid (system-level), but route-tracking continuity in background is the part that drops samples on real devices. Mitigation: start tracking immediately on geofence wakeup (region events are guaranteed to relaunch the app), request `requestAlwaysAuthorization` upfront, set `allowsBackgroundLocationUpdates = true`. Accept that route accuracy may be ±5–10m and some samples may be batched.

2. **HealthKit permission gotchas**: `HKWorkoutType` write + `HKSeriesType.workoutRoute()` write are independent scopes. If the user grants one but not the other, save fails silently. Surface granted-scopes status in the settings UI; check before each save and log a fallback notification if a scope is missing.

3. **False geofence triggers at edges**: 175m circles aren't perfect. The existing 30s dwell handles arrival; for departure, iOS already requires the device to leave the region for ~200m before firing exit. Acceptable. Edge case: a brief step outside (taking out trash) at 04:35 would start a walk. Mitigation: require 60s of being outside the home region OR >250m from home center before firing the depart-home → walk-start.

4. **Time-window edge cases**:
   - DST transitions: London is UTC in winter, BST in summer. Use timezone-aware date math (`Calendar.current` in Swift, which respects user's tz).
   - Bank holidays: Mon–Fri rule still applies. Lou explicitly confirmed weekday/weekend split, no bank-holiday carve-out.
   - Leaving home at 06:01 on a weekday: window closed, no walk. Acceptable.

5. **Concurrent state**: What if Lou's already in an active strength workout when geofence fires? Shouldn't happen given time windows, but defensive: if `isWorkoutActive` is true when depart-home fires, suppress walk start (would cause confused HKWorkout overlap).

6. **iOS version skew**: Background location + HealthKit route APIs are stable since iOS 14. Project's minimum iOS target should be ≥14 (verify in `ios/App/App.xcodeproj`).

## Test plan

### Manual (real device, on Lou) — revised post-Eng review

- **Day 0 setup**: enable feature, configure gym location, leave time windows at defaults; verify Always-location prompt + HealthKit write prompt appear
- **Morning 1 — happy path**: walk to gym normally → verify HKWorkout appears in Apple Health with `HKMetadataKeyWorkoutBrandName = "Rebirth"`, route GPS is sane (>20 sample points, distance within 10% of actual), finish workout in Rebirth, walk home, verify second HKWorkout appears, "Today's flow" status row shows full timeline
- **Edge — exit home outside window**: leave at 09:00 weekday → no walk should start; "Window closed" status visible if you check
- **Edge — re-entry behavior**: leave at 04:35, return at 04:40, leave again at 04:45 → DECISION: re-entering home aborts active walk-1, second exit starts fresh walk-1 if still in window. Verify only one HKWorkout for outbound, no overlap
- **Edge — notification cancel**: trigger walk, tap Cancel from notification banner → verify CLLocationManager stops, no HKWorkout saved, "Walk cancelled. Nothing saved." toast appears in app on next foreground
- **Edge — settings cancel**: trigger walk, open Settings → Geofence → tap Cancel button in active-walk banner → same as above
- **Edge — force-quit mid-walk**: trigger walk, force-quit Rebirth → on next foreground, verify "Walk recording was interrupted" partial state shown, no orphaned active state
- **Edge — reboot mid-walk**: trigger walk, reboot phone → on next geofence transition, verify recovery rules fire (resume <4h vs finalize-partial >4h)
- **Edge — permission revoked**: revoke "Always" location while feature is enabled → verify auto-walks pause, banner appears in settings, notification fires, no crash
- **Edge — HK write denied**: revoke HealthKit write scope → trigger walk → verify save fails gracefully, "Could not save walk" notification + retry surface, route file preserved for retry
- **Edge — drive partway to gym**: take a car for 5 minutes mid-walk → verify GPS gap detection (velocity < 0.3 m/s for >2min trims or splits), workout still saves, route is reasonable
- **Edge — Walk-2 begins immediately on Finish**: tap Finish in Rebirth → verify walk-2 begins recording immediately (no movement-detection delay), continues until home arrival

### Automated (revised post-Eng review)

- **`src/lib/healthkit-drift.test.ts`**: existing test extended via codegen; passes if JSON ↔ Swift in sync
- **`WalkTrackerTimeWindowTests.swift`**: given (weekday, 04:35), `shouldStart()` returns true; (weekday, 06:30), false; (Saturday, 04:45), false; (Saturday, 09:00), false; DST spring-forward and fall-back boundaries; bank-holiday weekday still treated as weekday
- **`WalkTrackerStateMachineTests.swift`**: every `WalkPhase` transition tested (idle→walkOutboundActive, walkOutboundActive→atGymWalkSaved, etc.); illegal transitions rejected; state persists round-trip through encoder/decoder; recovery rules fire correctly for stale phases (3h ago, 5h ago boundaries)
- **`WalkTrackerHKSaveTests.swift`**: with mock `HKHealthStore`, verify `HKWorkoutBuilder` sequence (`beginCollection` → `addSamples` → `endCollection` → `finishWorkout`); route is associated AFTER workout finalizes; metadata includes `HKMetadataKeyWorkoutBrandName: "Rebirth"`; on `HKError.errorAuthorizationDenied`, `hkWriteLikelyDenied` is set; route file preserved for retry
- **`WalkTrackerRouteStorageTests.swift`**: JSONL round-trip; throttled flush (30s OR 50m); file integrity on truncated write (last partial line discarded); cleanup on successful save
- **`GeofenceHandlerTests.swift`**: simulate `didExitRegion(home)` with various time/state combinations; verify time-window gate, `isWorkoutActive` guard at depart-time, and notification firing
- **Settings UI**: existing playwright/QA flow + new state-matrix smoke test (each of the 10 states renders without error)

## Estimated effort (revised post-Eng review)

The original 10h estimate underweighted the state machine, HKWorkoutBuilder retries, notification action wiring, and real-device background QA. Honest range:

| Component | CC effort |
|---|---|
| `GeofencePlugin.swift` extensions (multi-region, dwell fix, identifier migration, notification IDs) | 2.5h |
| `WalkTracker.swift` + `WalkPhase` state machine | 3h |
| HealthKit save via `HKWorkoutBuilder` + `HKWorkoutRouteBuilder` (with proper sequencing + retry) | 2h |
| Route storage (JSONL file, throttled flush, recovery) | 1h |
| HealthKit JSON catalog updates + regen | 30m |
| Notification action wiring (native UNUserNotificationCenter handler) | 1h |
| JS bridge + `geofence.ts` updates (push events + pull-on-foreground reconciliation) | 1h |
| Workout finish hook + first-movement detection for walk-2 | 1.5h |
| Settings UI (state matrix surfaces, status row, active banner, permission repair) | 3h |
| Tests (5 new test files: state machine, time window, HK save, route storage, geofence handlers) | 3h |
| Manual QA on device (multiple mornings to cover edges, including reboot + force-quit + denied permissions) | 3h (across 2-3 mornings) |
| **Total** | **~22h** |

Realistic ship: one focused day for the build, then 2-3 mornings of real-world validation before declaring v1 done. Plan for at least one bug per edge-case category surfacing in real use.

## Open questions — resolved by Design review

1. ~~Post-workout walk start: tap Finish vs first GPS movement?~~ → **Immediately on Finish tap.** Lou confirmed they always head straight out after finishing. No pending state, no first-movement detection, no 15-min cap — kills a whole class of edge cases. (P3 pragmatic + P5 explicit)
2. ~~Cancel-from-notification: defer or include?~~ → **Include in v1.** Both reviewers flagged this as core safety. (P1 completeness + P2 boil-lakes — same plugin, same diff)
3. ~~`HKMetadataKeyWorkoutBrandName`?~~ → **Yes, "Rebirth".** Required so walks are distinguishable from manually-started Apple Fitness walks; without it, Lou can't audit what the system did. (P1 completeness)
4. ~~Active-walk banner in home/workout screens?~~ → **Yes, ship it.** It's the only honest signal that the system is working when there's no notification visible. Lives in the workout screen header (not home — tighter context). (P1 completeness)

## Design Review consensus table

| Dimension | Claude subagent | Codex | Consensus |
|---|---|---|---|
| 1. Information hierarchy correct? | NO (config buried over status) | NO (data-model-led, not user-led) | CONFIRMED — fix |
| 2. All states specified? | NO (5 states unspec) | NO (8 states unspec) | CONFIRMED — fix (state matrix added) |
| 3. Notification frequency right? | NO (too many) | NO (4 is too many) | CONFIRMED — reduced to 1 routine + 1 end + errors |
| 4. Cancel surface placement? | NO (settings is wrong) | NO (must be in notification) | CONFIRMED — pulled forward to v1 |
| 5. Status row readable? | NO (unlabeled values) | NO (developer serialization) | CONFIRMED — labeled stacked format |
| 6. Specificity high? | NO (generic patterns) | NO (no DESIGN.md) | CONFIRMED — components specced, accessibility added |
| 7. Implementation hauntings named? | YES (5 named) | YES (live-state ownership) | CONFIRMED |

7/7 dimensions — both reviewers converged on "fix this before building". Plan revised inline above.

## Eng Review consensus table

| Dimension | Claude subagent | Codex | Consensus |
|---|---|---|---|
| 1. Architecture sound? | NO (2 CLLocationManagers, push/pull mix) | NO (no coordinator boundary, push/pull underdesigned) | CONFIRMED — single CLLocationManager owned by plugin, push events + pull-on-foreground hybrid |
| 2. HealthKit API current? | NO (deprecated `HKWorkout` init) | NO (deprecated init flagged) | CONFIRMED — `HKWorkoutBuilder` + sequenced `HKWorkoutRouteBuilder` |
| 3. Permission auth correctly handled? | NO (`authorizationStatus` lies) | NO (cannot reveal write auth) | CONFIRMED — drop "show granted scopes" promise, use save-attempt + error-flag pattern |
| 4. Reboot/force-quit recovery defined? | NO (snapshot mentioned, recovery undefined) | NO (force-quit test expectation is wrong) | CONFIRMED — explicit recovery rules table added; force-quit redefined as partial-recovery |
| 5. State machine modeled? | NO (10 states implicit) | NO (no `WalkPhase` enum) | CONFIRMED — `WalkPhase` Codable enum + transition method |
| 6. Test coverage sufficient? | NO (only time-window test) | NO (state, HK, route, recovery untested) | CONFIRMED — 5 test files specced |
| 7. Existing-code changes complete? | (partial flag) | NO (region identifier schema, dwell Timer unreliable, notification ID dedup) | CONFIRMED — migration path + dwell fix + per-flow notification IDs added |
| 8. Effort estimate honest? | (not assessed) | NO (10h optimistic) | CONFIRMED — revised to 22h |

8/8 dimensions — both reviewers converged on critical fixes. Plan revised inline.

## Eng Review — taste decisions surfaced at gate

- **State-flow direction**: subagent recommends push-only (native fires `walkStateChanged`, JS never caches). Codex recommends hybrid (pull `getActiveWalkState()` on app foreground/resume + subscribe for live updates). I chose Codex's hybrid — covers the case where JS missed a transition while backgrounded, costs one extra call on foreground. Both viable.
- ~~Walk-2 first-movement detection~~ — RESOLVED by user: walk-2 begins immediately on Finish tap (Lou confirmed they head straight out). Removed pending phase + cap logic entirely.

## Design Review — taste decisions surfaced at gate

- **Notification copy at start**: "Morning walk started" (Codex preference, neutral) vs "Walk started · 04:32" (subagent preference, time-stamp confirms gate fired). I chose neutral — timestamp is in the notification metadata.
- **End-of-flow notification**: subagent suggested "silent end" (one notification per morning total); Codex suggested "Morning walks saved" at end (two total). I chose Codex's two-total — completion confirmation is worth one buzz when Lou is back home.

## Decision Audit Trail

| # | Phase | Decision | Class | Principle | Rationale |
|---|---|---|---|---|---|
| 1 | Phase 0 | Skip CEO phase | Mechanical | User directive | "this without ceo" arg |
| 2 | Phase 0 | UI scope = YES | Mechanical | Detection rule | 12 UI-term hits |
| 3 | Phase 0 | DX scope = NO | Mechanical | Detection rule | Personal app, no developer audience |
| 4 | Design | Reorder settings: status > banner > setup | Auto | P5 explicit | Lou visits this page when something feels off |
| 5 | Design | Reduce notifications 4→2 routine + errors | Auto | P5 explicit, P3 pragmatic | Routine success quiet, failures loud |
| 6 | Design | Pull cancel-from-notification into v1 | Auto | P1 completeness, P2 boil-lakes | Same plugin, same diff |
| 7 | Design | Add 10-state UI matrix | Auto | P1 completeness | Both reviewers flagged unspecified states as critical |
| 8 | Design | Status row: labeled stacked format | Auto | P5 explicit | Unlabeled dot-separated values fail |
| 9 | Design | Active-walk banner in workout screen | Auto | P1 completeness | Open Q #4 resolved |
| 10 | Design | Walk-2 starts on first GPS movement (not Finish tap) | Auto | P5 explicit | Avoids phantom walk if Lou chats post-Finish |
| 11 | Design | `HKMetadataKeyWorkoutBrandName = "Rebirth"` required | Auto | P1 completeness | Distinguishes auto vs manual; trust |
| 12 | Design | Notification copy at start = "Morning walk started" | Taste | P3 pragmatic | Subagent vs Codex split — surfaced at gate |
| 13 | Design | Two notifications per flow (start + final) | Taste | — | Subagent vs Codex split — surfaced at gate |
| 14 | Eng | Use `HKWorkoutBuilder`, not deprecated `HKWorkout` init | Auto | P1 completeness | iOS 17+ deprecation; future-proofing |
| 15 | Eng | Drop "show HK write granted" UI; use save-attempt + error flag | Auto | P5 explicit | Apple anti-fingerprinting makes the read-side check impossible |
| 16 | Eng | Single CLLocationManager owned by plugin | Auto | P5 explicit | Apple-recommended pattern |
| 17 | Eng | Explicit `WalkPhase` enum + transition method | Auto | P5 explicit | 10 UI states need explicit phase model |
| 18 | Eng | Explicit reboot/force-quit recovery rules | Auto | P1 completeness | Both reviewers flagged as missing-critical |
| 19 | Eng | Replace existing dwell `Timer` with timestamp-based check | Auto | P1 completeness | `Timer` does not fire reliably when app is suspended |
| 20 | Eng | Delete `WCSession`/`WatchSessionDelegate` dead code | Auto | P5 explicit | Misleading cruft; one-line removal |
| 21 | Eng | Notification IDs become event-typed + flow-scoped | Auto | P1 completeness | Reused IDs would clobber close-firing notifications |
| 22 | Eng | GPS samples → JSONL file, not UserDefaults | Auto | P5 explicit, P3 pragmatic | Sample-rate writes in UserDefaults are wrong storage |
| 23 | Eng | `isWorkoutActive` guard at finish-time AND depart-time | Auto | P1 completeness | Reverse case (mid-walk strength start) was unguarded |
| 24 | Eng | Test coverage: 5 new test files | Auto | P1 completeness | Both reviewers flagged single time-window test as insufficient |
| 25 | Eng | Effort estimate: 10h → 22h | Auto | P5 explicit | Honest pricing of state machine + retries + QA |
| 26 | Eng | State flow: hybrid push + pull-on-foreground | Taste | P3 pragmatic | Subagent vs Codex split — surfaced at gate |
| 27 | Eng | Walk-2 detection: 50m movement OR 15min cap, abandon silently | Taste | — | Subagent vs Codex split — surfaced at gate |

