import './load-env.js';
import { query, transaction, closePool } from './db.js';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, 'migrations');

// Files numbered 001–010 describe schema that already exists on legacy DBs.
// When schema_migrations is empty but `exercises` exists, we seed these as
// applied so the migrator doesn't attempt to re-run on an already-populated DB.
const BASELINE_MIGRATIONS = [
  '001_core_schema.sql',
  '002_rebirth_modules.sql',
  '005_add_sync_columns.sql',
  '006_mcp_support.sql',
  '007_routine_set_targets.sql',
  '008_seed_custom_exercises.sql',
  '009_exercise_movement_pattern.sql',
  '010_inspo_burst_group.sql',
];

/**
 * Splits a SQL string on `;`, while leaving statement terminators inside the
 * following constructs intact:
 *   - dollar-quoted blocks (`$$...$$` or `$tag$...$tag$`) — PL/pgSQL bodies
 *   - single-quoted string literals (`'...'`, with `''` as escaped quote)
 *   - line comments (`-- ... \n`) — semicolons inside prose comments are NOT
 *     statement terminators
 *   - block comments (`/* ... *\/`) — same reasoning, supports nesting
 *
 * Without these guards, an innocuous comment like "uses the same route;"
 * would split a migration mid-statement and cause cryptic Postgres syntax
 * errors. Migrations with rich comments are common and worth supporting.
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Line comment: `-- ... \n` — copy verbatim, terminator inside is harmless.
    if (ch === '-' && next === '-') {
      const newlineIdx = sql.indexOf('\n', i);
      const end = newlineIdx === -1 ? sql.length : newlineIdx + 1;
      current += sql.slice(i, end);
      i = end;
      continue;
    }

    // Block comment: `/* ... */` with nesting support (Postgres allows it).
    if (ch === '/' && next === '*') {
      let depth = 1;
      current += sql.slice(i, i + 2);
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          current += sql.slice(i, i + 2);
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          current += sql.slice(i, i + 2);
          i += 2;
        } else {
          current += sql[i];
          i++;
        }
      }
      continue;
    }

    // Dollar-quoted block: $tag$ ... $tag$
    if (ch === '$') {
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

    // Single-quoted string literal: '...' (escape with '')
    if (ch === "'") {
      current += ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          current += "''";
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          current += "'";
          i++;
          break;
        }
        current += sql[i];
        i++;
      }
      continue;
    }

    if (ch === ';') {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const last = current.trim();
  if (last) statements.push(last);
  return statements;
}

function statementsFor(sql: string): Array<{ text: string; params?: unknown[] }> {
  return splitSqlStatements(sql).map(text => ({ text }));
}

async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function listAppliedMigrations(): Promise<Set<string>> {
  const rows = await query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name ASC');
  return new Set(rows.map(r => r.name));
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [name]
  );
  return Boolean(rows[0]?.exists);
}

/**
 * If schema_migrations is empty but the DB already has the `exercises` table,
 * this DB pre-dates the migration-tracking system. Seed schema_migrations
 * with all baseline files (001–010) so they aren't re-run.
 */
async function seedBaselineIfNeeded(applied: Set<string>): Promise<boolean> {
  if (applied.size > 0) return false;
  if (!(await tableExists('exercises'))) return false;

  console.log('Legacy DB detected (no schema_migrations rows, but tables exist).');
  console.log('Seeding schema_migrations with baseline migrations 001–010…');

  for (const name of BASELINE_MIGRATIONS) {
    await query(
      'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING',
      [name]
    );
    applied.add(name);
  }
  console.log(`  baseline seeded: ${BASELINE_MIGRATIONS.length} migrations`);
  return true;
}

function listMigrationFiles(): string[] {
  try {
    return readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql') && !f.endsWith('.down.sql'))
      .sort();
  } catch {
    return [];
  }
}

async function migrate(): Promise<void> {
  console.log('Running database migrations…');

  await ensureMigrationsTable();
  const applied = await listAppliedMigrations();
  await seedBaselineIfNeeded(applied);

  const files = listMigrationFiles();
  const pending = files.filter(f => !applied.has(f));

  if (pending.length === 0) {
    console.log('✓ No pending migrations — database is up to date.');
    await closePool();
    return;
  }

  for (const file of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    console.log(`→ Applying ${file}…`);
    await transaction([
      ...statementsFor(sql),
      { text: 'INSERT INTO schema_migrations (name) VALUES ($1)', params: [file] },
    ]);
    console.log(`✓ Applied ${file}`);
  }

  console.log(`✓ Database migrations completed (${pending.length} applied).`);
  await closePool();
}

async function rollback(): Promise<void> {
  console.log('Rolling back last applied migration…');

  await ensureMigrationsTable();
  const rows = await query<{ name: string }>(
    'SELECT name FROM schema_migrations ORDER BY applied_at DESC, name DESC LIMIT 1'
  );
  const last = rows[0]?.name;

  if (!last) {
    console.log('Nothing to roll back — schema_migrations is empty.');
    await closePool();
    return;
  }

  const downFile = last.replace(/\.sql$/, '.down.sql');
  const downPath = join(MIGRATIONS_DIR, downFile);

  if (!existsSync(downPath)) {
    console.error(
      `✗ Cannot roll back "${last}": no companion "${downFile}" found in migrations/.\n` +
      `  Rollback is only supported for migrations that ship a matching .down.sql file.\n` +
      `  To hand-roll a revert, create src/db/migrations/${downFile} with the inverse SQL\n` +
      `  and re-run \`npm run db:rollback\`.`
    );
    await closePool();
    process.exit(1);
  }

  const sql = readFileSync(downPath, 'utf-8');
  await transaction([
    ...statementsFor(sql),
    { text: 'DELETE FROM schema_migrations WHERE name = $1', params: [last] },
  ]);
  console.log(`✓ Rolled back ${last}`);

  await closePool();
}

/**
 * Read-only ship-gate: list pending migrations against the configured DB and
 * exit non-zero if any exist. Used by scripts/ship-checks.sh to refuse a deploy
 * when prod is missing a migration that's already in the codebase — the exact
 * failure mode that took down workout-sets sync on 2026-05-04 (column
 * `excluded_from_pb` referenced by deployed code, migration 042 not yet
 * applied to prod).
 */
async function check(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await listAppliedMigrations();
  await seedBaselineIfNeeded(applied);
  const files = listMigrationFiles();
  const pending = files.filter(f => !applied.has(f));

  if (pending.length === 0) {
    console.log('✓ No pending migrations — database is up to date.');
    await closePool();
    return;
  }

  console.error(`✗ ${pending.length} pending migration(s) on the configured database:`);
  for (const f of pending) console.error(`  - ${f}`);
  console.error('  Run `npm run db:migrate` against the target environment before shipping.');
  await closePool();
  process.exit(1);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2] ?? 'up';
  const run =
    cmd === 'rollback' || cmd === 'down' ? rollback :
    cmd === 'check' || cmd === 'pending' ? check :
    migrate;
  run().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

export { migrate, rollback, check };
