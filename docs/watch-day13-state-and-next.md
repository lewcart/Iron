# Watch companion — end of Day 13 + plan for next session

## State of the branch

`feat/watch-companion` is 14+ commits ahead of `main`. All 12 days from
`PLAN-watch.md` are landed, plus a `/review` pass and a Day-13 architectural
rework.

### What works

- **Set completion via WC routing (rework)**: tap ✓ on watch → RIR picker →
  confirm. The watch sends a CDC row via `WC.transferUserInfo`. iOS plugin
  forwards to JS. `WatchInboundBridge` calls `mutations.updateSet()` →
  Dexie writes → existing sync engine pushes to server. Phone is the
  single writer to Postgres. No API key on watch, no watch-side outbox.
- **Snapshot push** from phone → watch on every Dexie change (debounced 200ms).
- **Glance UI** (compact for 40mm): exercise name + HR pill on header row,
  inline `80 kg × 8` hero, set chip moved onto the ✓ pill.
- **Tap-to-dial weight** in 1kg steps (rounded — no Crown drift).
- **Tap-to-dial reps** in 1-rep steps.
- **PB haptic + pill** (local Epley detection).
- **HRV pill** (descriptive only).
- **HKLiveWorkoutBuilder** session for real HR + kcal.
- **Watch icon** (sourced from iOS app icon).
- **iOS App embeds the watch app** via "Embed Watch Content" build phase,
  so iPhone-side `WCSession.isWatchAppInstalled` returns true and the
  iPhone relays the watch app to the paired watch automatically.
- **Stale WC transfer cancel** on watch app launch (clears leftover
  pending counts from previous builds).

### What's broken or unfinished

1. **Rest timer is architecturally wrong.** Watch's `CountdownRing` and
   the iOS `RestTimerPlugin` (Live Activity / Dynamic Island) are two
   separate timer universes that don't share state. Symptoms:
   - Watch starts a rest timer; phone's Dynamic Island shows nothing.
   - Watch "Skip" sometimes doesn't fully stop the timer (SwiftUI
     `Timer.publish().autoconnect()` lifecycle issue + sheet dismissal
     race).
   - Phone-started rest timer doesn't show on the watch.
2. **Undo banner removed.** Was UI-only and visually broke on small watch.
   Server-side compensating mutation deferred indefinitely.
3. **WatchDiagnosticBar removed.** Magenta debug pill we added during
   troubleshooting. Not for production.
4. **Real-device WC delivery** has been verified for set completion (Lou
   confirmed visual sync to phone after the bug fix in
   `WatchConnectivityPlugin.session(_:didReceiveUserInfo:)`), but only
   end-to-end tested for one session.
5. **iPhone Mirroring** for video recording requires Apple Watch Series 6+
   or SE 2nd-gen. Lou has SE 1st-gen. Hardware screenshots only.

## The right architecture for the rest timer (next session)

Mirror what we just did for set completion. Phone owns the timer state.
Watch is a thin display + remote control.

```
Watch ✓ + RIR confirm
    │
    ▼
WC message: { kind: "startRest", durationSec: 90, startedAt: <epoch> }
    │
    ▼
iOS plugin → JS event → existing RestTimerPlugin.start({...})
    │  (Live Activity boots on phone, Dynamic Island countdown starts)
    │
    │ Phone embeds rest timer state in the snapshot push:
    │   snapshot.rest_timer = {
    │     started_at_epoch_ms: ...,
    │     duration_sec: 90,
    │     overtime_start_epoch_ms?: ...
    │   }
    ▼
Watch reads snapshot.rest_timer, computes remaining locally each tick,
displays countdown. No watch-owned timer state.

Watch Skip
    │
    ▼
WC message: { kind: "stopRest" }
    │
    ▼
Phone RestTimerPlugin.end() → Live Activity dismisses
→ next snapshot push has rest_timer = null
→ watch sheet auto-dismisses
```

One source of truth. Started on either device, visible on both, stopped
from either, ends everywhere when done.

### Concrete changes for the next session

- Add `rest_timer` field to `ActiveWorkoutSnapshot` (Swift + TS):
  `{ startedAtMs, durationSec, overtimeStartMs? } | null`
- Phone: when `RestTimerPlugin.start` fires (from any source — watch WC
  message, phone-side rest button, etc), update Dexie or app-state with
  the timer info. The next snapshot push includes it.
- Watch: drop self-managed `restCountdown: Int?` state. Replace with
  `snapshot.restTimer != nil` driving sheet presentation. CountdownRing
  reads `startedAtMs` + `durationSec` from snapshot, computes remaining
  via `Date()` on each tick.
- Watch Skip button: WC.transferUserInfo `{ kind: "stopRest" }`. Phone
  receives → `RestTimerPlugin.end()` → snapshot updates → sheet dismisses.
- Watch +30s extend: WC.transferUserInfo `{ kind: "extendRest", seconds: 30 }`.
- Phone: existing `rest-timer-utils.ts` already has the heart of the
  state machine. Wire WC inbound to it.
- The blue → pink color shift on overtime stays in `CountdownRing`,
  driven by snapshot's `overtimeStartMs` field.

### Day-13 rework that stays

The set-completion path is correct as it stands. The same model applies
to the timer; we just haven't finished it.

```
Watch action → WC message → phone applies → phone broadcasts state →
watch reflects.
```

## Files of note (for the next session)

| File | Status |
|---|---|
| `ios/RebirthWatch/SetCompletionCoordinator.swift` | Reworked Day-13. WC-only. |
| `ios/RebirthWatch/CountdownRing.swift` | Has overtime logic. Needs to be driven by snapshot, not local Timer.publish. |
| `ios/RebirthWatch/RebirthWatchApp.swift` | `restCountdown` state needs to come from snapshot. |
| `ios/App/App/WatchConnectivityPlugin.swift` | Forwards inbound WC messages as JS events. Add `startRest`/`stopRest` handler routing. |
| `src/components/WatchInboundBridge.tsx` | Add a handler for `startRest`/`stopRest` that calls existing `RestTimer.start/.end`. |
| `RebirthShared/Sources/RebirthModels/ActiveWorkoutSnapshot.swift` | Add `restTimer: RestTimerHint?` field. |
| `src/lib/watch.ts` | Add `restTimer` to `WatchSnapshot` + `buildWatchSnapshot`. |
| `ios/App/App/RestTimerPlugin.swift` | Existing iOS plugin. Source of truth for timer state. |
| `src/lib/native/rest-timer-activity.ts` | Existing JS wrapper. Already has the start/update/end API. |

## Suggested next-session flow

1. Commit current state (this is what `/ship` would land if we shipped
   today — minus the broken timer).
2. Spawn a fresh session.
3. Run `/plan-eng-review` against this doc to validate the timer
   architecture before coding.
4. Implement against the agreed plan.
5. Verify on real watch + iPhone end-to-end.

## What NOT to do next session

- Don't reintroduce a watch-owned timer state. Snapshot is truth.
- Don't add a separate API surface for the timer. `WC` is the channel,
  same as set completion.
- Don't add an undo banner without the server-side compensating mutation
  (Day 12 deferred, can stay deferred).
- Don't add an outbox to the watch. WC.transferUserInfo has its own
  delivery queue.
