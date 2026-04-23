/**
 * One-shot DB init. Creates every table declared in db/schema.sql.
 * Safe to run repeatedly.
 */
import { initDb } from '../db/init';

const { db_path, schema_path } = initDb();
console.log(`✓ DB initialized`);
console.log(`  db_path:     ${db_path}`);
console.log(`  schema_path: ${schema_path}`);
