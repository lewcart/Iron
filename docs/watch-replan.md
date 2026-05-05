<!-- /autoplan restore point: /Users/lewis/.gstack/projects/lewcart-Iron/feat-watch-companion-autoplan-restore-20260504-191248.md -->
# Watch companion — replan (2026-05-05, post-/autoplan)

This doc supersedes the previous `watch-day13-state-and-next.md`. It captures
the post-cleanup state of `feat/watch-companion`, the decisions audited by
this replan, and the rest-timer architecture validated through a 4-voice
`/autoplan` review (CEO + Design + Eng × Claude + Codex, all independent).

For the standing architecture reference, see `docs/watch-architecture.md`.
For the original day-by-day plan (partly superseded), see `PLAN-watch.md`.

## State of the branch

`feat/watch-companion` is 19+ commits ahead of `main`. All 12 days of the
original `PLAN-watch.md` landed, plus a `/review` pass, the Day-13
architectural pivot, and (this commit) the cleanup of the obsolete
API-key + outbox apparatus.

### What works (verified)

- Set completion via WC routing: tap ✓ on watch → RIR picker → confirm.
  Watch sends `{ kind: "watchWroteSet", row: <full echoed CDC row> }` via
  `WC.transferUserInfo`. iOS plugin forwards to JS; `WatchInboundBridge`
  calls `mutations.updateSet()` → Dexie write → existing sync engine
  pushes to server. Phone is single writer.
- Snapshot push from phone → watch on every Dexie change (debounced 200ms).
- Glance UI (compact for 40mm): exercise name + HR pill on header row,
  inline `80 kg × 8` hero, set chip on the ✓ pill.
- Tap-to-dial weight (1kg steps) and reps (1-rep steps). No Crown drift.
- PB haptic + pill (local Epley detection).
- HRV pill (descriptive only — no prescription).
- HKLiveWorkoutBuilder session for real HR + kcal, with
  `HKMetadataKeyExternalUUID` for HK→Rebirth dedup.
- Watch icon (sourced from iOS app icon).
- iOS app embeds the watch app via "Embed Watch Content" build phase.
- Stale WC transfer cancel on watch app launch.

### Cleanup landed this session

Removed the obsolete API-key + outbox apparatus (RebirthAPI, RebirthOutbox,
RebirthKeychain SPM modules + their tests + plugin methods + JS exports +
project.pbxproj wirings + setup script products). Stale architecture docs
rewritten. See git log for the cleanup commit.

### What's broken / not yet implemented

1. **Rest timer not implemented on the watch.** Day 13 removed the broken
   local `Timer.publish` ring. `CountdownRing.swift` exists but has no
   caller. This doc plans the replacement.
2. **iPhone Mirroring** for video recording requires Series 6+ or SE 2nd-gen.
   Lou has SE 1st-gen. Hardware screenshots only.

## /autoplan review outcome

Four independent voices (CEO Claude, CEO Codex, Eng Claude, Eng Codex)
reviewed an earlier draft of this plan that proposed an optimistic-render
state machine with `mutation_id` reconciliation, ±2s tolerance, and a
2s drop-after timeout. Design Claude + Design Codex reviewed UX.

**All four engineering/strategy voices independently converged on the same
architectural recommendation: drop the optimistic layer, drop the separate
`startRest` WC command, derive rest start from the set-completion
transition itself.** Lou confirmed this direction at the gate, with the
explicit priority: parity + sync between watch and phone is non-negotiable;
~400ms perceptible delay between watch ✓ and ring is acceptable.

This document reflects the revised architecture. See `## /autoplan audit
trail` at the bottom for the consensus tables and decision log.

## Audited decisions (KEEP)

| Decision | Status |
|---|---|
| Phone = single writer to Postgres | sound |
| WC.transferUserInfo for set completion | sound; survives suspension, FIFO |
| `WatchSnapshot` debounced push from phone Dexie live query | sound |
| `HKLiveWorkoutBuilder` + `HKMetadataKeyExternalUUID` | sound |
| Tap-to-dial weight/reps (1-unit steps) | sound; avoids Crown drift |
| iOS app "Embed Watch Content" build phase | works |
| Schema versioning on every WC payload | sound |
| `WATCH_MOCK_SNAPSHOT` dev flag | useful — keep |
| Snapshot byte budget 50KB; comments truncated to 200 chars | sound |

