/**
 * Seeds the 4 Rebirth training routine templates.
 * Safe to run multiple times — skips if plan already exists.
 *
 * Usage:  npx tsx src/db/seed-routines.ts
 *    or:  npm run db:seed-routines
 */
import { query, queryOne, closePool } from './db.js';
import { randomUUID } from 'crypto';

const PLAN_TITLE = 'Rebirth Training';

interface RoutineSet {
  min: number;
  max: number;
}

interface RoutineExercise {
  search: string;
  sets: RoutineSet[];
}

interface RoutineDef {
  title: string;
  exercises: RoutineExercise[];
}

const ROUTINES: RoutineDef[] = [
  {
    title: 'Delt emphasis + racerback pop',
    exercises: [
      { search: 'overhead press',     sets: [{ min: 8, max: 12 }, { min: 8, max: 12 }, { min: 8, max: 12 }] },
      { search: 'lateral raise',      sets: [{ min: 12, max: 15 }, { min: 12, max: 15 }, { min: 12, max: 15 }, { min: 12, max: 15 }] },
      { search: 'front raise',        sets: [{ min: 12, max: 15 }, { min: 12, max: 15 }, { min: 12, max: 15 }] },
      { search: 'rear lateral raise', sets: [{ min: 12, max: 15 }, { min: 12, max: 15 }, { min: 12, max: 15 }] },
      { search: 'face pull',          sets: [{ min: 15, max: 20 }, { min: 15, max: 20 }, { min: 15, max: 20 }] },
      { search: 'upright row',        sets: [{ min: 10, max: 12 }, { min: 10, max: 12 }, { min: 10, max: 12 }] },
    ],
  },
  {
    title: 'Back + delts + arms',
    exercises: [
      { search: 'lat pulldown',        sets: [{ min: 8, max: 12 }, { min: 8, max: 12 }, { min: 8, max: 12 }, { min: 8, max: 12 }] },
      { search: 'seated cable row',    sets: [{ min: 8, max: 12 }, { min: 8, max: 12 }, { min: 8, max: 12 }] },
      { search: 'bent over barbell row', sets: [{ min: 8, max: 10 }, { min: 8, max: 10 }, { min: 8, max: 10 }] },
      { search: 'lateral raise',       sets: [{ min: 12, max: 15 }, { min: 12, max: 15 }, { min: 12, max: 15 }] },
      { search: 'barbell curl',        sets: [{ min: 10, max: 12 }, { min: 10, max: 12 }, { min: 10, max: 12 }] },
      { search: 'tricep pushdown',     sets: [{ min: 12, max: 15 }, { min: 12, max: 15 }, { min: 12, max: 15 }] },
    ],
  },
  {
    title: 'Quads + glute shape',
    exercises: [
      { search: 'back squat',          sets: [{ min: 6, max: 10 }, { min: 6, max: 10 }, { min: 6, max: 10 }, { min: 6, max: 10 }] },
      { search: 'leg press',           sets: [{ min: 10, max: 15 }, { min: 10, max: 15 }, { min: 10, max: 15 }] },
      { search: 'lunge',               sets: [{ min: 10, max: 12 }, { min: 10, max: 12 }, { min: 10, max: 12 }] },
      { search: 'leg extension',       sets: [{ min: 12, max: 15 }, { min: 12, max: 15 }, { min: 12, max: 15 }] },
      { search: 'hip thrust',          sets: [{ min: 10, max: 15 }, { min: 10, max: 15 }, { min: 10, max: 15 }] },
      { search: 'bulgarian split squat', sets: [{ min: 8, max: 12 }, { min: 8, max: 12 }, { min: 8, max: 12 }] },
    ],
  },
  {
    title: 'Glutes/Hams bias (and waist)',
    exercises: [
      { search: 'romanian deadlift',   sets: [{ min: 8, max: 12 }, { min: 8, max: 12 }, { min: 8, max: 12 }, { min: 8, max: 12 }] },
      { search: 'hip thrust',          sets: [{ min: 10, max: 15 }, { min: 10, max: 15 }, { min: 10, max: 15 }] },
      { search: 'leg curl',            sets: [{ min: 10, max: 15 }, { min: 10, max: 15 }, { min: 10, max: 15 }] },
      { search: 'deadlift',            sets: [{ min: 5, max: 8 }, { min: 5, max: 8 }, { min: 5, max: 8 }] },
      { search: 'hyperextension',      sets: [{ min: 12, max: 15 }, { min: 12, max: 15 }, { min: 12, max: 15 }] },
      { search: 'cable crunch',        sets: [{ min: 15, max: 20 }, { min: 15, max: 20 }, { min: 15, max: 20 }] },
    ],
  },
];

async function findExerciseUuid(search: string): Promise<string | null> {
  const row = await queryOne<{ uuid: string }>(
    'SELECT uuid FROM exercises WHERE title ILIKE $1 AND is_hidden = false ORDER BY is_custom ASC LIMIT 1',
    [`%${search}%`]
  );
  return row?.uuid ?? null;
}

export async function seedRoutines(): Promise<void> {
  console.log('Seeding Rebirth routine templates...');

  const existing = await queryOne<{ uuid: string }>(
    'SELECT uuid FROM workout_plans WHERE title = $1',
    [PLAN_TITLE]
  );

  if (existing) {
    console.log(`Plan "${PLAN_TITLE}" already exists (${existing.uuid}) — skipping.`);
    return;
  }

  const planUuid = randomUUID();
  await query('INSERT INTO workout_plans (uuid, title) VALUES ($1, $2)', [planUuid, PLAN_TITLE]);
  console.log(`✓ Created plan "${PLAN_TITLE}" (${planUuid})`);

  for (let ri = 0; ri < ROUTINES.length; ri++) {
    const r = ROUTINES[ri];
    const routineUuid = randomUUID();
    await query(
      'INSERT INTO workout_routines (uuid, workout_plan_uuid, title, order_index) VALUES ($1, $2, $3, $4)',
      [routineUuid, planUuid, r.title, ri]
    );
    console.log(`  ✓ Routine [${ri + 1}]: ${r.title}`);

    let orderIndex = 0;
    for (const ex of r.exercises) {
      const exerciseUuid = await findExerciseUuid(ex.search);
      if (!exerciseUuid) {
        console.log(`    ⚠ Exercise not found: "${ex.search}" — skipping`);
        continue;
      }

      const wreUuid = randomUUID();
      await query(
        'INSERT INTO workout_routine_exercises (uuid, workout_routine_uuid, exercise_uuid, order_index) VALUES ($1, $2, $3, $4)',
        [wreUuid, routineUuid, exerciseUuid, orderIndex++]
      );

      for (let si = 0; si < ex.sets.length; si++) {
        const s = ex.sets[si];
        await query(
          'INSERT INTO workout_routine_sets (uuid, workout_routine_exercise_uuid, min_repetitions, max_repetitions, order_index) VALUES ($1, $2, $3, $4, $5)',
          [randomUUID(), wreUuid, s.min, s.max, si]
        );
      }
    }
  }

  console.log('✓ Routine seeding complete');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedRoutines()
    .then(() => closePool())
    .catch(err => {
      console.error('Seed routines failed:', err);
      process.exit(1);
    });
}
