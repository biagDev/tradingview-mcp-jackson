/**
 * Create every table declared in db/schema.sql. Idempotent — safe to re-run.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getDb, DB_PATH } from './client';

const __dir = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dir, 'schema.sql');

export function initDb() {
  const db = getDb();
  const sql = readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(sql);
  return { db_path: DB_PATH, schema_path: SCHEMA_PATH };
}
