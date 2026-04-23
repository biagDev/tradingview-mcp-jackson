/**
 * Auto-sync the app's SQLite DB after a scheduled pipeline run.
 *
 * CRON-SAFE IMPLEMENTATION — IN-PROCESS, NO SUBPROCESS
 * ────────────────────────────────────────────────────
 * The previous implementation shelled out to `npm run db:sync`, which
 * failed under macOS cron with "/bin/sh: npm: command not found" because
 * cron's minimal PATH doesn't include `/opt/homebrew/bin`.
 *
 * This version imports src/core/app-db-sync.js and calls it directly
 * inside the scheduler's Node process:
 *
 *   - No shell, no PATH dependency, no environment-variable surprises
 *   - No tsx subprocess (the canonical sync is now pure JS)
 *   - Fastest possible execution path (a single in-process function call)
 *   - `npm run db:sync` (via web/lib/sync.ts) remains available for
 *     manual use; both write the same DB via ON CONFLICT upserts.
 *
 * Returns `{ success, counts?, error?, skipped?, reason?, method, duration_ms }`.
 * Never throws — callers log the result and continue.
 */

import { syncAllArtifacts, closeAppDb } from '../core/app-db-sync.js';

const METHOD = 'in-process';

/**
 * @param {object} [opts]
 * @param {boolean} [opts.closeOnDone=true]  Close the DB handle after sync so
 *   WAL is flushed and the app dev server sees the writes immediately.
 */
export function syncAppDatabase({ closeOnDone = true } = {}) {
  const t0 = Date.now();
  try {
    const result = syncAllArtifacts();
    if (closeOnDone) { try { closeAppDb(); } catch { /* ignore */ } }
    return { ...result, method: METHOD, duration_ms: Date.now() - t0 };
  } catch (err) {
    return {
      success: false,
      method:  METHOD,
      error:   err?.message ?? String(err),
      duration_ms: Date.now() - t0,
    };
  }
}
