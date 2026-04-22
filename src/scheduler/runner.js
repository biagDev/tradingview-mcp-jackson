/**
 * Shared scheduler runtime utilities.
 *
 * Provides:
 *   log(msg)        — append a timestamped line to the scheduler log
 *   ensureTVLive()  — health-check TradingView; auto-launch + retry if down
 *
 * Log file: ~/.tradingview-mcp/logs/scheduler.log
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as health from '../core/health.js';

// ─── Log ─────────────────────────────────────────────────────────────────────

const LOGS_DIR = join(homedir(), '.tradingview-mcp', 'logs');
const LOG_FILE = join(LOGS_DIR, 'scheduler.log');

/** Append a timestamped message to the scheduler log and echo to stderr. */
export function log(msg) {
  const ts = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const line = `[${ts} ET] ${msg}\n`;
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line);
  } catch { /* best-effort */ }
  process.stderr.write(line);
}

// ─── TV Health / Auto-Launch ──────────────────────────────────────────────────

const LAUNCH_WAIT_MS  = 8_000; // ms to wait after launching before first retry
const RETRY_WAIT_MS   = 3_000;
const MAX_ATTEMPTS    = 4;     // 1 launch + 3 retries

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Ensure TradingView is running with CDP enabled.
 *
 * Strategy:
 *   1. Try health check.
 *   2. On first failure: call health.launch() with kill_existing=false,
 *      then wait LAUNCH_WAIT_MS before retrying.
 *   3. Retry up to MAX_ATTEMPTS total.
 *   4. Throw if still unreachable.
 *
 * @returns {Promise<object>} healthCheck result on success
 */
export async function ensureTVLive() {
  let launched = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await health.healthCheck();
      if (attempt > 1) log(`TV connected on attempt ${attempt}`);
      return result;
    } catch (err) {
      log(`TV health check failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${err.message}`);

      if (!launched) {
        log('Attempting to launch TradingView with CDP...');
        try {
          await health.launch({ kill_existing: false });
          log(`TradingView launched — waiting ${LAUNCH_WAIT_MS / 1000}s for CDP...`);
        } catch (launchErr) {
          log(`Launch failed: ${launchErr.message}`);
        }
        launched = true;
        await sleep(LAUNCH_WAIT_MS);
      } else {
        await sleep(RETRY_WAIT_MS);
      }
    }
  }

  throw new Error(`TradingView unreachable after ${MAX_ATTEMPTS} attempts. Is the app installed?`);
}
