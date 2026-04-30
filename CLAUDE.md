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
