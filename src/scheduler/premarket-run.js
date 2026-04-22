#!/usr/bin/env node
/**
 * Premarket scheduler entry point — run by cron at 09:00 ET Mon–Fri.
 *
 * Steps:
 *   1. Skip if today is not a trading day (weekend / NYSE holiday).
 *   2. Ensure TradingView is live; auto-launch if needed.
 *   3. Generate and auto-save the premarket report.
 *   4. Log the outcome.
 *
 * Exit codes: 0 = success or skipped, 1 = error
 */

import { todayET, isTradingDay } from './calendar.js';
import { ensureTVLive, log } from './runner.js';
import { generatePremarketReport } from '../core/reports.js';

const date = todayET();

// ── Step 1: trading day check ─────────────────────────────────────────────────
if (!isTradingDay(date)) {
  process.exit(0); // silent exit — not a trading day
}

log(`[premarket] ── Starting premarket report for ${date} ──`);

// ── Step 2–3: connect + generate ─────────────────────────────────────────────
try {
  await ensureTVLive();
  log('[premarket] TV connected — generating report...');

  const report = await generatePremarketReport({ date });

  const bias   = report?.indicator_snapshot?.bias_label ?? 'unknown';
  const status = report?.status ?? 'unknown';
  log(`[premarket] ✓ Complete — status: ${status}, bias: ${bias}`);
  process.exit(0);

} catch (err) {
  log(`[premarket] ✗ FAILED: ${err.message}`);
  process.exit(1);
}
