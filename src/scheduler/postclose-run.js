#!/usr/bin/env node
/**
 * Post-close scheduler entry point — run by cron at 16:05 ET Mon–Fri.
 *
 * Steps:
 *   1. Skip if today is not a trading day (weekend / NYSE holiday).
 *   2. Ensure TradingView is live; auto-launch if needed.
 *   3. Generate and auto-save the post-close report.
 *   4. Log the outcome.
 *
 * Exit codes: 0 = success or skipped, 1 = error
 */

import { todayET, isTradingDay } from './calendar.js';
import { ensureTVLive, log } from './runner.js';
import { generatePostCloseReport } from '../core/reports.js';
import { gradeTradingDate } from '../core/grading.js';

const date = todayET();

// ── Step 1: trading day check ─────────────────────────────────────────────────
if (!isTradingDay(date)) {
  process.exit(0); // silent exit — not a trading day
}

log(`[postclose] ── Starting post-close report for ${date} ──`);

// ── Step 2–3: connect + generate ─────────────────────────────────────────────
try {
  await ensureTVLive();
  log('[postclose] TV connected — generating report...');

  const result = await generatePostCloseReport({ date });

  // generatePostCloseReport returns { success, path, report, error? }
  const r       = result?.report ?? {};
  const status  = r.status ?? 'unknown';
  const dayType = r.actual_day_type ?? 'unknown';
  const range   = r.actual_session?.range_points ?? 'n/a';
  const path    = result?.path ?? '(not saved)';
  log(`[postclose] ✓ Complete — status: ${status}, day_type: ${dayType}, range: ${range}pts, saved: ${path}`);

  // Stage 2: auto-grade the day once the postclose is saved.
  if (result?.success) {
    try {
      const g = await gradeTradingDate({ date, overwrite: true });
      if (g.success) {
        log(`[postclose] Graded — ${g.grading.overall_grade} (${g.grading.score_0_to_100}/100), bias=${g.grading.bias_correct === true ? 'HIT' : g.grading.bias_correct === false ? 'MISS' : 'N/A'}, tags=[${g.grading.failure_tags.join(', ') || 'none'}]`);
      } else {
        log(`[postclose] Grading skipped: ${g.reason ?? g.error ?? 'unknown'}`);
      }
    } catch (gradeErr) {
      log(`[postclose] Grading error (non-fatal): ${gradeErr.message}`);
    }
  }

  process.exit(result?.success ? 0 : 1);

} catch (err) {
  log(`[postclose] ✗ FAILED: ${err.message}`);
  process.exit(1);
}
