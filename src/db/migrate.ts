import { query, closePool } from './db.js';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Splits a SQL string on `;` while respecting dollar-quoted blocks ($$...$$),
 * so PL/pgSQL function bodies are not broken up.
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;

  while (i < sql.length) {
    if (sql[i] === '$') {
      const tagMatch = sql.slice(i).match(/^\$[^$]*\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        const closeIdx = sql.indexOf(tag, i + tag.length);
        if (closeIdx !== -1) {
          current += sql.slice(i, closeIdx + tag.length);
          i = closeIdx + tag.length;
          continue;
        }
      }
    }

    if (sql[i] === ';') {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = '';
    } else {
      current += sql[i];
    }
    i++;
  }

  const last = current.trim();
  if (last) statements.push(last);
  return statements;
}

async function runSql(sql: string): Promise<void> {
  for (const statement of splitSqlStatements(sql)) {
    await query(statement);
  }
}

async function migrate() {
  console.log('Running database migrations...');

  // Run base schema
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  await runSql(schema);
  console.log('✓ Base schema applied');

  // Run ordered migration files from migrations/
  const migrationsDir = join(__dirname, 'migrations');
  let files: string[] = [];
  try {
    files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
  } catch {
    // migrations directory doesn't exist — skip
  }

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    await runSql(sql);
    console.log(`✓ Migration applied: ${file}`);
  }

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
