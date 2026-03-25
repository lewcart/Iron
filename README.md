# Rebirth

Personal body & identity tracking app — training, nutrition, HRT, measurements, and wellbeing.

## Overview

Rebirth is a holistic body transformation tracker covering workout logging, body measurements, nutrition, HRT, and identity/wellbeing goals. CLI-first architecture.

## Key Features

- **CLI-First**: Every action can be performed from the command line
- **Exercise Library**: 400+ built-in exercises + custom exercises
- **Workout Tracking**: Log sets, reps, weight, RPE
- **Workout Plans**: Create reusable workout routines
- **History & Stats**: Track progress, personal records, 1RM estimates
- **Bodyweight Tracking**: Log weight over time with unit toggle (kg/lbs)

## Tech Stack

- **Frontend**: Next.js 15 + React 19 + TypeScript
- **Database**: Neon PostgreSQL
- **CLI**: Commander.js
- **Deployment**: Vercel (post-MVP)

## Getting Started

### Installation

```bash
npm install
```

### Database Setup

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

This enables automation tools (Zephyr, notion-daemon, Claude Code) to interact with Rebirth without touching the UI.

### Data Model

- **Exercises**: Built-in library + custom user exercises
- **Workouts**: Workout sessions with start/end times
- **WorkoutExercises**: Exercises performed in a workout
- **WorkoutSets**: Individual sets with weight, reps, RPE
- **WorkoutPlans**: Templates for workout routines
- **WorkoutRoutines**: Days/sessions within a plan
- **BodyweightLogs**: Weight entries over time

## Development

- `npm run dev` - Start Next.js dev server
- `npm run build` - Build for production
- `npm run cli` - Run CLI commands
- `npm run db:migrate` - Run database migrations
- `npm run db:seed` - Seed exercise database

## License

Personal use only.
