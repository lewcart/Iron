import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Exercise, Workout, WorkoutExercise, WorkoutSet } from './types';

// ===== MOCK SETUP =====
// Mock the queries module before any imports of cli.ts
vi.mock('./db/queries.js', () => ({
  listExercises: vi.fn(),
  getExercise: vi.fn(),
  createCustomExercise: vi.fn(),
  startWorkout: vi.fn(),
  getCurrentWorkout: vi.fn(),
  getWorkout: vi.fn(),
  listWorkouts: vi.fn(),
  finishWorkout: vi.fn(),
  cancelWorkout: vi.fn(),
  addExerciseToWorkout: vi.fn(),
  listWorkoutExercises: vi.fn(),
  logSet: vi.fn(),
  listWorkoutSets: vi.fn(),
}));

vi.mock('./db/migrate.js', () => ({
  migrate: vi.fn().mockResolvedValue(undefined),
}));

// ===== TEST FIXTURES =====

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    uuid: 'ex-uuid-1',
    everkinetic_id: 1,
    title: 'Bench Press',
    alias: [],
    description: 'A compound chest exercise',
    primary_muscles: ['chest'],
    secondary_muscles: ['triceps', 'shoulders'],
    equipment: ['barbell', 'bench'],
    steps: ['Lie on bench', 'Grip bar', 'Press up'],
    tips: ['Keep back flat'],
    is_custom: false,
    is_hidden: false,
    ...overrides,
  };
}

function makeWorkout(overrides: Partial<Workout> = {}): Workout {
  return {
    uuid: 'wo-uuid-1',
    start_time: '2026-03-16T10:00:00.000Z',
    end_time: null,
    title: null,
    comment: null,
    is_current: true,
    ...overrides,
  };
}

function makeWorkoutExercise(overrides: Partial<WorkoutExercise> = {}): WorkoutExercise {
  return {
    uuid: 'we-uuid-1',
    workout_uuid: 'wo-uuid-1',
    exercise_uuid: 'ex-uuid-1',
    comment: null,
    order_index: 0,
    ...overrides,
  };
}

function makeWorkoutSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    uuid: 'ws-uuid-1',
    workout_exercise_uuid: 'we-uuid-1',
    weight: 100,
    repetitions: 8,
    min_target_reps: null,
    max_target_reps: null,
    rpe: null,
    tag: null,
    comment: null,
    is_completed: true,
    order_index: 0,
    ...overrides,
  };
}

// ===== HELPERS =====

/**
 * Runs a CLI command by:
 * 1. Setting process.argv to the given args
 * 2. Resetting the cli module so program.parse() re-runs with new argv
 * 3. Dynamically importing cli.ts
 *
 * Commander calls program.parse() synchronously at module load, but the
 * action handlers are async. We wait for all pending microtasks to settle.
 */
