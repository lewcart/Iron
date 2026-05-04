# PLAN — Per-exercise stopwatch (count-up timer) for time-based exercises

Branch: `feat/exercise-timer-stopwatch`
Worktree: `/Users/lewis/Developer/projects/Rebirth-worktrees/exercise-timer-stopwatch`
Author: Lou
Date: 2026-05-04

## Intent (one paragraph)

When logging a time-based exercise (`exercises.tracking_mode === 'time'`), tapping a
timer icon next to the duration input opens a full-screen stopwatch. It counts UP
from 0:00. The user stops it manually. The elapsed seconds drop into the duration
input on close. For unilateral exercises (each-leg / each-arm / has-sides), the
stopwatch auto-cycles: stop side-1 → 10s switch countdown → resume counting up for
side-2 → user stops side-2 → final logged duration is the longer of the two sides
(or the sum, see Open Questions). RIR is hidden on time-mode rows; an RPE 1–10
chip strip replaces it. RPE is bridged into the existing RIR-based hypertrophy
math by storing `rir = 10 − rpe` alongside `rpe` on write.

## Why now

- Lou's androgodess plan includes timed-hold work (planks, dead-hangs, Copenhagens,
  carries). Today these get a number typed manually. That's friction and it produces
  guess-numbers, not measured ones.
- Existing rest-timer infrastructure (`src/app/workout/rest-timer-utils.ts` +
  the `useRestTimer` hook in `workout/page.tsx`) already solves the hard problem
  (background-safe absolute-time persistence, Live Activity, audio, haptics). A
  count-up stopwatch is a smaller cousin of that work.
- RIR on time-mode sets is currently rendered but technically incoherent (see
  conversation 2026-05-04: comment at `workout/page.tsx:1011` claims "time-mode
  uses isNewLongestHold checked elsewhere," but `SetRow:1146` renders the RIR
  slider regardless of `trackingMode`). Replacing it with RPE is the right time
  to fix the inconsistency.

## Scope

### In scope

1. **Stopwatch overlay component** (`src/app/workout/StopwatchSheet.tsx` — new file).
   Full-screen, mirrors the visual language of `RestTimerSheet` but counts up.
2. **Timer icon button** in `SetRow` time-mode branch (`workout/page.tsx:1098–1110`),
   inserted between the duration input and the unit label. Lucide `Timer` icon.
   `min-h-[44px]` tap target per the projections-page pattern.
3. **Background-safe count-up hook** `useStopwatch()` parallel to `useRestTimer()`,
   keyed on a separate localStorage namespace (`rebirth-stopwatch-*`) so a running
   rest timer and a running stopwatch coexist.
4. **Schema migration 041** adding `exercises.has_sides BOOLEAN NOT NULL DEFAULT false`.
   Surfaced as a "has sides" toggle on the exercise edit screen (find via
   `/exercises/[uuid]`). Used by the stopwatch to decide whether to enter a 10s
   switch countdown after the first stop.
5. **Side-cycling state machine** inside the stopwatch:
   `idle → counting(side=1) → switching(10s countdown) → counting(side=2) → done`.
   Single "Stop" button drives transitions. "Cancel" abandons. "Skip switch"
   short-circuits the 10s countdown (covers the "I'm already on side 2" case).
6. **RPE 1–10 chip strip on time-mode sets**. Reuse existing `workout_sets.rpe`
   column (currently nullable float, never written by UI — see `types.ts:53`).
   New convention: integer 1–10, where 10 = volitional failure / form broke.
7. **RIR/RPE bridge on write**: when a time-mode set's RPE is updated, also
   store `rir = clamp(10 − rpe, 0, 5)` so the SQL `effective_set_count` weighting
   in `src/db/queries.ts:1367–1372` and the JUNK badge in `MusclesThisWeek.tsx`
   continue to work without SQL changes.
8. **Settings**: respect existing audio/haptic/notification permissions. The
   stopwatch fires no end-of-set notification (it counts up indefinitely; only
   the 10s switch interval emits a beep). Optional setting
   `rebirth-stopwatch-haptic-tick` (default off) for a haptic pulse every 60s
   to reassure the user the stopwatch is still alive when backgrounded.
9. **Tests**: `useStopwatch` hook test + `stopwatch-utils.ts` pure-fn tests
   following the `rest-timer-utils.test.ts` pattern. Test the side-cycling
   state machine deterministically.

### NOT in scope (deferred to TODOS.md)

- Multi-side exercises with > 2 sides (e.g. Turkish get-up complex).
- Routine-template authoring of `has_sides` (assume manual flag on each
  exercise; bulk audit can come later).
- iOS Live Activity for the stopwatch (rest timer's LiveActivity is
  countdown-shaped; stopwatch needs a different widget — defer).
- HealthKit workout-segment integration.
- Importing `has_sides` from EverKinetic seed data — flip the flag manually
  per exercise for now.
