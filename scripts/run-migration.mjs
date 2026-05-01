import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env from .env.local
import { config } from 'dotenv';
config({ path: join(__dirname, '../.env.local') });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const sql = neon(url);

// Migration filename can be passed as a CLI arg (e.g. `node scripts/run-migration.mjs 023_canonical_muscles.sql`).
// Defaults to 005 for backwards compat with the original one-shot use.
const migrationFile = process.argv[2] || '005_add_sync_columns.sql';
const migrationPath = join(__dirname, '../src/db/migrations/', migrationFile);
const migration = readFileSync(migrationPath, 'utf-8');

// Split SQL respecting dollar-quoted strings ($$...$$), single-quoted strings,
// and `--` line comments. Apostrophes or semicolons inside top-level comments
// previously broke the quote/terminator scanners — handled here by treating
// the entire `-- to \n` span as a comment unit.
function splitSql(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    // Dollar-quoted string ($$)
    if (sql[i] === '$' && sql[i + 1] === '$') {
      const end = sql.indexOf('$$', i + 2);
      if (end === -1) { current += sql.slice(i); break; }
      current += sql.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    // Line comment (-- to end of line). Skip without copying — line-level
    // comment filter below still strips the resulting blank lines.
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    // Single-quoted string
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j++; break; }
        j++;
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }
    // Statement terminator
    if (sql[i] === ';') {
      const stmt = current
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .trim();
      if (stmt) statements.push(stmt);
      current = '';
      i++;
      continue;
    }
    current += sql[i++];
  }
  // Trailing content without semicolon
  const last = current
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .trim();
  if (last) statements.push(last);
  return statements;
}

const statements = splitSql(migration);

console.log(`Running ${statements.length} statements...`);
if (process.env.DUMP_STATEMENTS) {
  const { writeFileSync: write } = await import('fs');
  for (let i = 0; i < statements.length; i++) {
    write(`/tmp/stmt-${String(i + 1).padStart(2, '0')}.sql`, statements[i]);
  }
  console.log('Wrote /tmp/stmt-NN.sql files. Exiting.');
  process.exit(0);
}
for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  process.stdout.write(`[${i + 1}/${statements.length}] `);
  try {
    await sql(stmt);
    console.log('OK');
  } catch (err) {
    console.log('FAIL');
    console.error('--- statement %d (first 300 chars) ---', i + 1);
    console.error(stmt.slice(0, 300));
    console.error('--- error ---');
    console.error(err.message);
    throw err;
  }
}
console.log(`Migration ${migrationFile} complete.`);
