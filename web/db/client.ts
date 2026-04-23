/**
 * Singleton better-sqlite3 client.
 * DB path: ~/.tradingview-mcp/app.db (alongside every other pipeline artifact).
 */
import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

export const HOME_DIR = join(homedir(), '.tradingview-mcp');
export const DB_PATH  = join(HOME_DIR, 'app.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  if (!existsSync(HOME_DIR)) mkdirSync(HOME_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

export function closeDb() {
  if (_db) { _db.close(); _db = null; }
}