## Rest-timer architecture — strict snapshot

```
Watch ✓ + RIR confirm
    │
    └─→ WC.transferUserInfo { kind: "watchWroteSet", row: <CDC row> }
        (Set UUID is the natural idempotency key for everything below.)

iOS plugin → JS `watchInbound` event →
src/components/WatchInboundBridge.tsx handler:
  1. mutations.updateSet(row.uuid, …) → Dexie write
  2. From the SAME handler, derive rest duration:
       restSec = routine_exercise.rest_seconds
              ?? lastUsedRest[exercise_uuid]
              ?? 90  // floor
     and call rest-timer-state.startRestTimer({
       setUuid: row.uuid,        // idempotency key
       restSec,
       exerciseName,             // for Live Activity copy
       setNumber,                // for Live Activity copy
     })
  3. The store calls RestTimerPlugin.start({ endTime: now+restSec*1000, ... })
     (Live Activity / Dynamic Island; treated as decoration — see below)
  4. The store publishes the new rest_timer state and persists to localStorage.

Phone snapshot push (debounced 200ms) now includes:
  snapshot.rest_timer = {
    end_at_ms: <phone-authored absolute epoch ms>,
    duration_sec: <restSec>,
    overtime_start_ms?: <set when timer crosses zero>,
    set_uuid: <which set this rest follows; idempotency anchor>
  } | null

Watch reads snapshot.rest_timer and renders via TimelineView. No watch-side
state machine. No mutation_id. No reconciliation. No 2s timeout. The
sheet's isPresented derives from snapshot.rest_timer != nil.

Watch Skip
    │
    └─→ WC.transferUserInfo { kind: "stopRest", set_uuid }
         WatchInboundBridge → rest-timer-state.endRestTimer({ setUuid }) →
         RestTimerPlugin.end() → snapshot pushes rest_timer = null →
         watch sheet auto-dismisses on next snapshot.

Watch +30s
    │
    └─→ WC.transferUserInfo { kind: "extendRest", seconds: 30, set_uuid }
         WatchInboundBridge → rest-timer-state.extendRestTimer({ setUuid, 30 }) →
         RestTimerPlugin.update({ endTime: oldEnd+30000 }) →
         snapshot pushes rest_timer with new end_at_ms →
         watch ring redraws.

Phone +30s / Skip on phone (existing iOS Live Activity path)
    │
    └─→ Same store mutations. Snapshot pushes. Watch reflects.
```

### Why this is the right shape (per the 4-voice review)

- **No queued-stale-startRest critical bug.** If the watch is out of range,
  `watchWroteSet` queues. The phone receives it later, applies the set,
  and from the same handler decides whether to start rest. If
  `now - row.completed_at_ms > 30s`, phone skips the rest auto-start
  (set is too old; Lou is past it). Snapshot stays null.
- **Set UUID is the idempotency key.** Duplicate WC delivery → same
  `setUuid` → store ignores within 5s window. No mutation_id needed.
- **`end_at_ms` is phone-authored**, so clock-skew between watch and phone
  doesn't corrupt the math. Watch's local `Date()` only matters for
  computing how to render — both surfaces compute against the same
  absolute epoch.
- **Live Activity is decoration, not authoritative parity.** If the user
  has Live Activities globally disabled, the phone's in-app rest UI is
  authoritative; snapshot still reflects truth; watch ring still shows.
  No half-state.
- **JS-killed-mid-rest survives.** The store persists to localStorage on
  every mutation. On JS revive: hydrate from localStorage, reconcile with
  `RestTimerPlugin.currentActivity()` (extend the plugin to expose this
  if needed), call `endRestActivity()` if an orphaned Activity is found
  with no matching store state.

## Rest-timer UX (from /autoplan design review)

### Sheet layout (40mm SE, no AOD)

- Hero: `mm:ss` numeric, SF Rounded Semibold ~44pt, centered. Mono digits
  to prevent jitter. Color: `.systemBlue` countdown, `.systemPink` overtime.
