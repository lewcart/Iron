# Watch companion — architecture

A single-page reference for how the watch app talks to the iOS app and the
server. For per-day implementation history, see `PLAN-watch.md` (origin
plan, partly superseded — see banner at top of that file).

## Targets

```
ios/App/App.xcodeproj
├── App                         iOS app (Capacitor host)
├── RestTimerLiveActivity       existing iOS Live Activity extension
├── FitspoControlExtension      existing Control Center extension
├── RebirthWatch                watchOS 10+ SwiftUI app
└── RebirthWatchComplications   WidgetKit extension for the watch

RebirthShared/                  local SPM package
├── RebirthModels               snapshot + CDC types, schema versioning
├── RebirthAppGroup             UserDefaults snapshot persistence
└── RebirthWatchLog             os_log + rotating file in app group
```

Bundle IDs:
- `app.rebirth` (iOS app)
- `app.rebirth.watchkitapp`
- `app.rebirth.watchkitapp.complications`

App Group: `group.app.rebirth` (already configured pre-watch).

## Single-writer rule

**Phone is the only writer to Postgres.** The watch never makes network calls
to the Rebirth API. There is no API key on the watch, no shared keychain
read, no watch-side outbox. The watch is a thin display + remote control;
all server writes go through the phone's existing Dexie + sync engine.

This was the Day-13 architectural pivot. Before Day 13 the watch held an
API key in a shared keychain access group and posted directly to
`/api/sync/push` with its own SQLite outbox. That apparatus was removed
because (a) single-user app — there's no scenario where the watch is
genuinely untethered for long enough to need its own outbox, (b) the
keychain access-group bootstrap had Apple-Developer-Team-pairing pitfalls,
and (c) two writers makes conflict resolution harder for no real benefit.

## Data flow

### Snapshot push (phone → watch)

```
Phone Dexie live query (workout_sets)
        │
        │ useCurrentWorkoutFull() in useLocalDB.ts
        ▼
src/app/workout/page.tsx useEffect (debounced 200ms)
        │
        │ buildWatchSnapshot() — pure function (src/lib/watch.ts)
        ▼
Capacitor.WatchConnectivity.pushActiveWorkout({ snapshot })
        │
        ▼
WatchConnectivityPlugin.swift
        │  wraps as { schema_version, body }
        │  awaits WCSession activation (buffer if pre-activate)
        ▼
WCSession.updateApplicationContext(envelope)
        │
        ▼ (BLE, then watch wakes)
WatchSessionStore.didReceiveApplicationContext
        │  writes envelope to App Group UserDefaults (per-device)
        │  triggers @Published snapshot update
        ▼
ActiveWorkoutGlance renders
```

### Set completion (watch → phone, no server hop)

```
User taps ✓ on watch → RIR picker → Confirm
        │
        ▼
SetCompletionCoordinator.completeSet
        │  builds { kind: "watchWroteSet", row: <full echoed CDC row> }
        ▼
WCSession.transferUserInfo(payload)   ← durable, queues if phone unreachable
        │
        ▼ (BLE, when phone is awake)
WCSessionDelegate on iOS:
WatchConnectivityPlugin.session(_:didReceiveUserInfo:)
        │  posts NotificationCenter event → notifyListeners("watchInbound", …)
        ▼
src/components/WatchInboundBridge.tsx (mounted at root layout)
        │  subscribeToWatchInbound → updateSet(uuid, fields) (mutations.ts)
        ▼
Dexie write → existing sync engine pushes to /api/sync/push
        │
        │ Phone Dexie live query fires
        ▼
buildWatchSnapshot → WC push → watch reflects new state (~200-400ms RTT)
```

The watch echoes ALL columns (`tag`, `comment`, `is_pr`, `excluded_from_pb`,
etc) on every confirm, even though it doesn't render them. Otherwise the
server-side `EXCLUDED.column` clause NULLs out fields the watch didn't
touch.

### Rest timer (designed; not yet implemented — see `watch-replan.md`)

Same pattern as set completion. Phone owns timer state; watch sends WC
messages to start / extend / skip and reads the timer from the next
snapshot.

## WC channel choices

| Direction | Use | WC method |
|---|---|---|
| Phone → watch (snapshot) | latest-wins, full-state | `updateApplicationContext` |
| Watch → phone (set confirm, future timer cmds) | durable queue, FIFO | `transferUserInfo` |

`transferUserInfo` survives watch process suspension and queues if the
phone is unreachable. No app-level outbox needed.

## Auth

