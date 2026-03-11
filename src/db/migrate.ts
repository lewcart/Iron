import { query, closePool } from './db.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function migrate() {
  console.log('Running database migrations...');

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');

  // Execute the schema (PostgreSQL can handle multiple statements)
  await query(schema);

  console.log('✓ Database migrations completed');
  await closePool();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

export { migrate };
