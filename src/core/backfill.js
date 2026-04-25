/**
 * Historical backfill / replay harness.
 *
 * Iterates a date range, and for each NYSE trading day:
 *   1. Enters TradingView replay at 09:00 ET → calls generatePremarketReport
 *   2. Stops replay, re-enters at 16:15 ET → calls generatePostCloseReport
 *   3. Calls gradeTradingDate
 *   4. Tags every saved artifact with is_backfill + replay_fidelity caveats
 *   5. On chunk boundary (default every 5 days) and at batch end: rebuilds
 *      analytics, dataset, models, shadow predictions, and app DB sync.
 *
 * Never retrains per-day (expensive). State is persisted so interrupted
 * runs resume cleanly.
 *
 * ────────────────────────────────────────────────────────────────────────
 * NO-LOOKAHEAD SAFEGUARDS (documented + enforced)
 *
 *   1. Premarket replay position = 09:00 ET — DBE indicator computes
 *      using only bars up to that replay moment. This is TradingView's
 *      native replay behavior; we do not bypass it.
 *   2. Premarket JSON is written to disk BEFORE replay is advanced to
 *      post-close, so realized OHLC cannot leak back into features.
 *   3. Post-close JSON is written from a fresh replay session positioned
 *      at 16:15 ET — it reads realized values that are definitionally
 *      future-of-premarket.
 *   4. Stage 4 dataset leakage audit stands unchanged: every label field
 *      is still populated only from the post-close / grading artifacts.
 *   5. `request.security()` calls in the DBE for DXY/10Y/ES/VIX may
 *      return current live quotes under TV replay rather than historical
 *      cross-asset values. Backfilled reports are flagged
 *      replay_fidelity: "degraded_intermarket" so later analytics / ML
 *      can filter or weight them appropriately.
 *   6. Intraday session windows (Asia / London H/L) only populate when
 *      replay walks through those hours. Starting replay at 09:00 ET
 *      can yield null session fields; we flag this as
 *      replay_fidelity: "degraded_session".
 * ────────────────────────────────────────────────────────────────────────
 */

import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, appendFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as replay from './replay.js';
import * as health from './health.js';
import { generatePremarketReport, generatePostCloseReport } from './reports.js';
import { gradeTradingDate }      from './grading.js';
import { rebuildAnalytics }      from './analytics.js';
import { rebuildDataset }        from './dataset.js';
import { trainAllModels, predictLatestShadow } from './modeling.js';
import { syncAllArtifacts }      from './app-db-sync.js';
import { isTradingDay, isEarlyCloseDay } from '../scheduler/calendar.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const HOME_DIR      = join(homedir(), '.tradingview-mcp');
const REPORTS_DIR   = join(HOME_DIR, 'reports');
const BACKFILL_DIR  = join(HOME_DIR, 'backfill');
const BATCHES_DIR   = join(BACKFILL_DIR, 'batches');
const LOGS_DIR      = join(BACKFILL_DIR, 'logs');
const SUMMARIES_DIR = join(BACKFILL_DIR, 'summaries');
const STATE_PATH    = join(BACKFILL_DIR, 'state.json');

// ─── Constants (tunable) ──────────────────────────────────────────────────────

const SCHEMA_VERSION         = 1;
const DEFAULT_CHUNK_SIZE     = 5;       // days per analytics/dataset rebuild

// Replay positions. The "pre-session" entry is earlier than the premarket
// snapshot so the DBE can walk through the Asia + London windows and populate
// session_structure.asia_{high,low} + session_structure.london_{high,low}.
// After entering at 03:00 ET we autoplay forward to 09:00 ET, then snapshot.
const DEFAULT_PRESESSION_TIME = '03:00:00-04:00';  // 03:00 ET — well before Asia close
const DEFAULT_PREMARKET_TIME  = '09:00:00-04:00';  // 09:00 ET snapshot moment
const DEFAULT_POSTCLOSE_TIME  = '16:15:00-04:00';  // 16:15 ET
const REPLAY_SETTLE_MS        = 2500;
const STEP_BETWEEN_REPORTS_MS = 1000;

// Autoplay forward from pre-session to premarket. 10x delay (100ms per bar on
// 15-min chart) takes roughly 15s to walk 6h of bars — worth the session fidelity.
const AUTOPLAY_DELAY_MS       = 100;
const AUTOPLAY_DURATION_MS    = 15000;