- Sub-line above number: `Set 3 · Bench Press`, SF Pro Rounded 13pt,
  `.secondary`.
- Ring: 6pt stroke, ~140pt diameter, sweeps clockwise from 12. Decoration —
  number is the focal element, ring is secondary.
- Buttons (bottom 25%, side by side): `+30` (left, secondary pill) and
  `Skip` (right, prominent pill). Both ≥44×44pt tap targets. In overtime,
  `Skip` relabels to `Done`.
- Sheet stays through overtime until Skip/Done. Auto-dismisses only when
  snapshot says rest_timer = null.
- Crown is **ignored** for rest scrub. (Codex: non-haptic crown is bad UX
  for continuous adjustment; +30s is the canonical extension.)

### Haptic palette

- 10s remaining: `.start` (one tap)
- 3s preroll: `.click` × 3 (one per second from 3s → 1s)
- Zero-cross to overtime: `.success`
- Every 30s in overtime: `.click` (gentle reminder)
- Skip / Done pressed: `.stop`
- +30s pressed: `.start`
- Set confirmed (existing): unchanged

Rationale: SE 1st-gen has no AOD, so the screen is dark for most of rest.
Haptics are the primary attention-grab. The 10s + 3s preroll lets Lou look
down BEFORE zero-cross instead of after.

### State matrix

| State | Trigger | UI |
|---|---|---|
| Active countdown | `snapshot.rest_timer.overtime_start_ms == null` | Blue ring, mm:ss countdown |
| Overtime | `overtime_start_ms != null` | Pink ring sweeps reverse, `+mm:ss` count-up, "Done" button |
| Cold-launch mid-rest | Watch wakes, snapshot has rest_timer with stale `end_at_ms` | Render whatever the snapshot says (could be deep overtime) |
| Sheet swipe-down (SE 1st-gen will fire) | Lou swipes the sheet | Sheet stays — `isPresented.set` is no-op; snapshot is truth |
| Skip in flight (network blip) | Lou taps Skip, snapshot delayed | `Skip` button disables for 1s; if no snapshot in 5s, re-enable with no error toast (snapshot is eventual; user can tap again) |
| +30s in flight | Lou taps +30s, snapshot delayed | `+30` button disables for 800ms; ring redraws when snapshot arrives |
| Workout finished mid-rest | Lou taps Finish on phone | Phone calls `endRestTimer()` first; snapshot null; sheet dismisses |
| Live Activity disabled globally | iOS Settings toggle off | Snapshot still authoritative; phone in-app UI shows timer; Dynamic Island silent |
| ActivityKit start refused | `RestTimerPlugin.start` returns failure | Store still publishes rest_timer (snapshot truth); only the Live Activity is skipped |

## Concrete file changes

### Schema additions

```swift
// RebirthShared/Sources/RebirthModels/ActiveWorkoutSnapshot.swift
public struct RestTimerHint: Codable, Sendable, Equatable {
    public let endAtMs: Int64
    public let durationSec: Int
    public let overtimeStartMs: Int64?
    public let setUuid: String  // idempotency anchor
    public init(endAtMs: Int64, durationSec: Int,
                overtimeStartMs: Int64? = nil, setUuid: String) {
        self.endAtMs = endAtMs
        self.durationSec = durationSec
        self.overtimeStartMs = overtimeStartMs
        self.setUuid = setUuid
    }
}

// In the ActiveWorkoutSnapshot STRUCT (NOT extension — Swift doesn't allow
// stored properties via extension):
public struct ActiveWorkoutSnapshot: Codable, Sendable, Equatable {
    // … existing fields …
    public let restTimer: RestTimerHint?  // nil when no rest active

    // Update memberwise + custom init(from:) to handle the new field.
    enum CodingKeys: String, CodingKey {
        // … existing …
        case restTimer = "rest_timer"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // … existing fields …
        self.restTimer = try c.decodeIfPresent(RestTimerHint.self, forKey: .restTimer)
    }
}
```

```ts
// src/lib/watch.ts
export interface WatchRestTimer {
  end_at_ms: number;
  duration_sec: number;
  overtime_start_ms: number | null;
  set_uuid: string;
}

export interface WatchSnapshot {
  // … existing …
  rest_timer: WatchRestTimer | null;
}
```

