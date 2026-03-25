# SKILL.md — Rebirth API Reference

This file teaches Claude (Stud on Mac Studio, Loft via web_fetch) how to query, create, update, and delete data across all six Rebirth modules via the Iron REST API.

## Auth

Every request requires an API key (unless `REBIRTH_API_KEY` is unset — dev mode).

```bash
# Via Authorization header (preferred)
-H "Authorization: Bearer $REBIRTH_API_KEY"

# Via X-Api-Key header
-H "X-Api-Key: $REBIRTH_API_KEY"
```

Set the key:
```bash
export REBIRTH_API_KEY="your-key-here"
export REBIRTH_BASE="http://localhost:3000"  # or Tailscale address in prod
```

---

## Module 1 — Training

Routes are **not** API-key protected (existing behaviour). They're listed here for completeness.

### Workouts

```bash
# List recent workouts (optional filters: limit, from, to, exerciseUuid)
curl "$REBIRTH_BASE/api/workouts?limit=10"

# Get current (active) workout
curl "$REBIRTH_BASE/api/workouts?current=true"

# Start a new workout
curl -X POST "$REBIRTH_BASE/api/workouts"

# Get, finish, or add exercise to a workout
curl "$REBIRTH_BASE/api/workouts/<uuid>"
curl -X POST "$REBIRTH_BASE/api/workouts/<uuid>" \
  -H "Content-Type: application/json" \
  -d '{"action":"finish"}'
curl -X POST "$REBIRTH_BASE/api/workouts/<uuid>" \
  -H "Content-Type: application/json" \
  -d '{"action":"add-exercise","exercise_uuid":"<exercise_uuid>"}'

# Repeat a past workout (starts new workout with same exercises)
curl -X POST "$REBIRTH_BASE/api/workouts/<uuid>/repeat"
```

### Exercises

```bash
# List exercises (optional: search, muscleGroup, equipment)
curl "$REBIRTH_BASE/api/exercises?search=bench&muscleGroup=chest"

# Exercise history, PRs, progress for a specific exercise
curl "$REBIRTH_BASE/api/exercises/<uuid>/history"
curl "$REBIRTH_BASE/api/exercises/<uuid>/prs"
curl "$REBIRTH_BASE/api/exercises/<uuid>/progress"
```

### Sets

```bash
# Log or update sets for a workout exercise
curl -X POST "$REBIRTH_BASE/api/workout-exercises/<uuid>/sets" \
  -H "Content-Type: application/json" \
  -d '[{"weight":100,"repetitions":5,"is_completed":true}]'

# List sets for a workout exercise
curl "$REBIRTH_BASE/api/workout-exercises/<uuid>/sets"
```

### Bodyweight

```bash
# List bodyweight logs (default: last 90)
curl -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/bodyweight?limit=30"

# Log bodyweight
curl -X POST -H "Authorization: Bearer $REBIRTH_API_KEY" \
  -H "Content-Type: application/json" \
  "$REBIRTH_BASE/api/bodyweight" \
  -d '{"weight_kg":82.5,"note":"morning, fasted"}'

# Delete a bodyweight log
curl -X DELETE -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/bodyweight/<uuid>"
```

### Plans & Routines

```bash
# List plans
curl "$REBIRTH_BASE/api/plans"

# Create plan
curl -X POST "$REBIRTH_BASE/api/plans" \
  -H "Content-Type: application/json" \
  -d '{"title":"Push Pull Legs"}'

# Get / update / delete a plan
curl "$REBIRTH_BASE/api/plans/<uuid>"
curl -X PUT "$REBIRTH_BASE/api/plans/<uuid>" -H "Content-Type: application/json" -d '{"title":"PPL v2"}'
curl -X DELETE "$REBIRTH_BASE/api/plans/<uuid>"

# Routines within a plan
curl "$REBIRTH_BASE/api/plans/<uuid>/routines"
curl -X POST "$REBIRTH_BASE/api/plans/<uuid>/routines" \
  -H "Content-Type: application/json" \
  -d '{"title":"Push Day","order_index":0}'

# Start a routine (creates a new workout from the template)
curl -X POST "$REBIRTH_BASE/api/plans/<plan_uuid>/routines/<routine_uuid>/start"
```

