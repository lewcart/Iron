# Iron

Personal workout tracking app - CLI-first architecture.

## Overview

Iron is a personal-use web app for tracking workouts, exercises, and progress. Inspired by the iOS app [Iron Workout Tracker](https://github.com/karimknaebel/Iron).

## Key Features

- **CLI-First**: Every action can be performed from the command line
- **Exercise Library**: 400+ built-in exercises + custom exercises
- **Workout Tracking**: Log sets, reps, weight, RPE
- **Workout Plans**: Create reusable workout routines
- **History & Stats**: Track progress, personal records, 1RM estimates

## Tech Stack

- **Frontend**: Next.js 15 + React 19 + TypeScript
- **Database**: SQLite (better-sqlite3)
- **CLI**: Commander.js
- **Deployment**: Vercel

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
iron start-workout

# Add exercise to current workout
iron add-exercise <exercise-name>

# Log a set
iron log-set <weight> <reps>

# Finish workout
iron finish-workout

# View history
iron list-workouts

# List exercises
iron list-exercises
```

## Architecture

### CLI-First Design

Every meaningful action is accessible via CLI:
- Workout tracking (start, log, finish)
- Exercise management (list, search, create custom)
- Workout plans (create, manage routines)
- History queries (workouts, stats, PRs)

This enables automation tools (Zephyr, notion-daemon, Claude Code) to interact with Iron without touching the UI.

### Data Model

- **Exercises**: Built-in library + custom user exercises
- **Workouts**: Workout sessions with start/end times
- **WorkoutExercises**: Exercises performed in a workout
- **WorkoutSets**: Individual sets with weight, reps, RPE
- **WorkoutPlans**: Templates for workout routines
- **WorkoutRoutines**: Days/sessions within a plan

## Development

- `npm run dev` - Start Next.js dev server
- `npm run build` - Build for production
- `npm run cli` - Run CLI commands
- `npm run db:migrate` - Run database migrations
- `npm run db:seed` - Seed exercise database

## License

Personal use only.