### Phone-side rest-timer store

`src/lib/rest-timer-state.ts` — NEW. Replaces the inline logic currently in
`useRestTimer` hook at `src/app/workout/page.tsx:95`. Centralized,
persistent, snapshot-subscribable.

```ts
// Public API:
export function startRestTimer(opts: {
  setUuid: string;
  restSec: number;
  exerciseName?: string;
  setNumber?: number;
}): { started: boolean };  // false if duplicate (same setUuid within 5s)

export function extendRestTimer(opts: { setUuid: string; seconds: number }): void;
export function endRestTimer(opts?: { setUuid?: string }): void;  // setUuid optional for "kill any active"
export function getRestTimer(): WatchRestTimer | null;  // for buildWatchSnapshot
export function subscribeRestTimer(cb: (s: WatchRestTimer | null) => void): () => void;

// Persistence: every mutation writes JSON to localStorage('rebirth-rest-timer').
// Hydration: on module init, read localStorage; if Activity-state is
// reachable, reconcile (call RestTimerPlugin.currentActivity()? — extend
// the plugin to expose this; if no current activity but localStorage says
// active, call endRestActivity() to clear the orphan).
```

`useRestTimer` (the React hook) is rewritten as a thin wrapper around the
store with `subscribeRestTimer`. Existing iOS Live Activity / Dynamic
Island UI flows are unchanged at the call site — they go through the
store now instead of inline state.

### Watch-side rewrite

```swift
// ios/RebirthWatch/CountdownRing.swift — full rewrite
struct CountdownRing: View {
    let hint: RestTimerHint
    let onSkip: () -> Void
    let onExtend30: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.25)) { ctx in
            let nowMs = Int64(ctx.date.timeIntervalSince1970 * 1000)
            let remainingMs = hint.endAtMs - nowMs
            let inOvertime = remainingMs <= 0 || hint.overtimeStartMs != nil
            // … render number hero + ring + buttons …
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(inOvertime ? "Done" : "Skip", action: onSkip)
            }
        }
    }
}
```

```swift
// ios/RebirthWatch/RebirthWatchApp.swift
// REMOVE: @State var restCountdown: Int?
// REMOVE: anywhere that sets it.

.sheet(isPresented: Binding(
    get: { store.snapshot?.restTimer != nil },
    set: { _ in /* dismissal driven by snapshot transition */ }
)) {
    if let hint = store.snapshot?.restTimer {
        CountdownRing(hint: hint,
                      onSkip: { sendStopRest(setUuid: hint.setUuid) },
                      onExtend30: { sendExtendRest(seconds: 30, setUuid: hint.setUuid) })
    }
}
```

```swift
// ios/RebirthWatch/SetCompletionCoordinator.swift
// NO changes to existing watchWroteSet flow.
// ADD helpers:
func sendStopRest(setUuid: String) {
    WCSession.default.transferUserInfo([
        "kind": "stopRest", "set_uuid": setUuid
    ])
    WKInterfaceDevice.current().play(.stop)
}
func sendExtendRest(seconds: Int, setUuid: String) {
    WCSession.default.transferUserInfo([
        "kind": "extendRest", "seconds": seconds, "set_uuid": setUuid
    ])
    WKInterfaceDevice.current().play(.start)
}
// NOTE: NO sendStartRest — phone derives rest from watchWroteSet.
```

### Phone-side WatchInboundBridge

```tsx
// src/components/WatchInboundBridge.tsx
case 'watchWroteSet': {
  const row = payload.row;
  if (!row?.uuid) return;
  await updateSet(row.uuid, { /* existing fields */ });

  // NEW: derive rest duration and start the timer from the same handler.
  if (row.is_completed) {
    const completedAtMs = row.completed_at_ms ?? Date.now();
    if (Date.now() - completedAtMs > 30_000) return;  // queued-stale guard

    const restSec = await resolveRestSeconds({
      workoutExerciseUuid: row.workout_exercise_uuid,
      exerciseUuid: row.exercise_uuid,
    });
    startRestTimer({ setUuid: row.uuid, restSec, /* … */ });
  }
  break;
}
case 'stopRest':
  endRestTimer({ setUuid: payload.set_uuid });
  break;
case 'extendRest':
  extendRestTimer({ setUuid: payload.set_uuid, seconds: payload.seconds });
  break;
```

