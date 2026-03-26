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
const migrationPath = join(__dirname, '../src/db/migrations/005_add_sync_columns.sql');
const migration = readFileSync(migrationPath, 'utf-8');

// Split SQL respecting dollar-quoted strings ($$...$$) and single-quoted strings
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
for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  process.stdout.write(`[${i + 1}/${statements.length}] `);
  await sql(stmt);
  console.log('OK');
}
console.log('Migration 005 complete.');