### Stats

```bash
curl "$REBIRTH_BASE/api/stats"
curl "$REBIRTH_BASE/api/stats/summary"
```

### Export

```bash
curl "$REBIRTH_BASE/api/export?format=json" > rebirth-export.json
curl "$REBIRTH_BASE/api/export?format=csv"  > rebirth-export.csv
```

---

## Module 2 — Body Spec

Tracks point-in-time body composition: height, weight, body fat %, lean mass.

### Schema

| field | type | notes |
|---|---|---|
| uuid | text | auto |
| height_cm | numeric | optional |
| weight_kg | numeric | optional |
| body_fat_pct | numeric | optional, e.g. 18.5 |
| lean_mass_kg | numeric | optional |
| notes | text | optional |
| measured_at | timestamp | defaults to NOW() |

### Endpoints

```bash
# List (default: last 90)
curl -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/body-spec?limit=30"

# Create entry
curl -X POST -H "Authorization: Bearer $REBIRTH_API_KEY" \
  -H "Content-Type: application/json" \
  "$REBIRTH_BASE/api/body-spec" \
  -d '{
    "height_cm": 178,
    "weight_kg": 82.5,
    "body_fat_pct": 18.2,
    "lean_mass_kg": 67.5,
    "notes": "DEXA scan"
  }'

# Get single entry
curl -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/body-spec/<uuid>"

# Update entry (partial update — only send changed fields)
curl -X PATCH -H "Authorization: Bearer $REBIRTH_API_KEY" \
  -H "Content-Type: application/json" \
  "$REBIRTH_BASE/api/body-spec/<uuid>" \
  -d '{"body_fat_pct":17.8,"notes":"corrected reading"}'

# Delete entry
curl -X DELETE -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/body-spec/<uuid>"
```

---

## Module 3 — Measurements

Tracks circumference measurements at named body sites over time.

Valid `site` values: `chest`, `waist`, `hips`, `neck`, `left_bicep`, `right_bicep`, `left_forearm`, `right_forearm`, `left_thigh`, `right_thigh`, `left_calf`, `right_calf`, `shoulders`, `abdomen`

### Schema

| field | type | notes |
|---|---|---|
| uuid | text | auto |
| site | text | required — see valid values above |
| value_cm | numeric | required |
| notes | text | optional |
| measured_at | timestamp | defaults to NOW() |

### Endpoints

```bash
# List all measurements (optional: ?site=waist&limit=30)
curl -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/measurements?limit=90"

# Filter by site
curl -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/measurements?site=waist&limit=30"

# Log a measurement
curl -X POST -H "Authorization: Bearer $REBIRTH_API_KEY" \
  -H "Content-Type: application/json" \
  "$REBIRTH_BASE/api/measurements" \
  -d '{"site":"waist","value_cm":84.5}'

# Get single entry
curl -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/measurements/<uuid>"

# Update entry
curl -X PATCH -H "Authorization: Bearer $REBIRTH_API_KEY" \
  -H "Content-Type: application/json" \
  "$REBIRTH_BASE/api/measurements/<uuid>" \
  -d '{"value_cm":84.0,"notes":"re-measured"}'

# Delete entry
curl -X DELETE -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/measurements/<uuid>"
```

### Bulk logging (log multiple sites at once)

```bash
for site_data in "chest:102.5" "waist:84.5" "hips:98.0"; do
  site="${site_data%%:*}"
  value="${site_data##*:}"
  curl -s -X POST -H "Authorization: Bearer $REBIRTH_API_KEY" \
    -H "Content-Type: application/json" \
    "$REBIRTH_BASE/api/measurements" \
    -d "{\"site\":\"$site\",\"value_cm\":$value}" | jq .uuid
done
```

