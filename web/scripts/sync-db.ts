/**
 * Full idempotent sync from ~/.tradingview-mcp artifacts into the local DB.
 * Re-runnable: latest artifact wins for per-date rows; shadow history
 * is appended (UNIQUE constraint prevents duplicates).
 */
import { initDb } from '../db/init';
import { syncAllArtifacts } from '../lib/sync';

initDb();  // ensure tables exist
const result = syncAllArtifacts();

if (result.success) {
  console.log('✓ Sync complete');
} else {
  console.error('✗ Sync failed:', result.error);
}
console.log(JSON.stringify(result.counts, null, 2));
process.exit(result.success ? 0 : 1);
