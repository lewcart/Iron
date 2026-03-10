import { getDb, closeDb } from './db.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ExerciseData {
  id: number;
  title: string;
  alias: string[];
  primer: string;
  primary: string[];
  secondary: string[];
  equipment: string[];
  steps: string[];
  tips: string[];
}

function seed() {
  console.log('Seeding exercise database...');

  const db = getDb();
  const exercises: ExerciseData[] = JSON.parse(
    readFileSync(join(__dirname, 'exercises.json'), 'utf-8')
  );

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO exercises (
      uuid, everkinetic_id, title, alias, description,
      primary_muscles, secondary_muscles, equipment, steps, tips, is_custom
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);

  let count = 0;
  for (const ex of exercises) {
    stmt.run(
      randomUUID(),
      ex.id,
      ex.title,
      JSON.stringify(ex.alias || []),
      ex.primer || null,
      JSON.stringify(ex.primary || []),
      JSON.stringify(ex.secondary || []),
      JSON.stringify(ex.equipment || []),
      JSON.stringify(ex.steps || []),
      JSON.stringify(ex.tips || [])
    );
    count++;
  }

  console.log(`✓ Seeded ${count} exercises`);
  closeDb();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seed();
}

export { seed };