`resolveRestSeconds` reads:
1. `routine_exercise.rest_seconds` (per-exercise routine target — Lou's pick)
2. fallback: last-used rest for this `exercise_uuid` (cached in
   localStorage by the store)
3. floor: 90s

### Files modified / added

| File | Change |
|---|---|
| `RebirthShared/Sources/RebirthModels/ActiveWorkoutSnapshot.swift` | + `RestTimerHint` struct; + `restTimer` field in struct (NOT extension); + `decodeIfPresent` in custom init(from:); + memberwise init updates |
| `RebirthShared/Sources/RebirthModels/MockSnapshot.swift` | + `restTimer: nil` in factory |
| `RebirthShared/Tests/RebirthModelsTests/SnapshotCodecTests.swift` | + tests: missing rest_timer (back-compat), present rest_timer, future fields |
| `src/lib/watch.ts` | + `WatchRestTimer` interface + `rest_timer` field; `buildWatchSnapshot` reads from rest-timer-state |
| `src/lib/rest-timer-state.ts` | NEW — persistent store, hydration, idempotency, subscribers |
| `src/lib/__tests__/rest-timer-state.test.ts` | NEW — start/extend/end lifecycle, dedup, hydrate, overtime |
| `src/components/WatchInboundBridge.tsx` | + queued-stale guard; + rest auto-start derivation; + stopRest/extendRest handlers |
| `src/components/__tests__/WatchInboundBridge.test.tsx` | NEW — payload guards, idempotency, rest-on-completion |
| `src/app/workout/page.tsx` | refactor `useRestTimer` to use the store; snapshot push deps include rest-timer-state |
| `ios/App/App/WatchConnectivityPlugin.swift` | unchanged (kind-agnostic forwarder) |
| `ios/App/App/RestTimerPlugin.swift` | + `currentActivity()` returns active end_at_ms (for hydration reconcile); `start()` returns `{started: bool}` so the store knows when ActivityKit refused |
| `src/lib/native/rest-timer-activity.ts` | propagate started/refused from plugin |
| `ios/RebirthWatch/CountdownRing.swift` | rewrite — TimelineView, snapshot-driven, no Timer.publish |
| `ios/RebirthWatch/RebirthWatchApp.swift` | drop `restCountdown` state; sheet derives from snapshot |
| `ios/RebirthWatch/SetCompletionCoordinator.swift` | + `sendStopRest`, `sendExtendRest` helpers; NO sendStartRest |

## Validation plan

### Unit / integration tests

- `SnapshotCodecTests`: round-trip with `rest_timer` present, missing
  (back-compat), unknown future fields, byte-budget under 50KB.
- `rest-timer-state.test.ts`: start dedup within 5s, extend modifies
  end_at_ms, end clears state + localStorage, hydration on module init,
  overtime flip when end_at_ms < now, idempotency on duplicate WC delivery.
- `WatchInboundBridge.test.tsx`: malformed payload guards, rest-auto-start
  on completion, queued-stale guard rejects rest > 30s old.
- `buildWatchSnapshot` unit: emits `rest_timer` when store is active, null
  when not.

### Real-device E2E (must pass before merge)

1. Confirm a set on watch → ring appears within ~400ms (watch tap → WC
   delivery → phone updateSet → store.startRestTimer → snapshot push →
   watch render). Dynamic Island shows countdown.
2. Confirm a set on phone → watch shows ring within ~400ms.
3. Skip from watch → phone Dynamic Island dismisses, watch sheet
   dismisses on next snapshot.
4. Skip from phone → watch sheet dismisses.
5. +30s from watch → both ring and Dynamic Island extend.
6. +30s from phone → watch ring extends.
7. Run timer past zero → both surfaces flip to pink count-up. 10s + 3s
   preroll haptics fire on watch. Skip relabels to Done.
8. **Queued-stale path**: watch in airplane mode; confirm a set; wait 60s;
   take watch off airplane mode. Expect: set syncs but rest does NOT
   auto-start (phone applied set with `now - completed_at_ms > 30s`).
9. **Clock skew**: force watch's clock 5s ahead of phone (in sim or test
   harness). Verify ring renders the same `end_at_ms` countdown as the
   Dynamic Island ±0.5s — both compute against phone-authored absolute
   epoch.
