/**
 * Auto-sync the web app's SQLite DB after a scheduled pipeline run.
 *
 * DIRECT LOCAL INVOCATION (preferred over HTTP)
 * ────────────────────────────────────────────
 * This module spawns `npm run db:sync` in ./web via execSync rather than
 * POSTing to http://localhost:3000/api/sync. Reasons:
 *
 *   1. No Next.js dev server is required — cron fires at 09:00 / 16:05 ET
 *      regardless of whether the app is currently running.
 *   2. The same tsx script the developer uses manually is invoked
 *      end-to-end — zero behavioral drift between manual and scheduled sync.
 *   3. Failures stay local: subprocess exit code + stderr are captured and
 *      logged without affecting the rest of the pipeline.
 *
 * If `web/node_modules` is missing (i.e. `cd web && npm install` has never
 * been run), this module returns a `{ success: false, skipped: true }`
 * result and writes a clear log line — it never crashes the scheduler.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir     = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..', '..');            // src/scheduler → repo root
const WEB_DIR   = join(REPO_ROOT, 'web');
const NODE_MODULES = join(WEB_DIR, 'node_modules');

/**
 * @param {object} [opts]
 * @param {number} [opts.timeout=30000]  ms before aborting the sync process
 * @returns {{ success: boolean, counts?: object, error?: string, skipped?: boolean, reason?: string }}
 */
export function syncAppDatabase({ timeout = 30000 } = {}) {
  if (!existsSync(WEB_DIR)) {
    return { success: false, skipped: true, reason: 'web directory missing' };
  }
  if (!existsSync(NODE_MODULES)) {
    return {
      success: false,
      skipped: true,
      reason: 'web app not installed — run `cd web && npm install` once',
    };
  }

  try {
    const out = execSync('npm run db:sync', {
      cwd:      WEB_DIR,
      timeout,
      encoding: 'utf8',
      stdio:    ['ignore', 'pipe', 'pipe'],
    });
    // The sync script prints a JSON counts block after "✓ Sync complete".
    const match = out.match(/\{[\s\S]*\}/);
    let counts  = null;
    if (match) { try { counts = JSON.parse(match[0]); } catch { /* ignore */ } }
    return { success: true, counts };
  } catch (err) {
    // execSync bundles stderr into err.stderr; surface a concise message.
    const msg = err?.stderr?.toString?.().trim() || err?.message || String(err);
    return { success: false, error: msg.slice(0, 500) };
  }
}
