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

Same date conventions as nutrition (`YYYY-MM-DD` Europe/London for date params; ISO-8601 with offset for `*_at`).

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
- Errors mirror the snapshot shape: `{status:'not_connected'|'invalid_range'|'invalid_input', message, hint}`.
