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
import { syncAppDatabase } from './app-sync.js';

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

  const result = await generatePremarketReport({ date });

  // generatePremarketReport returns { success, path, report, error? }
  const r      = result?.report ?? {};
  const status = r.status ?? 'unknown';
  const bias   = r.bias ?? r.indicator_snapshot?.bias_label ?? 'unknown';
  const path   = result?.path ?? '(not saved)';
  log(`[premarket] ✓ Complete — status: ${status}, bias: ${bias}, saved: ${path}`);

  // Narrative diagnostic
  const narrLen     = (r.narrative_report || '').length;
  const narrProv    = r.narrative_metadata?.provider ?? 'none';
  const narrSects   = r.narrative_metadata?.sections?.length ?? 0;
  log(`[premarket] Narrative — provider: ${narrProv}, chars: ${narrLen}, sections: ${narrSects}`);

  // Stage 6A enhancement: auto-sync the web app DB so the dashboard updates
  // without requiring `npm run db:sync` or a running app server.
  if (result?.success) {
    const sync = syncAppDatabase();
    if (sync.success) {
      const c = sync.counts ?? {};
      log(`[premarket] App sync ✓ — premarket=${c.premarket ?? '?'} postclose=${c.postclose ?? '?'} snapshots=${c.snapshots ?? '?'} models=${c.models ?? '?'} shadow=${c.shadow ?? '?'}`);
    } else if (sync.skipped) {
      log(`[premarket] App sync skipped — ${sync.reason}`);
    } else {
      log(`[premarket] App sync ✗ FAILED (non-fatal) — ${sync.error}`);
    }
  }

  process.exit(result?.success ? 0 : 1);

} catch (err) {
  log(`[premarket] ✗ FAILED: ${err.message}`);
  process.exit(1);
}
