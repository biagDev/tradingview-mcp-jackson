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
import { rebuildAnalytics } from '../core/analytics.js';
import { rebuildDataset } from '../core/dataset.js';
import { trainAllModels, predictLatestShadow } from '../core/modeling.js';
import { syncAppDatabase } from './app-sync.js';

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

    // Stage 3: rebuild analytics snapshot (cheap, fully regenerable)
    try {
      const a = rebuildAnalytics();
      log(`[postclose] Analytics rebuilt — ${a.total_records} records, written to ${a.analytics_dir}`);
    } catch (anErr) {
      log(`[postclose] Analytics rebuild error (non-fatal): ${anErr.message}`);
    }

    // Stage 4: rebuild dataset / feature store (cheap, fully regenerable)
    try {
      const d = rebuildDataset();
      log(`[postclose] Dataset rebuilt — canonical=${d.counts.canonical_rows}, training_ready=${d.counts.training_ready_rows}, splits=${d.counts.train_rows}/${d.counts.validation_rows}/${d.counts.test_rows}`);
    } catch (dsErr) {
      log(`[postclose] Dataset rebuild error (non-fatal): ${dsErr.message}`);
    }

    // Stage 5: shadow-mode retrain + predict (rules engine still production)
    try {
      const t = trainAllModels();
      const tasks = Object.entries(t.summary?.per_task ?? {}).map(([k, v]) => `${k}=${v.status}`).join(' ');
      log(`[postclose] Models trained — ${tasks}`);
    } catch (mErr) {
      log(`[postclose] Model training error (non-fatal): ${mErr.message}`);
    }
    try {
      const p = predictLatestShadow();
      const shadowTasks = Object.keys(p.predictions ?? {}).length;
      log(`[postclose] Shadow predictions written for ${shadowTasks} tasks (shadow mode only)`);
    } catch (spErr) {
      log(`[postclose] Shadow predict error (non-fatal): ${spErr.message}`);
    }

    // Stage 6A enhancement: auto-sync the web app DB after the full pipeline
    // so the dashboard reflects today's post-close + grading without manual
    // `npm run db:sync`.
    const sync = syncAppDatabase();
    if (sync.success) {
      const c = sync.counts ?? {};
      log(`[postclose] App sync ✓ — premarket=${c.premarket ?? '?'} postclose=${c.postclose ?? '?'} snapshots=${c.snapshots ?? '?'} models=${c.models ?? '?'} shadow=${c.shadow ?? '?'}`);
    } else if (sync.skipped) {
      log(`[postclose] App sync skipped — ${sync.reason}`);
    } else {
      log(`[postclose] App sync ✗ FAILED (non-fatal) — ${sync.error}`);
    }
  }

  process.exit(result?.success ? 0 : 1);

} catch (err) {
  log(`[postclose] ✗ FAILED: ${err.message}`);
  process.exit(1);
}