- RPE on rep-mode sets. RIR stays the rep-mode signal. (Two scales side-by-side
  is the explicit choice — RIR for reps because it has the literature backing
  for hypertrophy, RPE for time because that's the standard for isometrics.)

### What already exists

| Sub-problem | Existing code |
|---|---|
| Background-safe absolute-time timer | `src/app/workout/rest-timer-utils.ts` (`computeRemaining`, `persistTimer`, etc.) |
| Full-screen sheet pattern | `RestTimerSheet` in `workout/page.tsx:523–648` |
| `appStateChange` re-sync | `useRestTimer` `useEffect` at `workout/page.tsx:266–307` |
| Audio beep | `notify()` at `workout/page.tsx:106–134` (extract to shared util) |
| Haptic via `navigator.vibrate` | same `notify()` |
| RIR chip strip | `RirSlider` component (referenced at `SetRow:1148–1152`) |
| RPE column on `workout_sets` | already in schema; sync push/pull pipeline already round-trips it (`api/sync/push/route.ts:149,153`); `effective_set_count` SQL is RIR-only so the bridge is what makes the column matter |
| Time-mode duration input | `SetRow` lines 1098–1110 |
| Unit & haptic settings | `getRestSettings()` `workout/page.tsx:69–80` |

## Schema delta

```sql
-- src/db/migrations/041_exercise_has_sides_and_rpe_range.sql
ALTER TABLE exercises
  ADD COLUMN has_sides BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN exercises.has_sides IS
  'When true, the exercise is performed unilaterally (each leg / each arm). '
  'In-workout stopwatch enters a 10-second switch countdown after the user '
  'stops the first side, then resumes counting up for the second side. '
  'Default false for legacy data.';

-- Drop legacy 7.0-10.0 check constraint — UI never wrote it, but the
-- constraint blocks the new 1-10 integer convention for time-mode RPE.
-- (Source: src/db/migrations/001_core_schema.sql:86.)
ALTER TABLE workout_sets DROP CONSTRAINT IF EXISTS workout_sets_rpe_check;

-- New constraint: integer 1-10 for time-mode RPE. NULL still allowed for
-- rep-mode (RIR-only) and legacy rows. floor(rpe) = rpe rejects decimals
-- regardless of which client wrote the value.
ALTER TABLE workout_sets ADD CONSTRAINT workout_sets_rpe_check
  CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10 AND rpe = floor(rpe)));

COMMENT ON COLUMN workout_sets.rpe IS
  'Time-mode: integer RPE 1-10 (10 = volitional failure / form broke). The '
  'server derives rir = GREATEST(0, LEAST(5, 10 - rpe::int)) on push for '
  'time-mode sets — see api/sync/push/route.ts. Rep-mode: column unused '
  '(UI collects RIR directly).';
```

**Dexie mirror** — already at v19 (`src/db/local.ts:653+`). Add `has_sides` in
**v20**, non-indexed, with an upgrade hook that defaults `false` for every
existing exercise row. Pattern matches v8's tracking_mode mirror at
`local.ts:679-684`. Add `db.on('versionchange', () => { db.close(); location.reload(); })`
to surface the upgrade gracefully when a new SW activates mid-workout — the
existing v8 comment notes the pattern is already implicit, but we make it
explicit because Lou is likely to be mid-workout when an upgrade lands.

**Sync envelopes:**
- `api/sync/changes/route.ts:394` — add `has_sides: Boolean(r.has_sides)` to
  the exercise envelope.
- `api/sync/push/route.ts:149` exercises UPSERT — add `has_sides` to column
  list and parameter array.
- `api/sync/push/route.ts` workout_sets UPSERT — server derives `rir` from
  `rpe` for time-mode sets (see "RIR → RPE bridge — server-derived" below).
  Client-pushed `rir` is **ignored** for time-mode rows (overwritten).

## UX flow

### Time-mode set row (idle)

```
[1] [—  ] kg  ×  [60] sec  ⏱   [✓ complete]
                              ^ new — opens stopwatch
```

The timer icon button is a 44×44 tap target (per `fix(projections): tap-target
delete on iOS` precedent), `bg-zinc-800/40 hover:bg-zinc-700/60 rounded-full`,
icon size `h-4 w-4`, color `text-muted-foreground`. Active when the stopwatch
is running for THIS set: the icon switches to filled `text-primary` and a tiny
running mm:ss appears under the duration input.

### Stopwatch sheet (full-screen)

Mirrors RestTimerSheet structure but:

- No preset chips. Opens directly into the running state.
- Big readout: count-up `mm:ss` (or `m:ss` if < 60s). Same `text-5xl
  font-light tabular-nums` as the rest timer.
- Single-side exercise: one "Stop" button (red, large, centered). Tapping it
  closes the sheet and writes elapsed seconds into the SetRow's duration input.
- `has_sides === true`:
  - State `counting(side=1)`: top label "Side 1". "Stop" button.
  - User taps Stop → state `switching`. Big "Switch sides" message + 10s
    count-down ring (mirrors RestTimerSheet ring math). "Skip" button to
    short-circuit. Audio + haptic at 0.
  - State `counting(side=2)`: top label "Side 2". "Stop" button.
  - User taps Stop → state `done` → close sheet, write final duration.
- "Cancel" is a small text button top-left. Discards the elapsed time, returns
  to SetRow with the original duration value untouched.
- 10s switch countdown emits the same `notify()` audio+haptic+notification at
  zero as the rest timer.

### What value writes back

For unilateral sets, the final logged `duration_seconds` is **the longer of the
two sides**, NOT the sum. Rationale: each side is its own work bout; logging
the sum would double-count and compare unfavorably against historical bilateral
holds. (Open question — see below — Lou may want sum or per-side instead.)

## Persistence model (background-safe)

Mirrors `rest-timer-utils.ts`. New file `src/app/workout/stopwatch-utils.ts`:

```ts
export const STOPWATCH_START_KEY = 'rebirth-stopwatch-start-time';      // epoch ms
export const STOPWATCH_STATE_KEY = 'rebirth-stopwatch-state';            // JSON: phase, side, side1Elapsed, switchEndTime, setRowKey
```

Storage shape:

```ts
type StopwatchState = {
  setRowKey: string;        // workoutExerciseUuid + setUuid — re-attach to the right SetRow on resume
  hasSides: boolean;
  phase: 'counting' | 'switching' | 'done';
  side: 1 | 2;
  startedAt: number;        // epoch ms when the CURRENT phase began
  side1Elapsed: number | null;  // seconds, only set after side-1 stop
  switchEndTime: number | null; // epoch ms, only set during 'switching'
};
```

On `appStateChange` foreground or page reload: read state, recompute elapsed
from `Date.now() - startedAt` (current phase only — `side1Elapsed` is
displayed separately in the `done` confirmation card), restore UI.

**CRITICAL — restored from expired switch (Phase 3 fix):** if
`phase === 'switching'` and `Date.now() > switchEndTime`, do NOT silently
jump to `counting(side=2)` — that would credit "20 minutes away from app"
as a 20-minute second-side hold. Instead, transition to a new phase
**`switch_expired_paused`** that shows:
- Header: `Side 1 done — ready for side 2?`
- Side-1 elapsed displayed prominently
- Two buttons: `Start second side` (only this user action sets
  `startedAt = Date.now()` and enters `counting(side=2)`) / `Done — log first
  side only` (skips side 2, writes side-1 elapsed only).

Add to the orphan-restore path: on restore, check `db.workout_sets.get(setUuid)`.
If missing, show recovery sheet with `Discard` / `Copy elapsed to current set`
actions (per Phase 2 auto-decision #6).

## RIR → RPE bridge — server-derived (single source of truth)

**Critical correction from Phase 3 review:** the bridge formula MUST run
server-side, not in client `mutations.ts`. Three reasons:

1. `mutations.ts:152 updateSet(uuid, changes)` has no exercise context — to
   know whether a set is time-mode the bridge would need an extra Dexie load,
   which is racy under concurrent tabs.
2. Two PWA tabs computing `rir = 10 - rpe` from different RPE values race;
   the loser's stale `rir` reaches `api/sync/push/route.ts:149` and the muscle
   math silently uses the wrong weight.
3. If the bridge formula ever changes, server-side derivation lets us recompute
   from `rpe` truth rather than trying to backfill `rir` history.

**Implementation:**

- **Client (UI / mutations.ts)**: writes only `rpe` for time-mode sets. The
  `rir` field is left NULL on time-mode rows. New mutation function
  `updateTimeSetRpe(setUuid: string, rpe: number | null)` to make the
  invariant explicit (don't shoehorn into `updateSet`).
- **Server (`api/sync/push/route.ts` workout_sets UPSERT)**: when the joined
  exercise's `tracking_mode = 'time'`:
  ```sql
  -- Pseudocode — actual diff applied to push/route.ts:144-153
  rir = CASE
    WHEN tracking_mode = 'time' AND rpe IS NOT NULL
      THEN GREATEST(0, LEAST(5, 10 - rpe::int))
    ELSE EXCLUDED.rir
  END
  ```
  For time-mode, the client's `rir` payload is ignored. For rep-mode, the
  client's `rir` is the source of truth (unchanged behavior).
- **`getWeekSetsPerMuscle` SQL (`queries.ts:1367-1372`)**: unchanged. Reads
  the server-derived `rir` column.

**Validation at the mutation boundary:** `updateTimeSetRpe` Zod-validates
`rpe` as `int().min(1).max(10).nullable()`. Reject decimals at the client
boundary too — server check constraint catches them as defense-in-depth.

**Legacy time-mode rows (existing `rir` populated, `rpe` null).** The Phase 2
auto-decision said "hide RIR slider on time-mode rows." That removes the only
edit affordance for legacy data. **Auto-decision (Phase 3 P1 completeness):**
when `tracking_mode='time' AND rpe IS NULL AND rir IS NOT NULL`, render the
RPE chip strip pre-filled at `rpe = 10 - rir` (display only — the bridged
display lets Lou see/edit the value via the new RPE chip strip without the
data ever silently vanishing). The pre-fill is NOT written until Lou taps a
chip. Once written, the row has both `rpe` and the (server-derived) `rir`
and behaves identically to a fresh time-mode row.

**Auto-fill on first completion:** existing `handleComplete` at
`workout/page.tsx:1034` writes `rir = rirDefault` on first set completion.
For time-mode rows this would write a fake bridged value before Lou picks an
RPE. **Fix:** branch `handleComplete` on `trackingMode === 'time'` and skip
the auto-fill. RPE stays NULL until Lou taps a chip.

## Two-tab arbitration (PWA)

PWA users can have the workout open in two tabs. Both tabs see the same
localStorage. Without arbitration: both restore the stopwatch, both render
the running indicator, both attempt to write the final duration.

**Auto-decision (Phase 3 P1 + P5):**

`StopwatchState` adds `ownerTabId: string` (random per tab on mount) and
`updatedAt: number` (epoch ms). On Stop:
1. The active tab compares its `ownerTabId` against the persisted state.
2. Mismatch → tab is read-only, render the recovery sheet pattern.
3. Match → write Dexie row, clear localStorage.

Use `BroadcastChannel('rebirth-stopwatch')` to notify other tabs that the
stopwatch finished — they clear their stale UI without writing. Fallback to
the `storage` event for browsers without BroadcastChannel (single-user
context: Lou's iOS Safari does support it).

## Architecture diagram

```
                         SHARED PRIMITIVES (extracted)
                        ──────────────────────────────────
                        usePersistedClock(namespace)   ◀── extract from useRestTimer
                        useAppForegroundSync(callback) ◀── extract from useRestTimer
                        playBeep(pattern, notification)◀── extract notify() WITHOUT the guard
                            └── single module-level AudioContext (lazy-init)
                            └── lastBeepAt timestamp (200ms space)
                        ──────────────────────────────────
                                    ▲           ▲
                                    │           │
                        ┌───────────┘           └────────────┐
                        │                                    │
                  useRestTimer()                       useStopwatch()
                  (countdown state machine)            (count-up state machine)
                  notifiedRef (hook-local)             switchFiredRef (hook-local)
                                                       endFiredRef   (hook-local)

SetRow (time-mode)
  ├── duration input (existing)
  ├── timer icon button (NEW)            ─── opens ──▶  StopwatchSheet
  │                                                     ├── useStopwatch()
  │                                                     │     └── persisted via usePersistedClock('rebirth-stopwatch')
  │                                                     ├── side-cycling state machine (idle | counting | switching | switch_expired_paused | counting2 | done)
  │                                                     ├── two-tab arbitration (ownerTabId + BroadcastChannel)
  │                                                     └── playBeep() at switch-zero
  └── RPE chip strip (NEW, replaces RIR — own row, post-completion)

CLIENT WRITE PATH (time-mode set)
  updateTimeSetRpe(setUuid, rpe)
    └── Zod: rpe int().min(1).max(10).nullable()
    └── Dexie write: { rpe } only (rir stays NULL on time-mode rows)
    └── syncEngine.schedulePush()

SYNC PUSH (server-side bridge — single source of truth)
  api/sync/push/route.ts workout_sets UPSERT
    └── JOIN exercises ON tracking_mode
    └── if time-mode AND rpe IS NOT NULL:
          rir = GREATEST(0, LEAST(5, 10 - rpe::int))
        else:
          rir = EXCLUDED.rir  (unchanged for rep-mode)

READ PATH (unchanged)
  queries.ts effective_set_count SQL ─── reads workout_sets.rir
    └── time-mode sets credit correctly via the server-derived value
```

## Edge cases to handle

1. **App killed mid-stopwatch.** Restore from localStorage on next mount.
   `Date.now() - startedAt` gives true elapsed regardless of suspension.
2. **App killed mid-switch (10s countdown).** On restore, if `Date.now() >
   switchEndTime`, jump silently to `counting(side=2)` and set
   `startedAt = switchEndTime`. Don't fire the switch beep retroactively.
3. **User opens stopwatch on an already-completed set.** Treat as a re-time:
   stopwatch result overwrites the existing duration on stop. RPE preserved.
4. **User opens stopwatch while rest timer is running.** Both run. The
   workout summary bar shows rest timer; the stopwatch sheet covers it
   while open. Closing the sheet returns to the rest timer view if it's
   still active. Separate localStorage namespaces — no collision.
5. **`has_sides === false` exercise but Lou wants to manually run a 2-side
   stopwatch this once.** Out of scope. The flag is per-exercise.
6. **Rapid double-tap on Stop.** Debounce via the same `saving` pattern used
   by `handleComplete` (lines 1020–1038).
7. **Switch countdown beep firing while another notification is queued.**
   Reuse `notify()` — same single-fire guard pattern as `notifiedRef`.
8. **RPE chip default value on first completion.** No previous-session RPE
   exists. Default to RPE 8 (analog to RIR-2 default). Document the
   convention in the chip strip component.
9. **Sync conflict: server has `has_sides=true`, client v19 doesn't know the
   column.** Dexie v20 upgrade backfills false; sync pull writes server value.
   Order matters — Dexie upgrade must run before the first sync pull. Read
   sites coerce `has_sides ?? false` defensively (matching the v8 tracking_mode
   pattern at `local.ts:679-684`).
10. **`setRowKey` orphaned by swipe-to-delete during stopwatch.** SetRow uses
    `SwipeToDelete` (`workout/page.tsx:1178`); the user can delete the set the
    stopwatch is timing. On restore, `db.workout_sets.get(setUuid)` returns
    undefined → recovery sheet (Discard / Copy elapsed to current set).
11. **Two PWA tabs both open the stopwatch sheet for the same set.** Only the
    `ownerTabId` match writes on Stop; the other tab renders read-only with
    a message via BroadcastChannel.

## Failure-modes registry

| Mode | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Stopwatch starts, app suspended for hours, returns wildly inflated | High (iOS background tab eviction) | Logged duration of 4h instead of 60s | Cap displayed elapsed at e.g. 3600s; warn UI when > 600s and the exercise's typical hold is unknown |
| `has_sides` toggle unset on a known unilateral exercise | Medium (manual data) | Stopwatch never enters switch mode for unilateral work | "This looks unilateral — has_sides off?" lint on the routine-edit page (defer to TODOS.md if too much for this PR) |
| RPE→RIR bridge inverted (off-by-one) | Low | All time-mode sets credit wrong | Pure-fn unit test asserts `rpe=10 → rir=0`, `rpe=8 → rir=2`, `rpe=5 → rir=5`, `rpe=4 → rir=5 (clamped)` |
| RPE column collides with legacy float values | Very low (UI never wrote it; export may have read NULL) | None observed | Migration comment documents the convention switch; tests assert integer round-trip |
| User completes set without opening stopwatch, manually types duration | Expected | Works as before | Timer icon is opt-in; manual entry path unchanged |
| Sync pulls a time-mode set with RPE from a future client into an old one | N/A (single-user) | — | Single-user app per CLAUDE.md — version skew is not a concern |

## Open questions (decide at the gate)

1. **Final duration value for unilateral sets**: longer-of-two (recommended),
   sum, average, or per-side (would need a schema change to store both)?
2. **`has_sides` toggle UI location**: exercise edit page only, or also the
   routine-edit page (per-routine override)? Recommend exercise edit only.
3. **RPE chip strip default before first use**: 8 (analog to RIR 2 charitable
   default), or null until user picks?

## Test plan (artifact written to ~/.gstack/projects/lewcart-Iron/)

Pure-function tests:
- `stopwatch-utils.test.ts`:
  - Restore from `phase=counting` after 30s suspension → elapsed = `now - startedAt`.
  - Restore from `phase=switching` past `switchEndTime` → state goes to
    `switch_expired_paused`, NOT `counting(side=2)`. Side-2 elapsed is 0
    until user action.
  - Restore with mismatched `ownerTabId` → returns `read_only_recovery` flag.
- `rpe-bridge.test.ts` (server SQL helper):
  - Table for RPE 1–10 → expected RIR 5,5,5,5,5,4,3,2,1,0 (clamped at 5).
  - RPE NULL → RIR null (no bridge).
  - RPE 7.5 (non-integer) → constraint violation (rejected by check).

Hook tests (`useStopwatch.test.tsx` via `@testing-library/react`):
- State machine: idle → counting(1) → switching → switch_expired_paused →
  counting(2) → done.
- "Skip" during switch immediately enters side-2 counting (without going through
  `switch_expired_paused`).
- "Done — log first side only" from `switch_expired_paused` writes side-1 only.
- Cancel returns to idle without writing duration.
- Timer poll runs at 1000ms (not 500ms — count-up only displays whole seconds).
- Two-tab arbitration: simulate two `useStopwatch` instances in two windows;
  only the `ownerTabId` match commits on Stop.

Integration tests (Dexie + mocked sync, then real Postgres):
- `mutations.ts:updateTimeSetRpe(uuid, 8)` writes `(rpe=8, rir=NULL)` to Dexie.
- Sync push UPSERT on a time-mode set with `(rpe=8, rir=4 stale)` from client →
  server stores `(rpe=8, rir=2)` (server-derived, ignores client rir).
- Sync push UPSERT on a rep-mode set with `(rpe=NULL, rir=2)` → server stores
  `(rpe=NULL, rir=2)` (rep-mode unchanged).
- `mutations.updateSet(uuid, { comment: 'foo' })` on a time-mode set with
  `(rpe=8, rir=2)` → both columns unchanged (no spurious bridge fire).
- Pull → push round-trip: server returns `(rpe=8, rir=2)`; client writes to
  Dexie; client pushes back; server-side bridge produces same `rir=2` (idempotent).

SQL tests (`queries.test.ts` extension):
- `getWeekSetsPerMuscle` with one rep-mode set (`rir=2`) and one time-mode set
  (`rpe=8, rir=2 server-derived`) — both credit `effective_set_count = 1.0`.
- JUNK badge: time-mode set with RPE 4 (server bridges to `rir=5`) credits 0.0;
  if > 40% of week's volume for that muscle, badge fires (per existing 0.6
  threshold in `MusclesThisWeek.tsx`).
- Mixed-mode week: 5 rep-mode sets (RIR 2) + 5 time-mode sets (RPE 8, bridged
  RIR 2) → all 10 credit 1.0.

Migration tests (`migration-041.test.ts`):
- Migration drops `workout_sets_rpe_check`, adds new constraint.
- Pre-existing time-mode rows with `(rpe=NULL, rir=N)` survive intact.
- Pre-existing rep-mode rows survive intact.
- New constraint rejects `rpe=7.5`, `rpe=0`, `rpe=11`, accepts `rpe=1` through `rpe=10`.
- `has_sides` column added to all exercise rows with default false.

Dexie v20 upgrade test:
- v19 → v20 with three open sessions: upgrade fires, `has_sides` defaults false
  on all existing rows, no data loss.
- `versionchange` handler closes DB and reloads when invoked.

UI smoke (Capacitor iOS simulator + a real iPhone if Lou has one nearby):
- Open stopwatch on a time-mode set, background app for 30s, foreground —
  elapsed reflects real time.
- Force-quit during `switching` phase → reopen → see `switch_expired_paused`
  with explicit "Start second side" button.
- Stop → 10s switch beep audible + haptic. Both timers (rest + stopwatch) at
  zero in same second → only one beep heard (200ms space + lock).
- Final write: Dexie row updated, sync push reaches server, server rir matches
  client rpe via the bridge.
- Open stopwatch on a legacy time-mode set (rpe=NULL, rir=2) → RPE chip strip
  pre-fills at 8 (display only) → tap chip 9 → row commits (rpe=9, rir=1 server).

## Phase 2 — Design Review (dual voices)

### Consensus table

```
DESIGN DUAL VOICES — CONSENSUS TABLE
═══════════════════════════════════════════════════════════════════════
  Dimension                              Claude  Codex   Consensus
  ──────────────────────────────────────  ───────  ───────  ──────────
  1. Information hierarchy specified?    weak     weak     CONFIRMED gap
  2. All interaction states defined?     no       no       CONFIRMED gap
  3. RPE 10-chip strip viable on 375px?  NO       NO       CONFIRMED critical
  4. Accessibility specified?            missing  missing  CONFIRMED gap
  5. UI specifics vs generic patterns?   too-gen  too-gen  CONFIRMED gap
  6. Edge cases (orphan restore, etc.)?  partial  partial  CONFIRMED — different gaps
  7. Audio/notification handling?        weak     weak     CONFIRMED gap
═══════════════════════════════════════════════════════════════════════
Both voices reached the same verdict on every dimension. No DISAGREEs;
no taste decisions surface from this phase. Auto-decisions applied
below using P1 (completeness) + P5 (explicit) per autoplan principles.
```

### Auto-decisions (mechanical — applied to the plan)

| # | Issue | Decision | Principle |
|---|---|---|---|
| 1 | RPE 10-chip strip won't fit on 375px row | Move RPE to its OWN row below the inputs (appears only after `is_completed`). 10 chips at `w-7 h-7` (28px) with `gap-1` → ~290px, fits. Anchor labels in tiny text under chips 6/7/8/9/10: `easy / mod / hard / near / fail`. | P1, P5 |
| 2 | Side labels generic ("Side 1/2") | Use "First side" / "Second side" — never guess L/R. Pill above readout: `text-xs uppercase tracking-widest text-muted-foreground` for inactive, `text-primary` when current. During `switching`, both pills visible with side-1 dimmed and "next" caret to side-2. | P5 |
| 3 | Cancel vs preserve confused | Top-left `Close` (preserves elapsed, sheet stays running in background, returns to SetRow with running indicator). Below the Stop, an explicit `Discard` text link `text-red-500/80 text-sm` with one-tap inline confirm ("Discard 0:42?"). Two intents, two buttons. | P5 |
| 4 | Stop button under-specced | `w-32 h-32 rounded-full bg-red-500 active:bg-red-600 active:scale-95 transition`, `text-white font-semibold text-lg`. On press: 30ms haptic, freeze readout, hold 200ms so the user sees final value, then close (or transition to switching for unilateral). | P5 |
| 5 | Open-on-completed-set silent overwrite | Subdued line under readout: `Replacing 1:00` + small undo arrow. On stop: 3s toast `Replaced 1:00 → 0:42. Undo.` | P1 |
| 6 | Restore-from-suspension UX missing | NEVER auto-open the sheet. Render a sticky bar at top of exercise card: `Stopwatch running — First side — 1:24 ▸` (tap to reopen). Orphan case (set deleted): show a recovery sheet on first paint with elapsed time and actions `Discard` / `Copy to current set`. | P1, P5 |
| 7 | Save/error states undefined | New states: `stopping`, `saving`, `saved`, `save_failed`. Disable Stop after first tap. On Dexie/sync failure, keep the sheet open with inline retry — never silently lose the measured value. | P1 |
| 8 | Stale-timer cap mitigation under-specced | At elapsed > 600s: yellow banner `Timer ran for {n}m — was the app suspended?`. At elapsed > 3600s: stale-timer screen with elapsed shown, copy, and three buttons `Use duration` / `Edit duration` / `Discard`. NEVER auto-write a capped value. | P1, P5 |
| 9 | Audio collision (rest timer + stopwatch beep simultaneously) | Promote `notify()` to a shared queue/lock in the extracted util. If a beep is already playing, defer the next by 200ms. Document the convention in the extracted util. | P4, P5 |
| 10 | Reduced motion not handled | `motion-reduce:transition-none` on the switch ring. When `prefers-reduced-motion: reduce`, replace ring shrink with a numeric `10 → 0` countdown. Same `motion-reduce:animate-none` on any pulse. | P1 |
| 11 | "Skip switch" affordance ambiguous | Render as `text-sm text-muted-foreground underline` below the ring. NOT a button — reserves button visual weight for Stop. 44×44 tap area via padding. | P5 |
| 12 | iOS sticky-hover bug | Replace `hover:` with `active:` everywhere in new sheet. Audit `RestTimerSheet` while we're there (touch up). | P5 |
| 13 | Tap-target reference (h-7) misquoted | Drop the projections-page citation. State the rule directly: every action button in the new sheet has a 44×44 CSS interactive box, regardless of icon size. | P5 |
| 14 | Active-running SetRow state vague | Replace duration value field with live `mm:ss` while running, a small pulsing dot to the left, fixed row height (no second line). On stop: snap back to numeric input prefilled with elapsed. | P5 |
| 15 | RPE anchor meanings thin | Anchor copy under chips: `6 easy`, `7 moderate`, `8 hard`, `9 near limit`, `10 failed/form broke`. Hidden under chips 1–5 (anchors only at 6+, where decisions matter for the bridge). | P5 |
| 16 | Permission UX (audio/haptic/notif denied) | Silent fallback. NEVER prompt inside the stopwatch. If audio denied, the visual "Switch sides" ring + numeric countdown + 30ms haptic carry the moment. | P3 |
| 17 | A11y spec absent | Readout: `aria-live="polite" aria-atomic="true"`, updates every 5s (not every 1s — too chatty). Stop: `aria-label="Stop {first/second} side stopwatch"`. Switch ring: `role="timer" aria-label="Switch sides in {n} seconds"`. Side label: `role="status"`. RPE chips: roving tabindex; Space/Enter activates; Escape closes sheet. | P1 |
| 18 | Auto-start vs explicit Start | Auto-start. The user just tapped a "start the timer" affordance — requiring a second tap is friction. Cancel/Close is prominent. | P3 |
| 19 | "Longer of two" UX (was open question) | LOCK: longer-of-two. Show 1.5s confirmation card before sheet close: `First side: 0:42 / Second side: 0:38 / Logged: 0:42 (longer)`. Open question 1 collapses to "decided". | P5, P6 |

### Updated UX flow (incorporating auto-decisions)

**Time-mode set row layout (idle):**
```
[1] [—  ] kg  ×  [60] sec  ⏱       [✓ complete]
                              ^ 44×44, bg-zinc-800/40 ring-1 ring-zinc-700
```
Once `is_completed`, RPE chip strip appears on its own row below the inputs:
```
[1] [—  ] kg  ×  [60] sec  ⏱       [✓ complete]
    [1][2][3][4][5][6][7][8][9][10]
              easy  mod hard near fail
```

**Stopwatch sheet states (full matrix):**

| Phase | Header | Readout | Primary action | Secondary | Audio/haptic on entry |
|---|---|---|---|---|---|
| `counting` (single side or first side) | `First side` pill (or no pill if `!has_sides`) | `mm:ss` text-5xl, count-up | `Stop` (red 128px) | `Close` top-left, `Discard` link below stop | none |
| `switching` | `First side ✓ → Second side` | 10s ring + numeric `10..0` | `Skip` underlined link | `Discard` link | end-of-countdown beep + 30ms haptic + system notification |
| `counting` (second side) | `Second side` pill | `mm:ss` count-up | `Stop` (red 128px) | `Close`, `Discard` | none |
| `done` (1.5s) | `Logged: 0:42 (longer)` | `First 0:42 / Second 0:38` | none — auto-close | none | 30ms haptic |
| `restored-suspended` | `Resumed — was running` | `mm:ss` from real elapsed | `Stop` | `Close`, `Discard` | none |
| `stale (>3600s)` | `Timer ran ages ago` | last sane value | `Use duration` | `Edit`, `Discard` | none |
| `saving` | (current header) | (current readout, frozen) | spinner | none | none |
| `save_failed` | `Couldn't save — retry?` | (frozen) | `Retry` | `Copy duration & close` | error haptic (50ms) |

**Active-running indicator on SetRow when sheet is closed:** sticky bar at top of exercise card `Stopwatch running — First side — 1:24 ▸`.

**Open question 1 (longer-of-two)** — collapsed to "longer-of-two, with confirmation card."
**Open question 2 (`has_sides` toggle location)** — exercise edit page only. Auto-decided P3 pragmatic.
**Open question 3 (RPE default)** — null until user picks. Auto-decided P3: a default value would silently miscredit junk-set math via the RIR bridge.

## Phase 3 — Eng Review (dual voices)

### Consensus table

```
ENG DUAL VOICES — CONSENSUS TABLE
═══════════════════════════════════════════════════════════════════════
  Dimension                                Claude   Codex    Consensus
  ──────────────────────────────────────── ──────── ──────── ──────────
  1. Architecture sound?                   yes-w/   yes-w/   CONFIRMED — extract more primitives
  2. Test coverage sufficient?             NO       NO       CONFIRMED — 7 missing tests
  3. Performance OK?                       partial  partial  CONFIRMED — AudioContext lifecycle + 1000ms poll
  4. Security/data integrity?              gap      CRIT     CONFIRMED — schema constraint critical
  5. Edge cases & races handled?           NO       NO       CONFIRMED — multiple critical
  6. Deployment risk manageable?           ok-w/    CRIT     CONFIRMED — RPE constraint must drop
═══════════════════════════════════════════════════════════════════════
6/6 CONFIRMED gaps. No DISAGREEs. Both voices independently flagged the
same critical bridge-correctness issue (server-side derivation required).
Codex caught two issues subagent missed: existing RPE check constraint
(rpe ≥ 7.0) blocks the new 1-10 range, and Dexie is at v19 not v6/v7.
```

### Auto-decisions (mechanical — applied to plan body above)

| # | Severity | Issue | Fix applied |
|---|---|---|---|
| E1 | **CRITICAL** | Existing `workout_sets_rpe_check` rejects RPE 1-6 (`migrations/001:86`) | Migration 041 drops old constraint, adds `CHECK (rpe IS NULL OR (rpe BETWEEN 1 AND 10 AND rpe = floor(rpe)))`. Patched in §Schema delta. |
| E2 | **CRITICAL** | Restore from expired switch silently entered `counting(side=2)` and credited time-away as side-2 hold | New phase `switch_expired_paused`. Only user action sets `startedAt`. Patched in §Persistence model. |
| E3 | **CRITICAL** | Client-derived RIR bridge races across PWA tabs; sync push trusts both columns | Server-derived bridge in `pushWorkoutSet`. Client writes only `rpe` for time-mode; client rir payload ignored for time-mode rows. Patched in §RIR → RPE bridge. |
| E4 | **CRITICAL** | `handleComplete` auto-fills `rir = rirDefault` on first completion — would fake-credit time-mode sets via the bridge | Branch `handleComplete:1034` on `trackingMode === 'time'` and skip auto-fill. Patched in §RIR → RPE bridge. |
| E5 | high | Dexie is at v19, not v6/v7 | Updated to v20 in §Schema delta. Added explicit `versionchange` handler. |
| E6 | high | `updateSet(uuid, changes)` lacks exercise context for the bridge | New mutation `updateTimeSetRpe(setUuid, rpe)`. Server bridge means the client doesn't need exercise context. Patched in §RIR → RPE bridge. |
| E7 | high | Two PWA tabs both write the same set | `ownerTabId` + `BroadcastChannel('rebirth-stopwatch')` arbitration. New §Two-tab arbitration. |
| E8 | high | Test plan missing integration + migration tests | §Test plan rewritten with 7 new test files covering bridge integration, migration constraint, sync round-trip, mixed-mode JUNK math, Dexie v20 upgrade. |
| E9 | medium | `notify()` extraction conflated audio with single-fire guards | §Architecture diagram clarifies: `playBeep()` is shared; `notifiedRef` / `switchFiredRef` / `endFiredRef` are hook-local. |
| E10 | medium | `AudioContext` constructed per-beep, never closed; iOS leak risk | Single module-level `AudioContext` (lazy-init on first user gesture for iOS autoplay), `lastBeepAt` for 200ms space. Patched in §Architecture diagram. |
| E11 | medium | Legacy time-mode rows with rir but no rpe lose edit affordance | Pre-fill RPE chip strip from `10 - rir` (display only — not written until user picks). Patched in §RIR → RPE bridge. |
| E12 | medium | Stopwatch poll at 500ms wastes wakeups (display only shows whole seconds) | Stopwatch poll at 1000ms. Documented in §Test plan hook tests. |
| E13 | medium | `setRowKey` orphan on swipe-to-delete during stopwatch | Orphan recovery sheet on restore when `db.workout_sets.get(setUuid)` returns undefined. Patched in §Edge cases #10. |
| E14 | low | Migration is additive, safe (confirmed) | No change. |
| E15 | low | localStorage write blocking is sub-millisecond (~200B JSON, bounded transitions) | No change — drop the worry. |

### Cross-phase themes (concerns flagged in 2+ phases independently)

- **RPE chip layout / scale fit**: Phase 2 design (responsive strategy on
  375px) + Phase 3 eng (RPE constraint range). Both phases independently
  forced a refit of the RPE column.
- **Restore-from-suspension UX**: Phase 2 (visual treatment unspecified) +
  Phase 3 (state-machine semantics dangerous). Both phases pushed for an
  explicit `switch_expired_paused` state.
- **Audio collision**: Phase 2 (UX of two beeps overlapping) + Phase 3
  (AudioContext lifecycle). Combined fix lives in shared `playBeep` util.

High-confidence signal — these three concerns appeared across both
review phases without coordination. Treat as load-bearing.

## Decision principles applied

| Principle | Application |
|---|---|
| P1 Completeness | Side-cycling, RPE chip strip, and bridge are all in scope rather than punted |
| P2 Boil lakes | Files in blast radius: `workout/page.tsx`, `mutations.ts`, `local.ts`, `types.ts`, two new files. < 1 day CC. |
| P3 Pragmatic | Reuse `rpe` column rather than add a new `rpe_int` column |
| P4 DRY | Extract `notify()` to a shared util; `useStopwatch` doesn't reimplement absolute-time math (calls into `stopwatch-utils.ts`) |
| P5 Explicit | Side-cycling state machine is named states, not boolean flags; the RPE→RIR bridge is a single named function in `mutations.ts` with a comment |
| P6 Bias to action | Open questions go to the gate, not a research detour |
