#!/usr/bin/env node

import { Command } from 'commander';
import {
  listExercises,
  getExercise,
  createCustomExercise,
  startWorkout,
  getCurrentWorkout,
  getWorkout,
  listWorkouts,
  finishWorkout,
  cancelWorkout,
  addExerciseToWorkout,
  listWorkoutExercises,
  logSet,
  updateSet,
  listWorkoutSets,
} from './db/queries.js';
import { migrate } from './db/migrate.js';

const program = new Command();

program
  .name('iron')
  .description('CLI-first workout tracker')
  .version('0.1.0');

// ===== SETUP =====

program
  .command('init')
  .description('Initialize database')
  .action(async () => {
    await migrate();
    console.log('✓ Database initialized. Run "iron seed" to load exercises.');
  });

// ===== EXERCISES =====

program
  .command('list-exercises')
  .description('List all exercises')
  .option('-s, --search <term>', 'Search by name')
  .option('-m, --muscle <group>', 'Filter by muscle group')
  .option('--hidden', 'Include hidden exercises')
  .action(async (options) => {
    const exercises = await listExercises({
      search: options.search,
      muscleGroup: options.muscle,
      includeHidden: options.hidden,
    });

    if (exercises.length === 0) {
      console.log('No exercises found');
      return;
    }

    console.log(`Found ${exercises.length} exercises:\n`);
    exercises.forEach((ex) => {
      const muscles = ex.primary_muscles.join(', ');
      const custom = ex.is_custom ? ' [CUSTOM]' : '';
      console.log(`${ex.title}${custom}`);
      console.log(`  UUID: ${ex.uuid}`);
      console.log(`  Muscles: ${muscles}`);
      console.log('');
    });
  });

program
  .command('show-exercise <uuid>')
  .description('Show exercise details')
  .action(async (uuid) => {
    const exercise = await getExercise(uuid);
    if (!exercise) {
      console.log('❌ Exercise not found');
      return;
    }

    console.log(`\n${exercise.title}\n`);
    console.log(`UUID: ${exercise.uuid}`);
    console.log(`Primary muscles: ${exercise.primary_muscles.join(', ')}`);
    if (exercise.secondary_muscles.length > 0) {
      console.log(`Secondary muscles: ${exercise.secondary_muscles.join(', ')}`);
    }
    if (exercise.equipment.length > 0) {
      console.log(`Equipment: ${exercise.equipment.join(', ')}`);
    }
    if (exercise.description) {
      console.log(`\n${exercise.description}`);
    }
    if (exercise.steps.length > 0) {
      console.log('\nSteps:');
      exercise.steps.forEach((step, i) => {
        console.log(`  ${i + 1}. ${step}`);
      });
    }
    if (exercise.tips.length > 0) {
      console.log('\nTips:');
      exercise.tips.forEach((tip) => {
        console.log(`  • ${tip}`);
      });
    }
  });

program
  .command('create-exercise <name>')
  .description('Create a custom exercise')
  .requiredOption('-m, --muscles <muscles>', 'Primary muscles (comma-separated)')
  .option('-d, --description <text>', 'Exercise description')
  .option('-e, --equipment <items>', 'Equipment (comma-separated)')
  .action(async (name, options) => {
    const exercise = await createCustomExercise({
      title: name,
      description: options.description,
      primaryMuscles: options.muscles.split(',').map((m: string) => m.trim()),
      equipment: options.equipment ? options.equipment.split(',').map((e: string) => e.trim()) : [],
    });

    console.log(`✓ Created custom exercise: ${exercise.title}`);
    console.log(`  UUID: ${exercise.uuid}`);
  });

// ===== WORKOUTS =====

program
  .command('start-workout')
  .description('Start a new workout')
  .option('-r, --routine <uuid>', 'Start from a routine template')
  .action(async (options) => {
    const current = await getCurrentWorkout();
    if (current) {
      console.log('❌ A workout is already in progress');
      console.log(`   UUID: ${current.uuid}`);
      console.log(`   Started: ${new Date(current.start_time).toLocaleString()}`);
      return;
    }

    const workout = await startWorkout(options.routine);
    console.log(`✓ Started workout`);
    console.log(`  UUID: ${workout.uuid}`);
    console.log(`  Time: ${new Date(workout.start_time).toLocaleString()}`);
    console.log('\nAdd exercises with: iron add-exercise <exercise-uuid>');
  });

program
  .command('current-workout')
  .description('Show current workout details')
  .action(async () => {
    const workout = await getCurrentWorkout();
    if (!workout) {
      console.log('No workout in progress');
      console.log('Start one with: iron start-workout');
      return;
    }

    console.log(`\nCurrent Workout`);
    console.log(`UUID: ${workout.uuid}`);
    console.log(`Started: ${new Date(workout.start_time).toLocaleString()}\n`);

    const exercises = await listWorkoutExercises(workout.uuid);
    if (exercises.length === 0) {
      console.log('No exercises added yet');
      return;
    }

    for (const [i, we] of exercises.entries()) {
      const exercise = await getExercise(we.exercise_uuid);
      const sets = await listWorkoutSets(we.uuid);
      const completedSets = sets.filter((s) => s.is_completed).length;

      console.log(`${i + 1}. ${exercise?.title}`);
      console.log(`   Exercise UUID: ${we.uuid}`);
      console.log(`   Sets: ${completedSets}/${sets.length} completed`);

      sets.forEach((set, j) => {
        const status = set.is_completed ? '✓' : '○';
        const weight = set.weight ? `${set.weight}kg` : '-';
        const reps = set.repetitions ? `${set.repetitions} reps` : '-';
        console.log(`   ${status} Set ${j + 1}: ${weight} × ${reps}`);
      });
      console.log('');
    }
  });

