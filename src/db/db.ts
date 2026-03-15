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

// No-op kept for compatibility with migrate.ts
export async function closePool(): Promise<void> {}
