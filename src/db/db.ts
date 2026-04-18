import { neon } from '@neondatabase/serverless';

let cachedSql: ReturnType<typeof neon> | null = null;

function getSql() {
  if (!cachedSql) {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('Missing database connection string. Set POSTGRES_URL or DATABASE_URL environment variable.');
    }
    cachedSql = neon(connectionString);
  }
  return cachedSql;
}

export async function query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  const sql = getSql();
  const result = await sql(text, params as never[]);
  return result as T[];
}

export async function queryOne<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Run a batch of (text, params) queries inside a single Postgres transaction
 * over the Neon HTTP driver. Either every statement commits or none do.
 */
export async function transaction(
  statements: Array<{ text: string; params?: unknown[] }>
): Promise<void> {
  if (statements.length === 0) return;
  const sql = getSql() as unknown as {
    (text: string, params?: unknown[]): unknown;
    transaction: (queries: unknown[]) => Promise<unknown>;
  };
  const queries = statements.map(({ text, params }) => sql(text, params ?? []));
  await sql.transaction(queries);
}

// No-op kept for compatibility with migrate.ts
export async function closePool(): Promise<void> {}