The watch makes no network calls, so no auth on the watch. The phone's
existing Dexie sync engine continues to call `/api/sync/push` exactly as
it always has — same-origin, no header. Server route still has
`rejectIfBadApiKey()` as a generic defense for direct-from-attacker calls,
but no Rebirth client uses an Authorization header against this route
today.

## Schema versioning

`SchemaVersion.current = 1`. Every WC payload is wrapped as
`{ schema_version, body }`. Decoders use `decodeIfPresent` for unknown
keys so v1 watches survive v2 phone snapshots non-fatally. If a watch
sees `schema_version > supported`, it shows "Watch needs update" and
refuses the snapshot.

Snapshot byte budget: hard cap 50KB. History hint = last 1 session only,
max 10 sets per exercise. Comments truncated to 200 chars on watch echo
(phone keeps full text in Dexie).

## Conflict policy

Single-user, last-write-wins by row, no conflict detection. Server
stamps `updated_at = NOW()` on every push — never trusts client
timestamps for ordering. With phone as single writer, the historical
"phone Dexie + watch direct write race" no longer applies.

## HealthKit (HKLiveWorkoutBuilder)

`WorkoutSessionManager` on the watch starts an `HKWorkoutSession` the
first time a set is approved within a workout. `HKLiveWorkoutBuilder`
observes heart rate + active energy in real time and updates the
glance's "♥ 142 · 3:21" pill via `@Published` values.

On `endSession()` (called from `SessionEndView`'s "Finish & Save"):
- `HKWorkoutSession.end()`
- `builder.endCollection(at: now)`
- `builder.finishWorkout()` → returns `HKWorkout?` with HK-assigned UUID

Before saving, the builder gets `HKMetadataKeyExternalUUID` stamped with
the Rebirth workout UUID at builder creation. Phone-side `fetchWorkouts`
(`HealthKitPlugin.swift workoutToFullDict`) extracts that metadata for
dedup against `workouts.healthkit_uuid`. No explicit watch→phone WC
round-trip needed for the UUID — eventual consistency via the existing
HK fetch pipeline.

`WKBackgroundModes` includes `workout-processing` so the session keeps
running when the watch screen sleeps mid-session.

## What NOT to do

- Don't have the watch make HTTP calls to the Rebirth API. Phone is the
  single writer.
- Don't add a watch-side outbox or API client. WC.transferUserInfo has
  its own delivery queue and survives suspension.
- Don't use `update_sets` (mcp-tools.ts) for set completion — that's a
  routine-target editor, will wipe set state. The phone path uses
  `mutations.updateSet` against Dexie, which the sync engine pushes to
  `/api/sync/push`.
- Don't try to generate `HKWorkout.uuid` watch-side — it's HK-assigned at
  finish time. Use `HKMetadataKeyExternalUUID`.
- Don't write to App Group on the iPhone side expecting the watch to
  read it. App Groups are per-device. Watch writes to its own container
  on receipt of the WC payload.
- Don't reintroduce a watch-owned timer state (Day 13 is replacing the
  local `Timer.publish` ring with snapshot-driven). Snapshot is truth.

## Related files

| Concern | File |
|---|---|
| Snapshot builder | `src/lib/watch.ts` |
| Phone push trigger | `src/app/workout/page.tsx` (useEffect on workout) |
| Inbound bridge | `src/components/WatchInboundBridge.tsx` |
| iOS plugin | `ios/App/App/WatchConnectivityPlugin.swift` |
| Watch app entry | `ios/RebirthWatch/RebirthWatchApp.swift` |
| Glance UI | `ios/RebirthWatch/ActiveWorkoutGlance.swift` |
| Set completion | `ios/RebirthWatch/SetCompletionCoordinator.swift` |
| HKLive lifecycle | `ios/RebirthWatch/WorkoutSessionManager.swift` |
| Snapshot model | `RebirthShared/Sources/RebirthModels/ActiveWorkoutSnapshot.swift` |
| Snapshot persistence | `RebirthShared/Sources/RebirthAppGroup/` |
| Watch logging | `RebirthShared/Sources/RebirthWatchLog/WatchLog.swift` |
| Server route | `src/app/api/sync/push/route.ts` |
| iOS rest timer (Live Activity) | `ios/App/App/RestTimerPlugin.swift` |
| JS rest timer wrapper | `src/lib/native/rest-timer-activity.ts` |
| Setup script | `scripts/setup-watch-targets.rb` |
| Cap-sync guard | `scripts/cap-post-sync.mjs` |
