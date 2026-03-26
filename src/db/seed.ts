import './load-env.js';
import { query, queryOne, closePool } from './db.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Default catalog from the Iron iOS app (GPL-3.0):
 * https://github.com/karimknaebel/Iron/blob/main/WorkoutDataKit/everkinetic-data/exercises.json
 *
 * Each entry includes stable `uuid` values that match Iron / Health exports so imports resolve by id.
 */
interface ExerciseData {
  uuid: string;
  id: number;
  title: string;
  alias?: string[];
  primer?: string;
  primary?: string[];
  secondary?: string[];
  equipment?: string[];
  steps?: string[];
  tips?: string[];
}

async function seed() {
  console.log('Seeding exercise database...');

  const exercises: ExerciseData[] = JSON.parse(
    readFileSync(join(__dirname, 'exercises.json'), 'utf-8')
  );

  let count = 0;
  for (const ex of exercises) {
    await query(`
      INSERT INTO exercises (
        uuid, everkinetic_id, title, alias, description,
        primary_muscles, secondary_muscles, equipment, steps, tips, is_custom
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false)
      ON CONFLICT (uuid) DO UPDATE SET
        everkinetic_id = EXCLUDED.everkinetic_id,
        title = EXCLUDED.title,
        alias = EXCLUDED.alias,
        description = EXCLUDED.description,
        primary_muscles = EXCLUDED.primary_muscles,
        secondary_muscles = EXCLUDED.secondary_muscles,
        equipment = EXCLUDED.equipment,
        steps = EXCLUDED.steps,
        tips = EXCLUDED.tips
      WHERE exercises.is_custom = false
    `, [
      ex.uuid,
      ex.id,
      ex.title,
      JSON.stringify(ex.alias ?? []),
      ex.primer ?? null,
      JSON.stringify(ex.primary ?? []),
      JSON.stringify(ex.secondary ?? []),
      JSON.stringify(ex.equipment ?? []),
      JSON.stringify(ex.steps ?? []),
      JSON.stringify(ex.tips ?? []),
    ]);
    count++;
  }

  const customRow = await queryOne<{ n: string }>(
    'SELECT COUNT(*)::text AS n FROM exercises WHERE is_custom = true'
  );

  console.log(`✓ Upserted ${count} built-in exercises (Iron catalog)`);
  console.log(`✓ Custom exercises unchanged: ${customRow?.n ?? '0'} in database (seed never deletes rows)`);
  await closePool();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seed().catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });
}

export { seed };