program
  .command('add-exercise <exercise-uuid>')
  .description('Add exercise to current workout')
  .action(async (exerciseUuid) => {
    const workout = await getCurrentWorkout();
    if (!workout) {
      console.log('❌ No workout in progress');
      console.log('Start one with: iron start-workout');
      return;
    }

    const exercise = await getExercise(exerciseUuid);
    if (!exercise) {
      console.log('❌ Exercise not found');
      return;
    }

    const we = await addExerciseToWorkout(workout.uuid, exerciseUuid);
    const sets = await listWorkoutSets(we.uuid);

    console.log(`✓ Added ${exercise.title} to workout`);
    console.log(`  Exercise UUID: ${we.uuid}`);
    console.log(`  ${sets.length} empty sets created`);
  });

program
  .command('log-set <exercise-uuid> <weight> <reps>')
  .description('Log a set (weight in kg)')
  .option('-r, --rpe <value>', 'Rate of perceived exertion (7.0-10.0)')
  .option('-t, --tag <tag>', 'Tag (dropSet or failure)')
  .action(async (exerciseUuid, weight, reps, options) => {
    const workout = await getCurrentWorkout();
    if (!workout) {
      console.log('❌ No workout in progress');
      return;
    }

    const exercises = await listWorkoutExercises(workout.uuid);
    const we = exercises.find((e) => e.uuid === exerciseUuid);
    if (!we) {
      console.log('❌ Exercise not found in current workout');
      return;
    }

    const set = await logSet({
      workoutExerciseUuid: exerciseUuid,
      weight: parseFloat(weight),
      repetitions: parseInt(reps),
      rpe: options.rpe ? parseFloat(options.rpe) : undefined,
      tag: options.tag,
    });

    const exercise = await getExercise(we.exercise_uuid);
    console.log(`✓ Logged set for ${exercise?.title}`);
    console.log(`  ${weight}kg × ${reps} reps`);
    if (options.rpe) console.log(`  RPE: ${options.rpe}`);
  });

program
  .command('finish-workout')
  .description('Finish current workout')
  .action(async () => {
    const workout = await getCurrentWorkout();
    if (!workout) {
      console.log('❌ No workout in progress');
      return;
    }

    const finished = await finishWorkout(workout.uuid);
    const duration = new Date(finished.end_time!).getTime() - new Date(finished.start_time).getTime();
    const minutes = Math.round(duration / 60000);

    console.log(`✓ Workout finished!`);
    console.log(`  Duration: ${minutes} minutes`);
    console.log(`  UUID: ${finished.uuid}`);
  });

program
  .command('cancel-workout')
  .description('Cancel current workout')
  .action(async () => {
    const workout = await getCurrentWorkout();
    if (!workout) {
      console.log('❌ No workout in progress');
      return;
    }

    await cancelWorkout(workout.uuid);
    console.log('✓ Workout cancelled');
  });

// ===== HISTORY =====

program
  .command('list-workouts')
  .description('List workout history')
  .option('-l, --limit <n>', 'Limit results', '10')
  .option('-o, --offset <n>', 'Offset results', '0')
  .action(async (options) => {
    const workouts = await listWorkouts({
      limit: parseInt(options.limit),
      offset: parseInt(options.offset),
    });

    if (workouts.length === 0) {
      console.log('No workouts found');
      return;
    }

    console.log(`Found ${workouts.length} workouts:\n`);
    workouts.forEach((w) => {
      const date = new Date(w.start_time).toLocaleDateString();
      const duration = w.end_time
        ? Math.round((new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 60000)
        : 0;

      console.log(`${date} - ${w.title || 'Workout'}`);
      console.log(`  UUID: ${w.uuid}`);
      console.log(`  Duration: ${duration} minutes`);
      console.log('');
    });
  });

program
  .command('show-workout <uuid>')
  .description('Show workout details')
  .action(async (uuid) => {
    const workout = await getWorkout(uuid);
    if (!workout) {
      console.log('❌ Workout not found');
      return;
    }

    console.log(`\n${workout.title || 'Workout'}`);
    console.log(`Date: ${new Date(workout.start_time).toLocaleString()}`);
    if (workout.end_time) {
      const duration = Math.round((new Date(workout.end_time).getTime() - new Date(workout.start_time).getTime()) / 60000);
      console.log(`Duration: ${duration} minutes`);
    }
    console.log('');

    const exercises = await listWorkoutExercises(uuid);
    for (const [i, we] of exercises.entries()) {
      const exercise = await getExercise(we.exercise_uuid);
      const sets = await listWorkoutSets(we.uuid);
      const completedSets = sets.filter((s) => s.is_completed);

      console.log(`${i + 1}. ${exercise?.title}`);
      completedSets.forEach((set, j) => {
        const weight = set.weight ? `${set.weight}kg` : '-';
        const reps = set.repetitions ? `${set.repetitions} reps` : '-';
        const rpe = set.rpe ? ` @ RPE ${set.rpe}` : '';
        console.log(`   Set ${j + 1}: ${weight} × ${reps}${rpe}`);
      });
      console.log('');
    }
  });

program.parse();