10. **Live Activities disabled** (iOS Settings → Face ID & Passcode → off,
    or per-app toggle off). Confirm a set on watch. Expect: snapshot
    rest_timer != null, watch ring shows, phone Dynamic Island silent,
    phone in-app rest UI shows the timer.
11. **JS killed mid-rest**: kill the iOS app process via Xcode mid-rest.
    Relaunch. Expect: localStorage hydration restores rest state, snapshot
    pushes with same `end_at_ms`, watch ring continues seamlessly. If
    ActivityKit Activity was orphaned, hydration calls `endRestActivity()`
    to clean up.
12. **Workout finished mid-rest**: tap Finish on phone while watch ring
    is showing. Expect: phone's finish path calls `endRestTimer()` before
    closing the workout; snapshot null pushes; watch sheet dismisses.

## Suggested execution order

1. Schema additions (Swift + TS) + decoder updates + back-compat tests.
   Land independently; phone snapshot now carries rest_timer always-null.
2. Phone-side `rest-timer-state.ts` + `useRestTimer` refactor + tests +
   hydration. No watch changes yet — tests cover store lifecycle.
3. `RestTimerPlugin.swift` `currentActivity()` + `start()` return shape.
4. WatchInboundBridge handlers + queued-stale guard + tests.
5. Watch-side: `CountdownRing` rewrite + `RebirthWatchApp` sheet binding +
   `SetCompletionCoordinator` outbound helpers.
6. Real-device E2E (12 paths above).
7. Merge `feat/watch-companion` into `main` per ship policy. Delete
   branch + worktree.

## What NOT to do

- Don't reintroduce a watch-owned timer state machine (Timer.publish or
  optimistic countdown). Snapshot is the only timer truth.
- Don't add `mutation_id`. Set UUID is the idempotency key.
- Don't add a separate `startRest` WC command. Phone derives rest from
  the set transition.
- Don't ship the rest auto-start without the queued-stale guard. A
  60-minute-old `watchWroteSet` arriving from a re-paired watch must not
  start a rest timer.
- Don't treat ActivityKit / Live Activity as authoritative. Snapshot +
  phone in-app UI are authoritative; Live Activity is decoration.
- Don't add an undo banner for set completion (Day 12 deferred — can
  stay deferred).

---

## /autoplan audit trail

Reviewed 2026-05-05. 4 voices, 3 phases (CEO, Design, Eng). DX phase
skipped (no developer-facing scope — single-user app).

### CEO consensus (challenge surfaced + user-resolved)

| Dimension | Claude | Codex | Consensus |
|---|---|---|---|
| 1. Premises valid? | NO | NO | CHALLENGE → user confirmed snapshot-as-truth, watch-as-view, parity-priority |
| 2. Right problem? | NO | NO | CHALLENGE → user kept watch + rest-timer scope |
| 3. Scope calibration? | NO | NO | CHALLENGE → reframed: parity > latency |
| 4. Alternatives explored? | NO | NO | Resolved by reframe (option A is now plan) |
| 5. Competitive risks? | NO | NO | Acknowledged: Apple Workouts owns wrist; differentiator is set-logging |
| 6. 6-month trajectory? | NO | NO | Acknowledged: usage tripwire to be set post-merge |

User Challenge resolution: Lou confirmed watch + rest-timer in scope; he
moves between surfaces and parity is non-negotiable.

### Design consensus (gap-confirmed; addressed in this plan)

