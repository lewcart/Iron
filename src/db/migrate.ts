import { getDb, closeDb } from './db.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function migrate() {
  console.log('Running database migrations...');

  const db = getDb();
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');

  // Execute the schema
  db.exec(schema);

  console.log('✓ Database migrations completed');
  closeDb();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
}

export { migrate };