---

## Module 4 — Nutrition

Tracks daily nutrition intake by meal.

Valid `meal_type` values: `breakfast`, `lunch`, `dinner`, `snack`, `other`

### Schema

| field | type | notes |
|---|---|---|
| uuid | text | auto |
| logged_at | timestamp | defaults to NOW() |
| meal_type | text | optional |
| calories | numeric | optional |
| protein_g | numeric | optional |
| carbs_g | numeric | optional |
| fat_g | numeric | optional |
| notes | text | optional |

### Endpoints

```bash
# List logs (optional: ?limit=30&from=2026-01-01&to=2026-01-31)
curl -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/nutrition?limit=30"

# Filter by date range
curl -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/nutrition?from=2026-03-01&to=2026-03-26"

# Log a meal
curl -X POST -H "Authorization: Bearer $REBIRTH_API_KEY" \
  -H "Content-Type: application/json" \
  "$REBIRTH_BASE/api/nutrition" \
  -d '{
    "meal_type": "lunch",
    "calories": 650,
    "protein_g": 48,
    "carbs_g": 72,
    "fat_g": 18,
    "notes": "chicken rice bowl"
  }'

# Get single entry
curl -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/nutrition/<uuid>"

# Update entry
curl -X PATCH -H "Authorization: Bearer $REBIRTH_API_KEY" \
  -H "Content-Type: application/json" \
  "$REBIRTH_BASE/api/nutrition/<uuid>" \
  -d '{"calories":700,"notes":"extra rice"}'

# Delete entry
curl -X DELETE -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/nutrition/<uuid>"
```

### Daily totals (compute client-side)

```bash
# Get today's logs and sum macros
curl -s -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/nutrition?from=$(date +%Y-%m-%d)&to=$(date +%Y-%m-%d)" \
  | jq '{
      total_calories: [.[].calories // 0] | add,
      total_protein_g: [.[].protein_g // 0] | add,
      total_carbs_g: [.[].carbs_g // 0] | add,
      total_fat_g: [.[].fat_g // 0] | add
    }'
```

---

## Module 5 — HRT

Tracks hormone replacement therapy doses over time.

Valid `route` values: `injection`, `topical`, `oral`, `patch`, `other`

### Schema

| field | type | notes |
|---|---|---|
| uuid | text | auto |
| logged_at | timestamp | defaults to NOW() |
| medication | text | required, e.g. "Testosterone Cypionate" |
| dose_mg | numeric | optional |
| route | text | optional — see valid values above |
| notes | text | optional |

### Endpoints

```bash
# List logs (default: last 90)
curl -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/hrt?limit=30"

# Log a dose
curl -X POST -H "Authorization: Bearer $REBIRTH_API_KEY" \
  -H "Content-Type: application/json" \
  "$REBIRTH_BASE/api/hrt" \
  -d '{
    "medication": "Testosterone Cypionate",
    "dose_mg": 100,
    "route": "injection",
    "notes": "left glute"
  }'

# Get single entry
curl -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/hrt/<uuid>"

# Update entry
curl -X PATCH -H "Authorization: Bearer $REBIRTH_API_KEY" \
  -H "Content-Type: application/json" \
  "$REBIRTH_BASE/api/hrt/<uuid>" \
  -d '{"notes":"right glute, corrected"}'

# Delete entry
curl -X DELETE -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/hrt/<uuid>"
```

---

## Module 6 — Wellbeing

Tracks daily subjective wellbeing: mood, energy, sleep, stress. All scores are 1–10.

### Schema

| field | type | notes |
|---|---|---|
| uuid | text | auto |
| logged_at | timestamp | defaults to NOW() |
| mood | integer | optional, 1–10 |
| energy | integer | optional, 1–10 |
| sleep_hours | numeric | optional |
| sleep_quality | integer | optional, 1–10 |
| stress | integer | optional, 1–10 (10 = highest stress) |
| notes | text | optional |

