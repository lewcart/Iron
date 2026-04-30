# Changelog

All notable changes to Rebirth are documented here.

## [0.1.1] - 2026-04-30

### Fixed
- iOS Safari / WKWebView no longer auto-zooms when tapping text inputs, and the user can no longer get permanently stuck in a zoomed-in state. All inputs are forced to 16px on mobile and the viewport is pinned at scale 1.
- "Unknown Exercise" no longer flashes on workout and history views during cold start. Fixed at three layers: the bundled exercise catalog UUIDs are now lowercased on hydrate (matching how sync pull stores them), the rendering fallback shows empty space instead of "Unknown Exercise" during the brief Dexie-read window, and the sync engine consistently lowercases exercise UUIDs on every fetch.
- Pages no longer show a forced 500ms loading skeleton when local data is already available. The full-screen "Loading exercises…" overlay that blocked every cold start has been removed entirely.

### Added
- Foundation for local-first-everywhere: every domain table the app reads now has a Dexie schema entry (12 new local tables for plans, routines, nutrition, measurements, InBody, body composition, wellbeing, HRT, photos). Page migrations to use these tables ship in a follow-up.
- Postgres change-data-capture (CDC) layer (migration 019). Every domain table now has an `updated_at` column with auto-bump trigger and a `change_log` trigger that appends to a global monotonic seq stream. Replaces per-table timestamp cursors.
- New `/api/sync/changes` endpoint backed by the CDC stream. Single seq cursor, paginated, atomic per-page apply on the client. Replaces `/api/sync/pull`.
- Foreground sync hook in `providers.tsx` consolidates `visibilitychange` + Capacitor `App.appStateChange` into a single trigger alongside HealthKit's resume sync. MCP-driven server changes appear in the app within ~15 seconds (or instantly on foreground).

### Changed
- Sync engine (`syncEngine.start()`) is now idempotent — repeated calls under React StrictMode or route remounts no longer create duplicate intervals or listeners.
- Polling reduced from 60s to 15s while the document is visible, suspended when hidden. MCP changes propagate ~4× faster while consuming less cellular data when the app is backgrounded.
- `/api/sync/push` now handles all 23 synced tables. Push payload structure is unified across domains.

### Removed
- `/api/sync/pull` endpoint and its test (replaced by `/api/sync/changes`).
- Full-screen "Loading exercises…" overlay (`SyncStatus` is now a passive bottom indicator only).
- Debug console.warn block in `useLocalDB.ts` that was added as a band-aid for the Unknown Exercise bug — root cause is now fixed.

### Notes for next deploy
- Run `npm run db:migrate` to apply migration 019 before the new sync endpoints will work. The migration is additive (no data loss) and includes a backfill of `change_log` from existing rows so the first post-migration pull is consistent.
- Existing Dexie installs upgrade from v3 to v4 automatically and additively (12 new tables added, no existing tables modified or dropped).