| Dimension | Claude | Codex | Consensus |
|---|---|---|---|
| 1. Information hierarchy specified? | NO | NO | GAP → fixed: number is hero, ring is decoration, sub-line for context |
| 2. All states designed? | NO | NO | GAP → state matrix added above |
| 3. Fits at AX text sizes? | NO | NO | TODO during impl: define AX-large fallback (stack buttons vertically) |
| 4. Phone-watch handoff UX? | NO | NO | GAP → fixed: button disable on in-flight, snapshot is truth, no error toasts |
| 5. Visual spec adequate? | NO | NO | GAP → fixed: fonts/colors/strokes/sizes specified |
| 6. Optimistic-render right-weighted? | NO | NO | CHALLENGE → resolved by adopting strict-snapshot |
| 7. Crown / haptic / lifecycle? | NO | NO | GAP → fixed: Crown ignored, haptic palette specified, sheet stays through overtime |

### Eng consensus (architectural rewrite adopted)

| Dimension | Claude | Codex | Consensus |
|---|---|---|---|
| 1. Architecture sound (orig plan)? | NO | NO | CHALLENGE → adopted strict-snapshot, dropped mutation_id, dropped optimistic |
| 2. Test coverage sufficient? | NO | NO | GAP → fixed: 4 new test files + back-compat codec tests |
| 3. Performance/clock-skew handled? | NO | NO | GAP → fixed: phone-authored end_at_ms |
| 4. Error paths handled? | NO | NO | GAP → fixed: queued-stale guard, JS-killed hydration, Live-Activity-disabled half-state, ActivityKit start refused |
| 5. Deployment risk manageable? | FIX-NEEDED | FIX-NEEDED | Fixed: invalid Swift extension corrected (struct field, not extension); decoder updates explicit |
| 6. Plan implementable as-is? | NO | NO | Fixed by this revision |

### Cross-phase themes (3+ phases, independent)

1. **Optimistic-render is over-engineered for a UI cue.** Flagged in
   CEO + Design + Eng. Resolved by adopting strict-snapshot.
2. **Validation plan tested plumbing not coverage.** Flagged in CEO + Eng.
   Resolved by adding unit/integration tests + 12-path E2E.
3. **Half-state risks** (Live Activity disabled, JS killed). Flagged in
   Design + Eng. Resolved by treating Live Activity as decoration and
   adding hydration reconcile.

### Decisions log

| # | Phase | Decision | Classification | Source |
|---|---|---|---|---|
| 1 | CEO | Keep watch app | User Challenge → user kept | gate |
| 2 | CEO | Keep rest-timer in scope | User Challenge → user kept | gate |
| 3 | Eng | Drop optimistic-render + mutation_id + 2s timeout | Auto (4-voice unanimous) | recommendation |
| 4 | Eng | Drop separate `startRest` WC command; derive from set transition | Auto (4-voice unanimous) | recommendation |
| 5 | Eng | Snapshot uses `end_at_ms` (phone-authored) not `started_at_ms`+`duration_sec` | Auto (Eng both voices) | recommendation |
| 6 | Eng | Set UUID is idempotency key | Auto (Eng both voices) | recommendation |
| 7 | Eng | Phone-side rest state in persistent store + hydration | Auto (Eng both voices) | recommendation |
| 8 | Eng | Queued-stale guard: skip rest auto-start if set age > 30s | Auto (Codex critical) | recommendation |
| 9 | Eng | ActivityKit treated as decoration; snapshot is truth | Auto (Eng both voices) | recommendation |
| 10 | Eng | `RestTimerPlugin.start` returns started/refused | Auto | recommendation |
| 11 | Eng | Decoder uses `decodeIfPresent` on rest_timer | Auto (Codex specific) | recommendation |
| 12 | Eng | `restTimer` is struct field, not extension (Swift correctness) | Auto (Codex specific) | recommendation |
| 13 | Design | Number is hero, ring is decoration | Auto (Design both voices) | recommendation |
| 14 | Design | Crown ignored; +30s is canonical extension | Taste (Codex argued) | gate |
| 15 | Design | Sheet stays through overtime; Skip relabels to "Done" | Auto (Design both voices) | recommendation |
| 16 | Design | 10s warning + 3s preroll haptics | Auto (Subagent flagged) | recommendation |
| 17 | Product | Default rest duration source: per-exercise routine target → last-used → 90s | User pick | gate |
| 18 | Eng | Tests: 4 new files (codec, store, bridge, build snapshot) | Auto | recommendation |
