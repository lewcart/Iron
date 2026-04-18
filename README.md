# Rebirth

Personal fitness, body, nutrition, HRT, and wellbeing tracker — CLI-first architecture.

## Overview

Rebirth is a personal-use web + iOS app for tracking workouts, body composition, nutrition, HRT, and wellbeing. The workout core was inspired by the iOS app [Iron Workout Tracker](https://github.com/karimknaebel/Iron); Rebirth extends that foundation into a full holistic tracker.

## Key Features

- **CLI-First**: Every action can be performed from the command line
- **Exercise Library**: 400+ built-in exercises + custom exercises
- **Workout Tracking**: Log sets, reps, weight, RPE
- **Workout Plans**: Create reusable workout routines
- **Body & Measurements**: Bodyweight, body-spec versions, circumference logs, progress photos
- **Nutrition**: Standard Week templates, per-food entries, Fitbee imports
- **HRT**: Protocols + daily adherence log
- **Wellbeing**: Mood/energy/sleep/stress + dysphoria/euphoria journal
- **History & Stats**: Track progress, personal records, 1RM estimates
- **iOS (Capacitor)**: native iPhone app with HealthKit, Lock Screen ControlWidget, local notifications

## Tech Stack

- **Frontend**: Next.js 15 + React 19 + TypeScript
- **Database**: PostgreSQL (Neon) + Dexie for offline
- **CLI**: Commander.js
- **iOS**: Capacitor 8
- **Deployment**: Vercel

## Getting Started

### Installation

```bash
npm install
```

### Database Setup

See `NEON_SETUP.md` for Neon Postgres setup. Then:

```bash
npm run db:migrate
npm run db:seed
```

### Development

```bash
# Start web app
npm run dev

# Use CLI
npm run cli -- --help
```

## CLI Usage

```bash
# Start a workout
rebirth start-workout

# Add exercise to current workout
rebirth add-exercise <exercise-name>

# Log a set
rebirth log-set <weight> <reps>

# Finish workout
rebirth finish-workout

# View history
rebirth list-workouts

# List exercises
rebirth list-exercises
```

## Architecture

### CLI-First Design

Every meaningful action is accessible via CLI:
- Workout tracking (start, log, finish)
- Exercise management (list, search, create custom)
- Workout plans (create, manage routines)
- History queries (workouts, stats, PRs)

This enables automation tools (Mission Control, Claude Code, MCP server) to interact with Rebirth without touching the UI.

### Data Model

Module 1 — Training:
- **Exercises**, **Workouts**, **WorkoutExercises**, **WorkoutSets**, **WorkoutPlans**, **WorkoutRoutines**

Modules 2–10 — Body / Nutrition / HRT / Wellbeing:
- **body_spec_logs**, **bodyweight_logs**, **measurement_logs**, **progress_photos**
- **nutrition_logs**, **nutrition_food_entries**, **nutrition_week_meals**
- **hrt_protocols**, **hrt_logs**
- **wellbeing_logs**, **dysphoria_logs**, **clothes_test_logs**, **inspo_photos**

## Development

- `npm run dev` - Start Next.js dev server
- `npm run build` - Build for production
- `npm run build:cap` - Build static export for Capacitor iOS
- `npm run cli` - Run CLI commands
- `npm run db:migrate` - Run database migrations
- `npm run db:seed` - Seed exercise database
- `npm test` - Run vitest suite

## License

Personal use only.