// ─── Utilities ────────────────────────────────────────────────────────────────

function nowISO() { return new Date().toISOString(); }
function nowET()  {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function ensureDirs() {
  mkdirSync(BATCHES_DIR,   { recursive: true });
  mkdirSync(LOGS_DIR,      { recursive: true });
  mkdirSync(SUMMARIES_DIR, { recursive: true });
}

function readJsonSafe(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

function writeJson(path, obj) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function nextDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function enumerateDates(from, to) {
  const out = [];
  let d = from;
  while (d <= to) { out.push(d); d = nextDate(d); }
  return out;
}

function genBatchId() {
  return `batch_${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
}

// ─── State helpers ────────────────────────────────────────────────────────────

function loadState() {
  return readJsonSafe(STATE_PATH, { schema_version: SCHEMA_VERSION, current_batch: null, last_batch: null, history: [] });
}

function saveState(state) { writeJson(STATE_PATH, state); }

function loadBatch(batchId) {
  return readJsonSafe(join(BATCHES_DIR, `${batchId}.json`));
}

function saveBatch(batch) {
  writeJson(join(BATCHES_DIR, `${batch.batch_id}.json`), batch);
}

function appendBatchLog(batchId, line) {
  mkdirSync(LOGS_DIR, { recursive: true });
  const path = join(LOGS_DIR, `${batchId}.log`);
  appendFileSync(path, `[${nowET()} ET] ${line}\n`);
}

// ─── Replay fidelity assessment ───────────────────────────────────────────────

/**
 * Inspect a just-generated report and emit fidelity caveats so the
 * backfilled row can be filtered or weighted later.
 *
 * Fidelity levels (worst wins when multiple apply):
 *   full                — all data fields populated and trustworthy
 *   degraded_session    — Asia/London session structure is null (replay
 *                         did not walk through those hours)
 *   degraded_intermarket — intermarket fields are ABSENT (null), meaning
 *                         the DBE could not query them under replay
 *   mixed               — some dimensions degraded, others ok
 *
 * NOTE on intermarket under TV replay:
 *   request.security() calls in the DBE *may* resolve to live quotes
 *   rather than backdated values. The fidelity caveat
 *   'intermarket_live_quote_risk' is added when intermarket data IS
 *   present (because present-but-stale is worse than absent-and-known).
 *   Absent intermarket (null fields) gets 'degraded_intermarket' because
 *   the feature is simply missing for that row.
 *
 * Fidelity weight (0.0–1.0) is emitted for use in Stage 7 sample
 * weighting: full=1.0, mixed=0.7, degraded_session=0.85,
 * degraded_intermarket=0.6.
 */
function assessFidelity(report) {
  const caveats = [];
  let fidelity  = 'full';

  // ── Session structure ────────────────────────────────────────────────────────
  const sessNull =
    report?.session_structure?.asia?.high   == null &&
    report?.session_structure?.london?.high == null;
  if (sessNull) {
    caveats.push('session_structure_null — replay did not walk Asia/London windows; session_structure fields will be null');
    fidelity = 'degraded_session';
  } else {
    // Partial: one window populated but not both
    const asiaMissing   = report?.session_structure?.asia?.high   == null;
    const londonMissing = report?.session_structure?.london?.high == null;
    if (asiaMissing || londonMissing) {
      caveats.push(`session_structure_partial — ${asiaMissing ? 'asia' : 'london'} window missing`);
      fidelity = fidelity === 'full' ? 'mixed' : fidelity;
    }
  }

  // ── Intermarket ──────────────────────────────────────────────────────────────
  const intermarket = report?.intermarket ?? {};
  const imFields = ['dxy_pct', 'ten_year_pct', 'es_pct', 'vix'];
  const imPresent = imFields.filter(f => intermarket[f] != null).length;
  const imTotal   = imFields.length;

  if (imPresent === 0) {
    // All null: DBE could not query intermarket under replay — feature is missing
    caveats.push('intermarket_absent — all intermarket fields null; likely a replay API limitation for this date');
    fidelity = fidelity === 'full' ? 'degraded_intermarket' : 'mixed';
  } else if (imPresent < imTotal) {
    // Partial: some present, some not
    const missing = imFields.filter(f => intermarket[f] == null);
    caveats.push(`intermarket_partial — missing: ${missing.join(', ')}`);
    fidelity = fidelity === 'full' ? 'mixed' : fidelity;
    // Present fields may still reflect live quotes
    caveats.push('intermarket_live_quote_risk — present fields may reflect live quotes, not historical values (request.security() under TV replay)');
  } else {
    // All present — data exists but may be live quotes, not backdated
    caveats.push('intermarket_live_quote_risk — all fields present but may reflect live quotes, not historical values (request.security() under TV replay)');
    // Don't degrade fidelity level for this — it's a known caveat, not a missing-data problem
  }

  // ── DBE data quality ─────────────────────────────────────────────────────────
  if (report?.data_quality?.completeness && report.data_quality.completeness !== 'full') {
    caveats.push(`data_quality_${report.data_quality.completeness}`);
    fidelity = fidelity === 'full' ? 'mixed' : fidelity;
  }
  if (report?.data_quality?.fallback_used === true) {
    caveats.push('indicator_fallback_used — DBE used a fallback calculation path');
    fidelity = fidelity === 'full' ? 'mixed' : fidelity;
  }

  // ── Fidelity weight for Stage 7 sample weighting ─────────────────────────────
  const fidelityWeight = {
    full:                  1.0,
    degraded_session:      0.85,
    mixed:                 0.70,
    degraded_intermarket:  0.60,
  }[fidelity] ?? 0.70;

  return { replay_fidelity: fidelity, fidelity_weight: fidelityWeight, backfill_caveats: caveats };
}

// ─── Replay controllers ──────────────────────────────────────────────────────

async function stopReplayIfActive() {
  try { await replay.stop(); } catch { /* ignore */ }
  await sleep(500);
}

/**
 * Enter replay at a specific ISO datetime, with retry on failure.
 * Retries up to 3 times with 2s back-off — TV replay sometimes needs
 * a moment after symbol load before replay mode is available.
 */
async function enterReplayAt(isoDateTime, { retries = 3 } = {}) {
  await stopReplayIfActive();
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await replay.start({ date: isoDateTime });
      await sleep(REPLAY_SETTLE_MS);
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(2000 * attempt);
    }
  }
  throw new Error(`Replay entry failed after ${retries} attempts: ${lastErr?.message}`);
}

/**
 * Parse the replay status date string into a comparable ET hour (0–23).
 * Returns null if unparseable.
 */
function replayHourET(statusDate) {
  if (!statusDate) return null;
  try {
    const d = new Date(statusDate);
    if (isNaN(d.getTime())) return null;
    const etHour = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
    return etHour;
  } catch { return null; }
}

/**
 * Enter replay at pre-session time and step forward bar-by-bar until the
 * replay clock has passed the target ET hour, giving the DBE time to walk
 * through Asia and London session windows.
 *
 * Strategy:
 *   1. Enter replay at 03:00 ET (pre-Asia close)
 *   2. Step forward one bar at a time, checking replay_status after each step
 *   3. Stop when replay time has advanced past targetHourET (default 9)
 *   4. If replay_status is unavailable or steps > maxSteps, fall back to
 *      the old timer-based approach
 *
 * This is more reliable than a fixed-duration autoplay because:
 *   - Different timeframes have different bars-per-hour
 *   - Machine performance varies widely
 *   - We know exactly when to stop rather than guessing
 */
async function enterReplayWithPreSession(preSessionISO, targetHourET = 9) {
  await stopReplayIfActive();
  await enterReplayAt(preSessionISO);

  const MAX_STEPS = 60;   // safety ceiling — 6h × 15-min bars = 24; 60 gives headroom
  const STEP_SETTLE_MS = 150;

  let steppedToTarget = false;
  let steps = 0;

  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      await replay.step({});
      await sleep(STEP_SETTLE_MS);
      steps++;

      // Poll current replay position via status
      let statusHour = null;
      try {
        const st = await replay.status({});
        statusHour = replayHourET(st?.current_date ?? st?.date ?? null);
      } catch { /* status unavailable — fall back */ }

      if (statusHour !== null && statusHour >= targetHourET) {
        steppedToTarget = true;
        break;
      }
    }
  } catch {
    // Autoplay/step not available for this symbol/timeframe — fall back to timer
  }

  if (!steppedToTarget) {
    // Timer fallback: autoplay for AUTOPLAY_DURATION_MS, which gets most charts
    // close enough to the target window even if step-based polling failed.
    try {
      await replay.autoplay({ speed: AUTOPLAY_DELAY_MS });
      await sleep(AUTOPLAY_DURATION_MS);
      await replay.autoplay({ speed: AUTOPLAY_DELAY_MS });
    } catch { /* ignore */ }
  }

  await sleep(REPLAY_SETTLE_MS);
  return { steps_taken: steps, stepped_to_target: steppedToTarget };
}

// ─── Chunk-boundary rebuild ──────────────────────────────────────────────────

function rebuildChunk({ trainModels = false } = {}) {
  const out = {};
  try { out.analytics = rebuildAnalytics();                                } catch (e) { out.analytics = { error: e.message }; }
  try { out.dataset   = rebuildDataset();                                  } catch (e) { out.dataset   = { error: e.message }; }
  if (trainModels) {
    try { out.models  = trainAllModels();                                  } catch (e) { out.models   = { error: e.message }; }
    try { out.shadow  = predictLatestShadow();                             } catch (e) { out.shadow   = { error: e.message }; }
  }
  try { out.sync      = syncAllArtifacts();                                } catch (e) { out.sync     = { error: e.message }; }
  return out;
}

// ─── Per-date worker ─────────────────────────────────────────────────────────

const STATUSES = ['pending','running','skipped','done','failed'];

async function processDate({ date, batchId, overwrite, log }) {
  const entry = {
    trading_date: date,
    status: 'pending',
    steps: {},
    started_at: nowISO(),
    finished_at: null,
    error: null,
  };

  // Skip non-trading days silently
  if (!isTradingDay(date)) {
    entry.status = 'skipped';
    entry.reason = 'non_trading_day';
    entry.finished_at = nowISO();
    log(`[${date}] skipped — non-trading day`);
    return entry;
  }

  // Skip if already present and not overwriting
  const pmPath = join(REPORTS_DIR, date, 'premarket_nq.json');
  const pcPath = join(REPORTS_DIR, date, 'postclose_nq.json');
  if (!overwrite && existsSync(pmPath) && existsSync(pcPath)) {
    entry.status = 'skipped';
    entry.reason = 'already_present';
    entry.finished_at = nowISO();
    log(`[${date}] skipped — reports already present (use --overwrite to rerun)`);
    return entry;
  }

  entry.status = 'running';
  log(`[${date}] starting backfill (overwrite=${overwrite}, early_close=${isEarlyCloseDay(date)})`);

  try {
    // Ensure TV connectivity before attempting replay
    await health.healthCheck();
    entry.steps.healthCheck = 'ok';

    // ── Premarket at 09:00 ET (preceded by Asia+London walk for fidelity) ──
    const pmDateTime  = `${date}T${DEFAULT_PREMARKET_TIME}`;
    const preSessionISO = `${date}T${DEFAULT_PRESESSION_TIME}`;
    const walkResult = await enterReplayWithPreSession(preSessionISO);
    entry.steps.replayStart_premarket = walkResult.stepped_to_target
      ? `ok_step_walk (${walkResult.steps_taken} steps)`
      : `ok_timer_fallback (${walkResult.steps_taken} steps before fallback)`;

    const pmBackfillMeta = {
      is_backfill: true,
      batch_id: batchId,
      replay_mode: walkResult.stepped_to_target ? 'presession_step_walk' : 'presession_timer_fallback',
      steps_taken: walkResult.steps_taken,
      stepped_to_target: walkResult.stepped_to_target,
      presession_date_et: preSessionISO,
      replay_date_et: pmDateTime,
      snapshot_kind: 'premarket',
      generated_at_utc: nowISO(),
    };
    const pmResult = await generatePremarketReport({ date, backfill_metadata: pmBackfillMeta });
    entry.steps.premarket = pmResult.success ? 'ok' : 'failed';
    entry.premarket_path = pmResult.path ?? null;

    if (!pmResult.success) {
      throw new Error(`premarket generation failed: ${pmResult.error}`);
    }
    const pmFidelity = assessFidelity(pmResult.report);
    entry.premarket_fidelity = pmFidelity;

    // Patch fidelity + fidelity_weight into the saved file
    try {
      const pmSaved = JSON.parse(readFileSync(pmPath, 'utf8'));
      pmSaved.backfill_metadata = { ...pmSaved.backfill_metadata, ...pmFidelity };
      pmSaved.fidelity_weight   = pmFidelity.fidelity_weight;
      writeFileSync(pmPath, JSON.stringify(pmSaved, null, 2));
    } catch { /* non-fatal */ }

    await sleep(STEP_BETWEEN_REPORTS_MS);

    // ── Stop replay, re-enter at 16:15 ET for post-close ──────────────
    await stopReplayIfActive();
    const pcDateTime = `${date}T${DEFAULT_POSTCLOSE_TIME}`;
    await enterReplayAt(pcDateTime, { retries: 3 });
    entry.steps.replayStart_postclose = 'ok';

    const pcBackfillMeta = {
      is_backfill: true,
      batch_id: batchId,
      replay_mode: 'date_position',
      replay_date_et: pcDateTime,
      snapshot_kind: 'postclose',
      generated_at_utc: nowISO(),
    };
    const pcResult = await generatePostCloseReport({ date, backfill_metadata: pcBackfillMeta });
    entry.steps.postclose = pcResult.success ? 'ok' : 'failed';
    entry.postclose_path = pcResult.path ?? null;

    if (!pcResult.success) {
      throw new Error(`postclose generation failed: ${pcResult.error}`);
    }
    const pcFidelity = assessFidelity(pcResult.report);
    entry.postclose_fidelity = pcFidelity;

    try {
      const pcSaved = JSON.parse(readFileSync(pcPath, 'utf8'));
      pcSaved.backfill_metadata = { ...pcSaved.backfill_metadata, ...pcFidelity };
      pcSaved.fidelity_weight   = pcFidelity.fidelity_weight;
      writeFileSync(pcPath, JSON.stringify(pcSaved, null, 2));
    } catch { /* non-fatal */ }

    // ── Grade the day ─────────────────────────────────────────────────
    const gradeResult = await gradeTradingDate({ date, overwrite: true });
    entry.steps.grade = gradeResult?.success ? 'ok' : 'failed';

    // Composite fidelity weight = minimum of premarket and postclose weights.
    // Used by Stage 7 sample weighting so that degraded backfill rows have
    // less influence on ML training than high-fidelity live rows.
    const compositeWeight = Math.min(
      pmFidelity.fidelity_weight ?? 1.0,
      pcFidelity.fidelity_weight ?? 1.0,
    );
    entry.fidelity_weight = compositeWeight;

    entry.grade = {
      overall_grade:   gradeResult?.grading?.overall_grade  ?? null,
      score_0_to_100:  gradeResult?.grading?.score_0_to_100 ?? null,
      bias_correct:    gradeResult?.grading?.bias_correct   ?? null,
      failure_tags:    gradeResult?.grading?.failure_tags   ?? [],
      fidelity_weight: compositeWeight,
    };

    entry.status = 'done';
    entry.finished_at = nowISO();
    log(`[${date}] ✓ done — grade ${entry.grade.overall_grade} (${entry.grade.score_0_to_100}/100), fidelity premarket=${pmFidelity.replay_fidelity} (w=${pmFidelity.fidelity_weight}), postclose=${pcFidelity.replay_fidelity} (w=${pcFidelity.fidelity_weight}), composite_weight=${compositeWeight}`);
  } catch (err) {
    entry.status = 'failed';
    entry.error = err?.message ?? String(err);
    entry.finished_at = nowISO();
    log(`[${date}] ✗ FAILED — ${entry.error}`);
  } finally {
    try { await stopReplayIfActive(); } catch { /* swallow */ }
  }

  return entry;
}

// ─── Batch runner ────────────────────────────────────────────────────────────

/**
 * Run a backfill batch across [from, to] inclusive.
 *
 * @param {object} opts
 * @param {string}  opts.from             YYYY-MM-DD
 * @param {string}  opts.to               YYYY-MM-DD
 * @param {boolean} [opts.overwrite=false]
 * @param {number}  [opts.chunk=5]        rebuild analytics/dataset every N days
 * @param {boolean} [opts.rebuild_end_only=false] skip chunk rebuilds; only rebuild at end
 * @param {boolean} [opts.train_models=true] run model training at each rebuild
 * @param {string}  [opts.batch_id]       reuse an existing batch id (resume)
 */
export async function runBatch({
  from, to,
  overwrite = false,
  chunk = DEFAULT_CHUNK_SIZE,
  rebuild_end_only = false,
  train_models = true,
  batch_id = null,
} = {}) {
  if (!from || !to) throw new Error('from and to dates are required');
  if (from > to)    throw new Error('from must be <= to');
  ensureDirs();

  const state = loadState();
  const isResume = !!batch_id && existsSync(join(BATCHES_DIR, `${batch_id}.json`));
  const theBatchId = batch_id ?? genBatchId();

  let batch = isResume ? loadBatch(theBatchId) : null;
  if (!batch) {
    const dates = enumerateDates(from, to);
    batch = {
      schema_version:   SCHEMA_VERSION,
      batch_id:         theBatchId,
      from,
      to,
      overwrite,
      chunk,
      rebuild_end_only,
      train_models,
      dates_total:      dates.length,
      dates_planned:    dates,
      dates_completed:  [],
      dates_failed:     [],
      dates_skipped:    [],
      per_date:         {},
      status:           'running',
      started_at:       nowISO(),
      finished_at:      null,
      chunk_rebuilds:   [],
      end_rebuild:      null,
      notes:            [],
    };
  } else {
    batch.status = 'running';
    batch.notes  = (batch.notes || []).concat([`resumed_at: ${nowISO()}`]);
  }

  state.current_batch = batch.batch_id;
  saveState(state);
  saveBatch(batch);

  const log = (line) => { appendBatchLog(batch.batch_id, line); };
  log(`── batch ${batch.batch_id} ${isResume ? 'resume' : 'start'} (from=${from}, to=${to}, overwrite=${overwrite}, chunk=${chunk}, train_models=${train_models})`);

  const doneSet = new Set(batch.dates_completed);
  const failSet = new Set(batch.dates_failed);
  const skipSet = new Set(batch.dates_skipped);

  let daysProcessedThisChunk = 0;

  for (const date of batch.dates_planned) {
    // Resume-aware: skip dates already handled in a prior partial run
    if (doneSet.has(date) || failSet.has(date) || skipSet.has(date)) continue;

    const entry = await processDate({ date, batchId: batch.batch_id, overwrite, log });
    batch.per_date[date] = entry;

    if (entry.status === 'done')     { batch.dates_completed.push(date); daysProcessedThisChunk++; }
    else if (entry.status === 'skipped') batch.dates_skipped.push(date);
    else if (entry.status === 'failed') batch.dates_failed.push(date);

    saveBatch(batch);  // persist after every date

    // Chunk-boundary rebuild
    if (!rebuild_end_only && daysProcessedThisChunk >= chunk) {
      log(`── chunk rebuild (${daysProcessedThisChunk} new days)`);
      const r = rebuildChunk({ trainModels: train_models });
      batch.chunk_rebuilds.push({ at: nowISO(), after_date: date, result: summarizeRebuild(r) });
      saveBatch(batch);
      daysProcessedThisChunk = 0;
    }
  }

  // End-of-batch rebuild (always, even if chunk rebuilds ran)
  log(`── end-of-batch rebuild`);
  const endR = rebuildChunk({ trainModels: train_models });
  batch.end_rebuild = { at: nowISO(), result: summarizeRebuild(endR) };
  batch.status       = batch.dates_failed.length > 0 ? 'completed_with_failures' : 'completed';
  batch.finished_at  = nowISO();
  saveBatch(batch);

  // Summary file for easy consumption
  const summary = summarizeBatch(batch);
  writeJson(join(SUMMARIES_DIR, `${batch.batch_id}.summary.json`), summary);

  // State update
  state.current_batch = null;
  state.last_batch    = batch.batch_id;
  state.history       = (state.history || []).concat([{ batch_id: batch.batch_id, from, to, finished_at: batch.finished_at, status: batch.status }]).slice(-50);
  saveState(state);

  log(`── batch ${batch.batch_id} complete — done=${batch.dates_completed.length} failed=${batch.dates_failed.length} skipped=${batch.dates_skipped.length}`);
  return { success: true, summary };
}

function summarizeRebuild(r) {
  return {
    analytics_records:   r.analytics?.total_records ?? null,
    dataset_training_ready: r.dataset?.counts?.training_ready_rows ?? null,
    model_tasks_trained: Object.keys(r.models?.summary?.per_task ?? {}).length,
    shadow_tasks:        Object.keys(r.shadow?.predictions ?? {}).length,
    sync_ok:             r.sync?.success ?? false,
    sync_counts:         r.sync?.counts  ?? null,
  };
}

function summarizeBatch(batch) {
  const grades = {};
  let totalScore = 0, scoreN = 0;
  for (const [, e] of Object.entries(batch.per_date)) {
    if (e?.grade?.overall_grade) grades[e.grade.overall_grade] = (grades[e.grade.overall_grade] ?? 0) + 1;
    if (typeof e?.grade?.score_0_to_100 === 'number') { totalScore += e.grade.score_0_to_100; scoreN++; }
  }
  return {
    batch_id: batch.batch_id,
    from: batch.from, to: batch.to,
    status: batch.status,
    started_at:  batch.started_at,
    finished_at: batch.finished_at,
    dates_total: batch.dates_total,
    dates_completed: batch.dates_completed.length,
    dates_failed:    batch.dates_failed.length,
    dates_skipped:   batch.dates_skipped.length,
    average_score:   scoreN > 0 ? Math.round(totalScore / scoreN) : null,
    grade_distribution: grades,
    chunk_rebuilds: batch.chunk_rebuilds.length,
    end_rebuild: batch.end_rebuild,
  };
}

// ─── Public read-only getters (CLI + MCP surface) ─────────────────────────────

export async function status() {
  ensureDirs();
  const state = loadState();
  const current = state.current_batch ? loadBatch(state.current_batch) : null;
  const last    = state.last_batch    ? loadBatch(state.last_batch)    : null;
  return {
    success: true,
    schema_version: SCHEMA_VERSION,
    backfill_dir: BACKFILL_DIR,
    current_batch: current ? summarizeBatch(current) : null,
    last_batch:    last    ? summarizeBatch(last)    : null,
    history:       state.history || [],
  };
}

export async function resume({ train_models = true } = {}) {
  const state = loadState();
  const batchId = state.current_batch ?? state.last_batch;
  if (!batchId) return { success: false, reason: 'no_batch_to_resume' };
  const batch = loadBatch(batchId);
  if (!batch) return { success: false, reason: 'batch_file_missing', batch_id: batchId };
  if (batch.status === 'completed' || batch.status === 'completed_with_failures') {
    return { success: false, reason: 'batch_already_completed', batch_id: batchId, status: batch.status };
  }
  return runBatch({
    from: batch.from, to: batch.to,
    overwrite: batch.overwrite,
    chunk: batch.chunk,
    rebuild_end_only: batch.rebuild_end_only,
    train_models,
    batch_id: batchId,
  });
}

export async function abort() {
  const state = loadState();
  if (!state.current_batch) return { success: false, reason: 'no_active_batch' };
  const batch = loadBatch(state.current_batch);
  if (batch) {
    batch.status      = 'aborted';
    batch.finished_at = nowISO();
    batch.notes       = (batch.notes || []).concat([`aborted_at: ${nowISO()}`]);
    saveBatch(batch);
  }
  state.last_batch    = state.current_batch;
  state.current_batch = null;
  saveState(state);
  return { success: true, batch_id: batch?.batch_id ?? null, status: 'aborted' };
}

export async function inspect({ date } = {}) {
  if (!date) return { success: false, reason: 'date_required' };
  const pm = readJsonSafe(join(REPORTS_DIR, date, 'premarket_nq.json'));
  const pc = readJsonSafe(join(REPORTS_DIR, date, 'postclose_nq.json'));
  if (!pm && !pc) return { success: false, reason: 'no_reports_for_date', date };
  return {
    success: true,
    date,
    premarket: pm ? {
      status:               pm.status,
      bias:                 pm.bias,
      confidence:           pm.confidence,
      day_type:             pm.day_type,
      expected_range_points: pm.expected_range?.points,
      volatility_regime:    pm.volatility_regime,
      is_backfill:          pm.is_backfill ?? false,
      backfill_metadata:    pm.backfill_metadata ?? null,
    } : null,
    postclose: pc ? {
      status:                pc.status,
      actual_range_points:   pc.actual_session?.range_points,
      actual_day_type:       pc.actual_day_type,
      overall_grade:         pc.grading?.overall_grade ?? null,
      score_0_to_100:        pc.grading?.score_0_to_100 ?? null,
      bias_correct:          pc.grading?.bias_correct  ?? null,
      is_backfill:           pc.is_backfill ?? false,
      backfill_metadata:     pc.backfill_metadata ?? null,
    } : null,
  };
}

export async function listBatches() {
  ensureDirs();
  const files = readdirSync(BATCHES_DIR).filter(f => f.endsWith('.json')).sort();
  const batches = files.map(f => {
    const b = readJsonSafe(join(BATCHES_DIR, f));
    return b ? summarizeBatch(b) : null;
  }).filter(Boolean);
  return { success: true, count: batches.length, batches };
}