### Endpoints

```bash
# List logs (default: last 90)
curl -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/wellbeing?limit=30"

# Log a daily check-in
curl -X POST -H "Authorization: Bearer $REBIRTH_API_KEY" \
  -H "Content-Type: application/json" \
  "$REBIRTH_BASE/api/wellbeing" \
  -d '{
    "mood": 8,
    "energy": 7,
    "sleep_hours": 7.5,
    "sleep_quality": 8,
    "stress": 3,
    "notes": "good day, solid sleep"
  }'

# Get single entry
curl -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/wellbeing/<uuid>"

# Update entry
curl -X PATCH -H "Authorization: Bearer $REBIRTH_API_KEY" \
  -H "Content-Type: application/json" \
  "$REBIRTH_BASE/api/wellbeing/<uuid>" \
  -d '{"stress":5,"notes":"updated after tough afternoon"}'

# Delete entry
curl -X DELETE -H "Authorization: Bearer $REBIRTH_API_KEY" \
  "$REBIRTH_BASE/api/wellbeing/<uuid>"
```

---

## Common Patterns

### Log everything for today in one shot

```bash
#!/usr/bin/env bash
set -e
BASE="$REBIRTH_BASE"
KEY="$REBIRTH_API_KEY"
H='Content-Type: application/json'

# Bodyweight
curl -s -X POST -H "Authorization: Bearer $KEY" -H "$H" "$BASE/api/bodyweight" \
  -d '{"weight_kg":82.1}' | jq .

# Wellbeing check-in
curl -s -X POST -H "Authorization: Bearer $KEY" -H "$H" "$BASE/api/wellbeing" \
  -d '{"mood":8,"energy":7,"sleep_hours":7,"sleep_quality":7,"stress":3}' | jq .

# Post-training nutrition
curl -s -X POST -H "Authorization: Bearer $KEY" -H "$H" "$BASE/api/nutrition" \
  -d '{"meal_type":"other","calories":500,"protein_g":50,"notes":"post-workout shake"}' | jq .
```

### Read all recent data for a summary

```bash
BASE="$REBIRTH_BASE"
KEY="$REBIRTH_API_KEY"

echo "=== Last 7 workouts ===" && curl -s "$BASE/api/workouts?limit=7" | jq 'map({uuid,start_time,title})'
echo "=== Last bodyweight ===" && curl -s -H "Authorization: Bearer $KEY" "$BASE/api/bodyweight?limit=5" | jq .
echo "=== Last wellbeing ===" && curl -s -H "Authorization: Bearer $KEY" "$BASE/api/wellbeing?limit=7" | jq .
echo "=== Today nutrition ===" && curl -s -H "Authorization: Bearer $KEY" "$BASE/api/nutrition?from=$(date +%Y-%m-%d)" | jq .
echo "=== Last HRT dose ===" && curl -s -H "Authorization: Bearer $KEY" "$BASE/api/hrt?limit=1" | jq .
```

---

## Access Pattern Notes

- **Stud (Mac Studio)**: hit endpoints directly via `curl` using the Tailscale address or `localhost:3000`.
- **Loft**: use `web_fetch` (GET) or MissionControl relay for mutations. The `Authorization` header must be passed explicitly.
- **Timestamps**: all `logged_at` / `measured_at` fields are optional — omit them to use the current server time. If provided, use ISO 8601: `"2026-03-26T08:30:00Z"`.
- **PATCH semantics**: send only the fields you want to change. Fields not included are left unchanged.
- **Bulk operations**: there is no native bulk endpoint. Loop with individual POST calls (see Measurements example above).

---

## Running Migrations

After pulling code changes that modify `src/db/schema.sql`:

```bash
npm run db:migrate
```

This is idempotent — it uses `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS`.
