import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync } from 'fs';

const DB_PATH = process.env.IRON_DB_PATH || join(process.cwd(), 'iron.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function dbExists(): boolean {
  return existsSync(DB_PATH);
}

export { DB_PATH };
