# Watch companion — architecture

A single-page reference for how the watch app talks to the iOS app and the
server. For per-day implementation details, see `PLAN-watch.md`.

## Targets

```
ios/App/App.xcodeproj
├── App                         iOS app (Capacitor host)
├── RestTimerLiveActivity       existing iOS Live Activity extension
├── FitspoControlExtension      existing Control Center extension
├── RebirthWatch                NEW — watchOS 10+ SwiftUI app
└── RebirthWatchComplications   NEW — WidgetKit extension for the watch

RebirthShared/                  NEW — local SPM package
├── RebirthModels               snapshot + CDC types, schema versioning
├── RebirthAPI                  typed client for /api/sync/push
├── RebirthKeychain             access-group keychain wrapper
├── RebirthAppGroup             UserDefaults + outbox SQLite path
├── RebirthOutbox               SQLite-backed mutation queue
└── RebirthWatchLog             os_log + rotating file in app group
```

Bundle IDs:
- `app.rebirth` (iOS app)
- `app.rebirth.watchkitapp`
- `app.rebirth.watchkitapp.complications`

App Group: `group.app.rebirth` (already configured pre-watch).

## Data flow

```
Phone Dexie live query (workout_sets)
        │
        │ useCurrentWorkoutFull() in useLocalDB.ts
        ▼
src/app/workout/page.tsx useEffect
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
        │  writes envelope to App Group UserDefaults
        │  triggers @Published snapshot update
        ▼
ActiveWorkoutGlance renders


Set completion (watch → server):

User taps ✓ → RIR picker → Confirm
        │
        ▼
SetCompletionCoordinator.completeSet
        │  applyOptimistic — write marked-complete snapshot to App Group
        │  build WorkoutSetCDCRow.fromCompletion (echoes ALL columns)
        │  enqueue in SQLite outbox (idempotent on mutation_id)
        ▼
RebirthAPIClient.rawPost("/api/sync/push", body)
        │  Authorization: Bearer <REBIRTH_API_KEY> from shared keychain
        ▼
/api/sync/push  (rejectIfBadApiKey first)
        │  upsert row into workout_sets
        │  recompute is_pr at end of batch
        ▼
Postgres
        │
        │ phone Dexie pull on next foreground (existing sync engine)
        ▼
Phone Dexie sees the row via change_log
```

## Outbox semantics

| HTTP outcome | Action |
|---|---|
| 200 OK | Drop from outbox |
| 401 Unauthorized | Halt outbox, show re-auth banner. No retry. |
| 4xx (validation) | Drop with toast. Retry won't help. |
| 5xx server error | Increment attempt_count, leave queued |
| Network error | Increment attempt_count, leave queued |

`NWPathMonitor` flushes the outbox when the path becomes `.satisfied`.

Non-completion mutations dead-letter after 3 attempts. Completions
(`is_completed:true` in body) retry forever — that's the data the user
explicitly captured.

## Auth

API key (`REBIRTH_API_KEY`) is written to keychain access group
`group.app.rebirth` by the iOS app via the
`WatchConnectivityPlugin.setApiKey(key)` method. The watch reads it on
first launch. Both targets must be signed by the same Apple Developer
Team (currently `43687B2JMB`). Different teams = `errSecItemNotFound`
on watch reads = "Re-pair from phone" deeplink.

## Schema versioning

`SchemaVersion.current = 1`. Every WC payload is wrapped as
`{ schema_version, body }`. Decoders use `decodeIfPresent` for unknown
keys so v1 watches survive v2 phone snapshots non-fatally. If a watch
sees `schema_version > supported`, it shows "Watch needs update" and
refuses the snapshot.

## Conflict policy

Single-user, last-write-wins by row, no conflict detection. Server
stamps `updated_at = NOW()` on every push — never trusts client
timestamps for ordering. Phone Dexie + watch direct write race within
the same second: watch typically wins because it's direct, phone is
batched. Acceptable trade-off documented at
`src/app/api/sync/push/route.ts:14`.

## HealthKit (HKLiveWorkoutBuilder)

`WorkoutSessionManager` on the watch starts an `HKWorkoutSession` the
first time a set is approved within a workout. `HKLiveWorkoutBuilder`
observes heart rate + active energy in real time and updates the
glance's "♥ 142 · 3:21" pill via @Published values.

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

- Don't use `update_sets` (mcp-tools.ts:3611) for set completion —
  that's a routine-target editor, will wipe set state.
- Don't try to generate `HKWorkout.uuid` watch-side — it's HK-assigned
  at finish time. Use `HKMetadataKeyExternalUUID`.
- Don't write to App Group on the iPhone side expecting the watch to
  read it. App Groups are per-device. Watch writes to its own container
  on receipt of the WC payload.
- Don't bake the API key into the watch binary. Always read from shared
  keychain, surface re-pair banner if missing.

## Related files

| Concern | File |
|---|---|
| Snapshot builder | `src/lib/watch.ts` |
| Phone push trigger | `src/app/workout/page.tsx` (useEffect on workout) |
| iOS plugin | `ios/App/App/WatchConnectivityPlugin.swift` |
| Watch app entry | `ios/RebirthWatch/RebirthWatchApp.swift` |
| Glance UI | `ios/RebirthWatch/ActiveWorkoutGlance.swift` |
| Set completion | `ios/RebirthWatch/SetCompletionCoordinator.swift` |
| HKLive lifecycle | `ios/RebirthWatch/WorkoutSessionManager.swift` |
| Outbox | `RebirthShared/Sources/RebirthOutbox/Outbox.swift` |
| API client | `RebirthShared/Sources/RebirthAPI/APIClient.swift` |
| Server route | `src/app/api/sync/push/route.ts` |
| Auth | `src/lib/api-auth.ts` (helper) + route-local `rejectIfBadApiKey` |
| Setup script | `scripts/setup-watch-targets.rb` |
| Cap-sync guard | `scripts/cap-post-sync.mjs` |