async function runCli(...args: string[]): Promise<void> {
  process.argv = ['node', 'cli', ...args];
  vi.resetModules();
  // Re-import so program.parse() fires with the new argv
  await import('./cli.js');
  // Flush pending promises from async action handlers
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ===== TEST SUITE =====

describe('CLI commands', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let _consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let _processExitSpy: ReturnType<typeof vi.spyOn>;
  let _stderrSpy: ReturnType<typeof vi.spyOn>;

  // We need access to the mocked queries inside tests. We import them once
  // per test after resetting modules. To avoid repetition, we expose them via
  // a shared reference that is refreshed in beforeEach.
  let queries: typeof import('./db/queries.js');
  let migrate: typeof import('./db/migrate.js');

  beforeEach(async () => {
    vi.clearAllMocks();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    _consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    _stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    _processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    // Get fresh mock references (vi.mock hoisting keeps the same mock fns
    // even after resetModules for the mocked module paths)
    queries = await import('./db/queries.js');
    migrate = await import('./db/migrate.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===== SETUP COMMANDS =====

  describe('init', () => {
    it('calls migrate and logs success message', async () => {
      await runCli('init');

      expect(migrate.migrate).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '✓ Database initialized. Run "rebirth seed" to load exercises.'
      );
    });
  });

  // ===== EXERCISE COMMANDS =====

  describe('list-exercises', () => {
    it('prints "No exercises found" when result is empty', async () => {
      vi.mocked(queries.listExercises).mockResolvedValue([]);

      await runCli('list-exercises');

      expect(queries.listExercises).toHaveBeenCalledWith({
        search: undefined,
        muscleGroup: undefined,
        includeHidden: undefined,
      });
      expect(consoleLogSpy).toHaveBeenCalledWith('No exercises found');
    });

    it('prints exercise list when exercises are found', async () => {
      const ex = makeExercise();
      vi.mocked(queries.listExercises).mockResolvedValue([ex]);

      await runCli('list-exercises');

      expect(consoleLogSpy).toHaveBeenCalledWith('Found 1 exercises:\n');
      expect(consoleLogSpy).toHaveBeenCalledWith('Bench Press');
      expect(consoleLogSpy).toHaveBeenCalledWith('  UUID: ex-uuid-1');
      expect(consoleLogSpy).toHaveBeenCalledWith('  Muscles: chest');
    });

    it('shows [CUSTOM] label for custom exercises', async () => {
      const ex = makeExercise({ is_custom: true });
      vi.mocked(queries.listExercises).mockResolvedValue([ex]);

      await runCli('list-exercises');

      expect(consoleLogSpy).toHaveBeenCalledWith('Bench Press [CUSTOM]');
    });

    it('passes search option to listExercises', async () => {
      vi.mocked(queries.listExercises).mockResolvedValue([]);

      await runCli('list-exercises', '--search', 'bench');

      expect(queries.listExercises).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'bench' })
      );
    });

    it('passes muscle option to listExercises', async () => {
      vi.mocked(queries.listExercises).mockResolvedValue([]);

      await runCli('list-exercises', '--muscle', 'chest');

      expect(queries.listExercises).toHaveBeenCalledWith(
        expect.objectContaining({ muscleGroup: 'chest' })
      );
    });

    it('passes hidden flag to listExercises', async () => {
      vi.mocked(queries.listExercises).mockResolvedValue([]);

      await runCli('list-exercises', '--hidden');

      expect(queries.listExercises).toHaveBeenCalledWith(
        expect.objectContaining({ includeHidden: true })
      );
    });
  });

  describe('show-exercise', () => {
    it('prints "Exercise not found" when exercise does not exist', async () => {
      vi.mocked(queries.getExercise).mockResolvedValue(null);

      await runCli('show-exercise', 'nonexistent-uuid');

      expect(queries.getExercise).toHaveBeenCalledWith('nonexistent-uuid');
      expect(consoleLogSpy).toHaveBeenCalledWith('❌ Exercise not found');
    });

    it('prints exercise details when found', async () => {
      const ex = makeExercise();
      vi.mocked(queries.getExercise).mockResolvedValue(ex);

      await runCli('show-exercise', 'ex-uuid-1');

      expect(consoleLogSpy).toHaveBeenCalledWith('\nBench Press\n');
      expect(consoleLogSpy).toHaveBeenCalledWith('UUID: ex-uuid-1');
      expect(consoleLogSpy).toHaveBeenCalledWith('Primary muscles: chest');
      expect(consoleLogSpy).toHaveBeenCalledWith('Secondary muscles: triceps, shoulders');
      expect(consoleLogSpy).toHaveBeenCalledWith('Equipment: barbell, bench');
      expect(consoleLogSpy).toHaveBeenCalledWith('\nA compound chest exercise');
    });

    it('prints steps when present', async () => {
      const ex = makeExercise();
      vi.mocked(queries.getExercise).mockResolvedValue(ex);

      await runCli('show-exercise', 'ex-uuid-1');

      expect(consoleLogSpy).toHaveBeenCalledWith('\nSteps:');
      expect(consoleLogSpy).toHaveBeenCalledWith('  1. Lie on bench');
      expect(consoleLogSpy).toHaveBeenCalledWith('  2. Grip bar');
      expect(consoleLogSpy).toHaveBeenCalledWith('  3. Press up');
    });

    it('prints tips when present', async () => {
      const ex = makeExercise();
      vi.mocked(queries.getExercise).mockResolvedValue(ex);

      await runCli('show-exercise', 'ex-uuid-1');

      expect(consoleLogSpy).toHaveBeenCalledWith('\nTips:');
      expect(consoleLogSpy).toHaveBeenCalledWith('  • Keep back flat');
    });

    it('omits secondary muscles section when empty', async () => {
      const ex = makeExercise({ secondary_muscles: [] });
      vi.mocked(queries.getExercise).mockResolvedValue(ex);

      await runCli('show-exercise', 'ex-uuid-1');

      const calls = consoleLogSpy.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => typeof c === 'string' && c.startsWith('Secondary muscles'))).toBe(false);
    });

    it('omits equipment section when empty', async () => {
      const ex = makeExercise({ equipment: [] });
      vi.mocked(queries.getExercise).mockResolvedValue(ex);

      await runCli('show-exercise', 'ex-uuid-1');

      const calls = consoleLogSpy.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => typeof c === 'string' && c.startsWith('Equipment'))).toBe(false);
    });
  });

  describe('create-exercise', () => {
    it('creates exercise and prints confirmation', async () => {
      const ex = makeExercise({ title: 'Cable Fly', uuid: 'ex-new-uuid' });
      vi.mocked(queries.createCustomExercise).mockResolvedValue(ex);

      await runCli('create-exercise', 'Cable Fly', '--muscles', 'chest,shoulders');

      expect(queries.createCustomExercise).toHaveBeenCalledWith({
        title: 'Cable Fly',
        description: undefined,
        primaryMuscles: ['chest', 'shoulders'],
        equipment: [],
      });
      expect(consoleLogSpy).toHaveBeenCalledWith('✓ Created custom exercise: Cable Fly');
      expect(consoleLogSpy).toHaveBeenCalledWith('  UUID: ex-new-uuid');
    });

    it('trims whitespace from muscle names', async () => {
      const ex = makeExercise({ title: 'Dip' });
      vi.mocked(queries.createCustomExercise).mockResolvedValue(ex);

      await runCli('create-exercise', 'Dip', '--muscles', 'chest, triceps');

      expect(queries.createCustomExercise).toHaveBeenCalledWith(
        expect.objectContaining({ primaryMuscles: ['chest', 'triceps'] })
      );
    });

    it('passes description when provided', async () => {
      const ex = makeExercise();
      vi.mocked(queries.createCustomExercise).mockResolvedValue(ex);

      await runCli(
        'create-exercise',
        'Bench Press',
        '--muscles',
        'chest',
        '--description',
        'Great chest exercise'
      );

      expect(queries.createCustomExercise).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Great chest exercise' })
      );
    });

    it('passes equipment when provided', async () => {
      const ex = makeExercise();
      vi.mocked(queries.createCustomExercise).mockResolvedValue(ex);

      await runCli(
        'create-exercise',
        'Bench Press',
        '--muscles',
        'chest',
        '--equipment',
        'barbell, bench'
      );

      expect(queries.createCustomExercise).toHaveBeenCalledWith(
        expect.objectContaining({ equipment: ['barbell', 'bench'] })
      );
    });
  });

  // ===== WORKOUT COMMANDS =====

  describe('start-workout', () => {
    it('starts workout and prints confirmation', async () => {
      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(null);
      const workout = makeWorkout();
      vi.mocked(queries.startWorkout).mockResolvedValue(workout);

      await runCli('start-workout');

      expect(queries.startWorkout).toHaveBeenCalledWith(undefined);
      expect(consoleLogSpy).toHaveBeenCalledWith('✓ Started workout');
      expect(consoleLogSpy).toHaveBeenCalledWith('  UUID: wo-uuid-1');
    });

    it('prints error when workout already in progress', async () => {
      const existing = makeWorkout({ uuid: 'existing-uuid' });
      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(existing);

      await runCli('start-workout');

      expect(queries.startWorkout).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('❌ A workout is already in progress');
      expect(consoleLogSpy).toHaveBeenCalledWith('   UUID: existing-uuid');
    });

    it('passes routine uuid when --routine flag provided', async () => {
      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(null);
      const workout = makeWorkout();
      vi.mocked(queries.startWorkout).mockResolvedValue(workout);

      await runCli('start-workout', '--routine', 'routine-uuid-1');

      expect(queries.startWorkout).toHaveBeenCalledWith('routine-uuid-1');
    });
  });

  describe('current-workout', () => {
    it('prints message when no workout in progress', async () => {
      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(null);

      await runCli('current-workout');

      expect(consoleLogSpy).toHaveBeenCalledWith('No workout in progress');
      expect(consoleLogSpy).toHaveBeenCalledWith('Start one with: rebirth start-workout');
    });

    it('prints workout header when workout is active', async () => {
      const workout = makeWorkout();
      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(workout);
      vi.mocked(queries.listWorkoutExercises).mockResolvedValue([]);

      await runCli('current-workout');

      expect(consoleLogSpy).toHaveBeenCalledWith('\nCurrent Workout');
      expect(consoleLogSpy).toHaveBeenCalledWith('UUID: wo-uuid-1');
      expect(consoleLogSpy).toHaveBeenCalledWith('No exercises added yet');
    });

    it('prints exercises and sets for active workout', async () => {
      const workout = makeWorkout();
      const we = makeWorkoutExercise();
      const ex = makeExercise();
      const sets = [
        makeWorkoutSet({ is_completed: true, weight: 100, repetitions: 8 }),
        makeWorkoutSet({ uuid: 'ws-uuid-2', is_completed: false, weight: null, repetitions: null }),
      ];

      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(workout);
      vi.mocked(queries.listWorkoutExercises).mockResolvedValue([we]);
      vi.mocked(queries.getExercise).mockResolvedValue(ex);
      vi.mocked(queries.listWorkoutSets).mockResolvedValue(sets);

      await runCli('current-workout');

      expect(consoleLogSpy).toHaveBeenCalledWith('1. Bench Press');
      expect(consoleLogSpy).toHaveBeenCalledWith('   Sets: 1/2 completed');
      expect(consoleLogSpy).toHaveBeenCalledWith('   ✓ Set 1: 100kg × 8 reps');
      expect(consoleLogSpy).toHaveBeenCalledWith('   ○ Set 2: - × -');
    });
  });

  describe('add-exercise', () => {
    it('prints error when no workout in progress', async () => {
      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(null);

      await runCli('add-exercise', 'ex-uuid-1');

      expect(consoleLogSpy).toHaveBeenCalledWith('❌ No workout in progress');
      expect(queries.addExerciseToWorkout).not.toHaveBeenCalled();
    });

    it('prints error when exercise not found', async () => {
      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(makeWorkout());
      vi.mocked(queries.getExercise).mockResolvedValue(null);

      await runCli('add-exercise', 'bad-uuid');

      expect(consoleLogSpy).toHaveBeenCalledWith('❌ Exercise not found');
      expect(queries.addExerciseToWorkout).not.toHaveBeenCalled();
    });

    it('adds exercise and prints confirmation', async () => {
      const workout = makeWorkout();
      const ex = makeExercise();
      const we = makeWorkoutExercise();
      const sets = [
        makeWorkoutSet(),
        makeWorkoutSet({ uuid: 'ws-uuid-2', order_index: 1 }),
        makeWorkoutSet({ uuid: 'ws-uuid-3', order_index: 2 }),
      ];

      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(workout);
      vi.mocked(queries.getExercise).mockResolvedValue(ex);
      vi.mocked(queries.addExerciseToWorkout).mockResolvedValue(we);
      vi.mocked(queries.listWorkoutSets).mockResolvedValue(sets);

      await runCli('add-exercise', 'ex-uuid-1');

      expect(queries.addExerciseToWorkout).toHaveBeenCalledWith('wo-uuid-1', 'ex-uuid-1');
      expect(consoleLogSpy).toHaveBeenCalledWith('✓ Added Bench Press to workout');
      expect(consoleLogSpy).toHaveBeenCalledWith('  Exercise UUID: we-uuid-1');
      expect(consoleLogSpy).toHaveBeenCalledWith('  3 empty sets created');
    });
  });

  describe('log-set', () => {
    it('prints error when no workout in progress', async () => {
      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(null);

      await runCli('log-set', 'we-uuid-1', '100', '8');

      expect(consoleLogSpy).toHaveBeenCalledWith('❌ No workout in progress');
      expect(queries.logSet).not.toHaveBeenCalled();
    });

    it('prints error when exercise not in current workout', async () => {
      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(makeWorkout());
      vi.mocked(queries.listWorkoutExercises).mockResolvedValue([
        makeWorkoutExercise({ uuid: 'other-we-uuid' }),
      ]);

      await runCli('log-set', 'we-uuid-1', '100', '8');

      expect(consoleLogSpy).toHaveBeenCalledWith('❌ Exercise not found in current workout');
      expect(queries.logSet).not.toHaveBeenCalled();
    });

    it('logs a set and prints confirmation', async () => {
      const workout = makeWorkout();
      const we = makeWorkoutExercise({ uuid: 'we-uuid-1', exercise_uuid: 'ex-uuid-1' });
      const ex = makeExercise();

      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(workout);
      vi.mocked(queries.listWorkoutExercises).mockResolvedValue([we]);
      vi.mocked(queries.logSet).mockResolvedValue(makeWorkoutSet());
      vi.mocked(queries.getExercise).mockResolvedValue(ex);

      await runCli('log-set', 'we-uuid-1', '100', '8');

      expect(queries.logSet).toHaveBeenCalledWith({
        workoutExerciseUuid: 'we-uuid-1',
        weight: 100,
        repetitions: 8,
        rpe: undefined,
        tag: undefined,
      });
      expect(consoleLogSpy).toHaveBeenCalledWith('✓ Logged set for Bench Press');
      expect(consoleLogSpy).toHaveBeenCalledWith('  100kg × 8 reps');
    });

    it('passes rpe when --rpe flag provided', async () => {
      const we = makeWorkoutExercise({ uuid: 'we-uuid-1', exercise_uuid: 'ex-uuid-1' });
      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(makeWorkout());
      vi.mocked(queries.listWorkoutExercises).mockResolvedValue([we]);
      vi.mocked(queries.logSet).mockResolvedValue(makeWorkoutSet());
      vi.mocked(queries.getExercise).mockResolvedValue(makeExercise());

      await runCli('log-set', 'we-uuid-1', '80', '10', '--rpe', '8.5');

      expect(queries.logSet).toHaveBeenCalledWith(
        expect.objectContaining({ rpe: 8.5 })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith('  RPE: 8.5');
    });

    it('passes tag when --tag flag provided', async () => {
      const we = makeWorkoutExercise({ uuid: 'we-uuid-1', exercise_uuid: 'ex-uuid-1' });
      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(makeWorkout());
      vi.mocked(queries.listWorkoutExercises).mockResolvedValue([we]);
      vi.mocked(queries.logSet).mockResolvedValue(makeWorkoutSet());
      vi.mocked(queries.getExercise).mockResolvedValue(makeExercise());

      await runCli('log-set', 'we-uuid-1', '60', '15', '--tag', 'dropSet');

      expect(queries.logSet).toHaveBeenCalledWith(
        expect.objectContaining({ tag: 'dropSet' })
      );
    });

    it('parses weight and reps as numbers', async () => {
      const we = makeWorkoutExercise({ uuid: 'we-uuid-1', exercise_uuid: 'ex-uuid-1' });
      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(makeWorkout());
      vi.mocked(queries.listWorkoutExercises).mockResolvedValue([we]);
      vi.mocked(queries.logSet).mockResolvedValue(makeWorkoutSet());
      vi.mocked(queries.getExercise).mockResolvedValue(makeExercise());

      await runCli('log-set', 'we-uuid-1', '82.5', '6');

      expect(queries.logSet).toHaveBeenCalledWith(
        expect.objectContaining({ weight: 82.5, repetitions: 6 })
      );
    });
  });

  describe('finish-workout', () => {
    it('prints error when no workout in progress', async () => {
      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(null);

      await runCli('finish-workout');

      expect(consoleLogSpy).toHaveBeenCalledWith('❌ No workout in progress');
      expect(queries.finishWorkout).not.toHaveBeenCalled();
    });

    it('finishes workout and prints duration', async () => {
      const workout = makeWorkout({ uuid: 'wo-uuid-1' });
      const finished = makeWorkout({
        uuid: 'wo-uuid-1',
        is_current: false,
        start_time: '2026-03-16T10:00:00.000Z',
        end_time: '2026-03-16T10:45:00.000Z',
      });

      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(workout);
      vi.mocked(queries.finishWorkout).mockResolvedValue(finished);

      await runCli('finish-workout');

      expect(queries.finishWorkout).toHaveBeenCalledWith('wo-uuid-1');
      expect(consoleLogSpy).toHaveBeenCalledWith('✓ Workout finished!');
      expect(consoleLogSpy).toHaveBeenCalledWith('  Duration: 45 minutes');
      expect(consoleLogSpy).toHaveBeenCalledWith('  UUID: wo-uuid-1');
    });
  });

  describe('cancel-workout', () => {
    it('prints error when no workout in progress', async () => {
      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(null);

      await runCli('cancel-workout');

      expect(consoleLogSpy).toHaveBeenCalledWith('❌ No workout in progress');
      expect(queries.cancelWorkout).not.toHaveBeenCalled();
    });

    it('cancels workout and prints confirmation', async () => {
      const workout = makeWorkout({ uuid: 'wo-uuid-1' });
      vi.mocked(queries.getCurrentWorkout).mockResolvedValue(workout);
      vi.mocked(queries.cancelWorkout).mockResolvedValue(undefined);

      await runCli('cancel-workout');

      expect(queries.cancelWorkout).toHaveBeenCalledWith('wo-uuid-1');
      expect(consoleLogSpy).toHaveBeenCalledWith('✓ Workout cancelled');
    });
  });

  // ===== HISTORY COMMANDS =====

  describe('list-workouts', () => {
    it('prints "No workouts found" when result is empty', async () => {
      vi.mocked(queries.listWorkouts).mockResolvedValue([]);

      await runCli('list-workouts');

      expect(queries.listWorkouts).toHaveBeenCalledWith({ limit: 10, offset: 0 });
      expect(consoleLogSpy).toHaveBeenCalledWith('No workouts found');
    });

    it('prints workout list with title and duration', async () => {
      const workout = makeWorkout({
        uuid: 'wo-uuid-1',
        title: 'Push Day',
        start_time: '2026-03-16T10:00:00.000Z',
        end_time: '2026-03-16T11:00:00.000Z',
        is_current: false,
      });
      vi.mocked(queries.listWorkouts).mockResolvedValue([workout]);

      await runCli('list-workouts');

      expect(consoleLogSpy).toHaveBeenCalledWith('Found 1 workouts:\n');
      expect(consoleLogSpy).toHaveBeenCalledWith('  UUID: wo-uuid-1');
      expect(consoleLogSpy).toHaveBeenCalledWith('  Duration: 60 minutes');
    });

    it('shows "Workout" as fallback title when title is null', async () => {
      const workout = makeWorkout({
        title: null,
        start_time: '2026-03-16T10:00:00.000Z',
        end_time: '2026-03-16T10:30:00.000Z',
        is_current: false,
      });
      vi.mocked(queries.listWorkouts).mockResolvedValue([workout]);

      await runCli('list-workouts');

      const allCalls = consoleLogSpy.mock.calls.map((c) => c[0] as string);
      expect(allCalls.some((c) => c.includes('Workout') && c.includes('/'))).toBe(true);
    });

    it('uses limit and offset options', async () => {
      vi.mocked(queries.listWorkouts).mockResolvedValue([]);

      await runCli('list-workouts', '--limit', '5', '--offset', '10');

      expect(queries.listWorkouts).toHaveBeenCalledWith({ limit: 5, offset: 10 });
    });

    it('shows zero duration for workouts without end_time', async () => {
      const workout = makeWorkout({
        start_time: '2026-03-16T10:00:00.000Z',
        end_time: null,
        is_current: false,
      });
      vi.mocked(queries.listWorkouts).mockResolvedValue([workout]);

      await runCli('list-workouts');

      expect(consoleLogSpy).toHaveBeenCalledWith('  Duration: 0 minutes');
    });
  });

  describe('show-workout', () => {
    it('prints error when workout not found', async () => {
      vi.mocked(queries.getWorkout).mockResolvedValue(null);

      await runCli('show-workout', 'nonexistent-uuid');

      expect(queries.getWorkout).toHaveBeenCalledWith('nonexistent-uuid');
      expect(consoleLogSpy).toHaveBeenCalledWith('❌ Workout not found');
    });

    it('prints workout header with title and date', async () => {
      const workout = makeWorkout({
        uuid: 'wo-uuid-1',
        title: 'Pull Day',
        start_time: '2026-03-16T10:00:00.000Z',
        end_time: '2026-03-16T11:30:00.000Z',
        is_current: false,
      });
      vi.mocked(queries.getWorkout).mockResolvedValue(workout);
      vi.mocked(queries.listWorkoutExercises).mockResolvedValue([]);

      await runCli('show-workout', 'wo-uuid-1');

      expect(consoleLogSpy).toHaveBeenCalledWith('\nPull Day');
      expect(consoleLogSpy).toHaveBeenCalledWith('Duration: 90 minutes');
    });

    it('uses "Workout" as fallback title when title is null', async () => {
      const workout = makeWorkout({
        uuid: 'wo-uuid-1',
        title: null,
        start_time: '2026-03-16T10:00:00.000Z',
        end_time: null,
        is_current: false,
      });
      vi.mocked(queries.getWorkout).mockResolvedValue(workout);
      vi.mocked(queries.listWorkoutExercises).mockResolvedValue([]);

      await runCli('show-workout', 'wo-uuid-1');

      expect(consoleLogSpy).toHaveBeenCalledWith('\nWorkout');
    });

    it('omits duration when end_time is null', async () => {
      const workout = makeWorkout({
        uuid: 'wo-uuid-1',
        start_time: '2026-03-16T10:00:00.000Z',
        end_time: null,
        is_current: true,
      });
      vi.mocked(queries.getWorkout).mockResolvedValue(workout);
      vi.mocked(queries.listWorkoutExercises).mockResolvedValue([]);

      await runCli('show-workout', 'wo-uuid-1');

      const calls = consoleLogSpy.mock.calls.map((c) => c[0] as string);
      expect(calls.some((c) => c.startsWith('Duration'))).toBe(false);
    });

    it('prints exercises and completed sets', async () => {
      const workout = makeWorkout({
        uuid: 'wo-uuid-1',
        start_time: '2026-03-16T10:00:00.000Z',
        end_time: null,
        is_current: true,
      });
      const we = makeWorkoutExercise();
      const ex = makeExercise();
      const sets = [
        makeWorkoutSet({ is_completed: true, weight: 100, repetitions: 8, rpe: 8.5 }),
        makeWorkoutSet({ uuid: 'ws-uuid-2', is_completed: false, weight: null, repetitions: null }),
      ];

      vi.mocked(queries.getWorkout).mockResolvedValue(workout);
      vi.mocked(queries.listWorkoutExercises).mockResolvedValue([we]);
      vi.mocked(queries.getExercise).mockResolvedValue(ex);
      vi.mocked(queries.listWorkoutSets).mockResolvedValue(sets);

      await runCli('show-workout', 'wo-uuid-1');

      expect(consoleLogSpy).toHaveBeenCalledWith('1. Bench Press');
      // Only completed sets should be shown
      expect(consoleLogSpy).toHaveBeenCalledWith('   Set 1: 100kg × 8 reps @ RPE 8.5');
      // Incomplete set should not be logged
      const calls = consoleLogSpy.mock.calls.map((c) => c[0] as string);
      expect(calls.filter((c) => c.startsWith('   Set ')).length).toBe(1);
    });

    it('omits RPE from set display when not present', async () => {
      const workout = makeWorkout({ uuid: 'wo-uuid-1', end_time: null });
      const we = makeWorkoutExercise();
      const ex = makeExercise();
      const sets = [makeWorkoutSet({ is_completed: true, weight: 60, repetitions: 12, rpe: null })];

      vi.mocked(queries.getWorkout).mockResolvedValue(workout);
      vi.mocked(queries.listWorkoutExercises).mockResolvedValue([we]);
      vi.mocked(queries.getExercise).mockResolvedValue(ex);
      vi.mocked(queries.listWorkoutSets).mockResolvedValue(sets);

      await runCli('show-workout', 'wo-uuid-1');

      expect(consoleLogSpy).toHaveBeenCalledWith('   Set 1: 60kg × 12 reps');
    });
  });
});
