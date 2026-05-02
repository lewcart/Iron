# Rebirth — agent guide

This is a single-user (Lewis only) Next.js App Router PWA with a Drizzle +
Postgres backend, Dexie + sync-engine local-first layer, and an MCP server
that exposes the same surface to AI agents.

## Nutrition workflow (for MCP agents)

Date conventions:
- All `date` params: `YYYY-MM-DD` in user's local timezone
- All `*_at` params: ISO-8601 with timezone offset
- Compute relative dates ("yesterday") yourself; tools never accept literal `"yesterday"`

Day approval:
- DB stores only `pending` | `approved`. "Logged" is a UI-only derivation for past days that are still pending — you do not need to set it.
- `approve_nutrition_day(date)` flips a date to `approved`. Future dates rejected.
- Already-approved days return idempotent silent success.

Common workflows:
- **"Log my breakfast"** → `search_nutrition_foods(query)` → `log_nutrition_meal({ meal_type: 'breakfast', meal_name, calories, ... })`
- **"Edit yesterday's lunch"** → `list_nutrition_logs(date)` → `update_nutrition_log(uuid, ...)`
- **"Log a whole day at once"** → `bulk_log_nutrition_meals(date, [meals])` (per-item results, partial failures don't abort)
- **"How adherent was last week?"** → `get_nutrition_summary(start_date, end_date)` → returns adherence_pct, streak, approval counts
- **First time touching nutrition?** → `get_nutrition_rules()` returns the full rule set

Updates:
- `update_nutrition_log` uses named params (not a `fields` blob). Server-side whitelist on which columns are editable.
- Errors include a `hint` field naming the next tool to call when applicable.

## Sleep workflow (for MCP agents)

Same date conventions as nutrition (`YYYY-MM-DD` in user's local timezone, which for this single-user app is Europe/London; ISO-8601 with offset for `*_at`).

Tool selection:
- `get_health_snapshot` → current state, last night detail, point-in-time HRV/RHR
- `get_health_sleep_summary` → date-window aggregate: averages, consistency score, HRV trend
- `get_health_series` → single-metric trend chart (e.g., HRV alone)

Common workflows:
- **"How was last night?"** → `get_health_snapshot({ fields: ['sleep_last_night','hrv'] })`
- **"How was last week's sleep?"** → `get_health_sleep_summary({ window_days: 7 })`
- **"Compare this week to last"** → two `get_health_sleep_summary` calls with `start_date` shifted
- **"HRV trend only"** → `get_health_series({ metric: 'hrv', from })`

Notes:
- Naps (in_bed < 4h OR wake < 04:00 London) are filtered out of summary aggregates and the consistency score.
- Consistency score requires ≥5 main nights with bedtime/waketime envelopes; otherwise `consistency: null`.
- Errors:
  - `{status:'not_connected', reason, message}` — same shape as snapshot's not_connected branch.
  - `{status:'invalid_range'|'invalid_input', message, hint}` — for date / window_days / fields validation.

## Strength workflow (for MCP agents)

Canonical muscle taxonomy: 18 slugs. Always use canonical slugs (`chest`, `lats`, `glutes`, etc.) — legacy values like `pectoralis major` are accepted by `find_exercises(muscle_group)` via synonyms, but `create_exercise` rejects non-canonical input with `UNKNOWN_MUSCLE`.

- **First time touching the strength surface?** → `list_muscles()` returns the full taxonomy with optimal ranges, parent_groups, and legacy synonyms.
- **"Did I hit my volume targets this week?"** → `get_sets_per_muscle({ week_offset: 0 })` returns per-muscle set counts vs Schoenfeld 10–20 range. `summary.optimal_count`/`under_count`/`over_count` is the headline; `muscles[]` is the detail.
- **"Total volume this week + per-muscle breakdown"** → `get_weekly_summary({ week_offset: 0 })` returns `total_volume`, `by_muscle[]` (canonical slugs + set_count + kg_volume), and `compliance_pct` vs active plan.
- **"Find a glute exercise"** → `find_exercises({ query: 'romanian deadlift', muscle_group: 'glutes' })` — `muscle_group` accepts canonical slugs OR legacy synonyms.

Set quality:
- A working set = `is_completed=true AND (reps>=1 OR duration_seconds>0)`. Drop sets count as 1 each. Each set credits BOTH primary AND secondary muscles (full credit, not fractional).
- **RIR (Reps in Reserve, 0–5)** is collected per-set in the workout UI as a chip strip below each completed set row (0=failure, 5=5+ left). Stored on `workout_sets.rir`. NULL = not recorded.
- **`effective_set_count`** (Phase 3) is the RIR-weighted variant on every `get_sets_per_muscle` row and `get_weekly_summary.by_muscle` row: RIR 0–3 counts 1.0, RIR 4 counts 0.5, RIR 5+ counts 0.0, RIR NULL counts 1.0 (charitable default until corpus exists). Until RIR is logged on most sets, `effective_set_count ≈ set_count`. The /feed Muscles This Week tile flags a muscle with a "JUNK" badge when `effective / set_count < 0.6` AND `set_count > 0` — meaning most logged sets were too far from failure to drive hypertrophy.

`coverage` flag on `get_sets_per_muscle` rows: `'none'` means no exercise in the catalog tags this muscle (yet — the audit pass will populate). Until then those muscles can't accumulate sets. UI collapses them into a footer.

## Projection workflow (for MCP agents)

A "projection" is an AI-generated image of Lou (made outside this app, e.g. ChatGPT / Midjourney) showing an aspirational future-self physique. Lou uploads them here so the photos-compare viewer can line them up against real progress photos at the same pose. Schema mirrors `progress_photos` with optional `source_progress_photo_uuid` (link to source) and `target_horizon` (label).

Tool selection:
- `upload_projection_photo` → store image + metadata (pose required).
- `list_projection_photos` → list newest first; filter by pose.
- `delete_projection_photo` → delete row + Vercel Blob.

Common workflows:
- **"Upload a projection of me 6mo leaner, front pose"** → `upload_projection_photo({ pose: 'front', image_base64 (or image_url), target_horizon: '6mo', source_progress_photo_uuid? })`
- **"Show my projections"** → `list_projection_photos({ pose?: 'front', limit: 20 })`
- **"Compare today's progress to my projection"** → `list_progress_photos({ limit: 1 })` + `list_projection_photos({ pose, limit: 1 })` and surface both `blob_url`s.

Notes:
- Pose required (`'front'|'side'|'back'`). Mirrors `progress_photos.pose` so the compare viewer can line them up.
- Optional `source_progress_photo_uuid` links the projection to the photo it was generated from — the compare viewer prefers that pairing if set.
- `target_horizon` is a label (`'3mo'|'6mo'|'12mo'` or freeform), not a date.
- Generation happens outside this app. Lou uploads pre-generated images; there is no in-app image generation.
