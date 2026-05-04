# iOS Swift unit tests

These test files cover the Swift-only logic for the morning-walk-automation
feature (HKWorkoutBuilder save sequencing, JSONL route storage, WalkPhase state
transitions, time-window gate).

**Status:** Source is committed but there is no iOS test target wired into
`App.xcodeproj` yet. To run these, add a Unit Testing Bundle target in Xcode,
include the `Tests/` directory, and link `App` for testability (the app target
already has `ENABLE_TESTABILITY = YES`).

JS-side coverage of the same behaviour (depart-window logic mirror, persistence
round-trip, WalkPhase enum surface) lives in `src/lib/geofence.test.ts` and runs
under Vitest as part of `npm run test`.
