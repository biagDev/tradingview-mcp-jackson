/**
 * Stage 7 — Edge Acceleration orchestrator.
 *
 * Composes the existing Stages 1–6 modules into a single research workflow:
 *   coldStart   → backfill.runBatch → analytics + dataset rebuild → modeling.trainAllModels
 *                 → shadow predict → evaluate → sync app DB
 *   retrain     → dataset rebuild → trainAllModels → shadow predict → evaluate
 *   evaluate    → ML vs baseline vs rules engine on validation+test splits
 *                 (plus agreement matrix + breakdowns)
 *
 * ────────────────────────────────────────────────────────────────────────
 * SAFETY BOUNDARIES (enforced structurally)
 *   - The rules engine remains the sole production decision.
 *   - No ML output is written to premarket_nq.json or postclose_nq.json.
 *   - Shadow predictions stay in ~/.tradingview-mcp/models/shadow/.
 *   - checkPromotionEligibility() is a pure evaluator. It never promotes.
 *
 * NO-LOOKAHEAD
 *   - Splits are chronological (Stage 4), never shuffled.
 *   - Test split is evaluated ONCE per retrain. Validation is used for
 *     champion selection.
 *   - Sample weights respect is_backfill + replay_fidelity.
 *   - Stage 4 leakage audit is unchanged — every label remains label_only.
 * ────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { runBatch as runBackfillBatch }   from './backfill.js';
import { rebuildAnalytics }                from './analytics.js';
import { rebuildDataset, loadAllSourceRecords, buildCanonicalDatasetRow } from './dataset.js';
import { trainAllModels, predictLatestShadow } from './modeling.js';
import { syncAllArtifacts }                from './app-db-sync.js';
import { isTradingDay, prevTradingDay }    from '../scheduler/calendar.js';
import { getWeightingSchemeDoc }           from './edge-weights.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const HOME_DIR       = join(homedir(), '.tradingview-mcp');
const EDGE_DIR       = join(HOME_DIR, 'edge');
const EDGE_LOGS_DIR  = join(EDGE_DIR, 'logs');
const EDGE_BREAKDOWNS = join(EDGE_DIR, 'breakdowns');
const MODELS_DIR     = join(HOME_DIR, 'models');
const TASKS_DIR      = join(MODELS_DIR, 'tasks');
const DATASETS_DIR   = join(HOME_DIR, 'datasets');
const TRAINING_READY = join(DATASETS_DIR, 'training_ready_dataset.jsonl');
const SPLITS_DIR     = join(DATASETS_DIR, 'splits');

const OUT = {
  coldstart_summary:   join(EDGE_DIR, 'coldstart_summary.json'),
  training_run:        (isoDate) => join(EDGE_DIR, `training_run_${isoDate}.json`),
  evaluation_summary:  join(EDGE_DIR, 'evaluation_summary.json'),
  agreement_matrix:    join(EDGE_DIR, 'agreement_matrix.json'),
  champion_report:     join(EDGE_DIR, 'champion_report.json'),
  promotion_check:     join(EDGE_DIR, 'promotion_check.json'),
  weighting_doc:       join(EDGE_DIR, 'weighting_scheme.json'),
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const EDGE_SCHEMA_VERSION = 1;
export const DEFAULT_COLDSTART_DAYS   = 90;
export const DEFAULT_COLDSTART_CHUNK  = 10;

// ─── Promotion policy (definition only — never activated) ─────────────────────

export const PROMOTION_POLICY = {
  schema_version: 1,
  description:
    'Promotion criteria for moving the ML champion from shadow to co-production. ' +
    'This module EVALUATES these criteria and reports which pass; it never actually promotes.',
  criteria: {
    minimum_live_rows_total:      30,   // require real live-graded history
    minimum_live_rows_per_class:  5,    // bias_direction minimum per class
    minimum_agreement_with_rules: 0.55, // ML and rules must often disagree coherently, not randomly
    minimum_advantage_over_baseline: 0.05,  // ML hit_rate - baseline_hit_rate
    minimum_advantage_over_rules:    0.00,  // ML must at least match rules on test
    minimum_improvement_regimes:     2,     // at least 2 regimes where ML beats rules
    manual_approval_flag:            'edge.promote_ml = true',  // not a real flag yet
  },
  activation_status: 'DEFINED_BUT_NOT_ACTIVATED',
  note:
    'To eventually activate, set a flag in rules.json and add a tiny gate in ' +
    'premarket-run.js that refuses promotion when any criterion fails. This is ' +
    'intentionally NOT wired today to preserve the "rules engine = production" contract.',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowISO() { return new Date().toISOString(); }
function todayISO() { return new Date().toISOString().slice(0, 10); }

function todayET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function writeJson(path, obj) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2));
}

function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function readJsonlSafe(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim(); if (!t) continue;
    try { out.push(JSON.parse(t)); } catch {}
  }
  return out;
}

function ensureDirs() {
  mkdirSync(EDGE_DIR,        { recursive: true });
  mkdirSync(EDGE_LOGS_DIR,   { recursive: true });
  mkdirSync(EDGE_BREAKDOWNS, { recursive: true });
}

function logEdge(line) {
  ensureDirs();
  const tag = `edge_${todayISO()}.log`;
  try { appendFileSync(join(EDGE_LOGS_DIR, tag), `[${new Date().toISOString()}] ${line}\n`); } catch {}
}

/** Walk the NYSE calendar backward N trading days. */
function nTradingDaysAgo(n) {
  let d = todayET();
  for (let i = 0; i < n; i++) {
    d = prevTradingDay(d) ?? d;
  }
  return d;
}

// ─── Cold start ──────────────────────────────────────────────────────────────

/**
 * Run a full research sweep: backfill → rebuild → retrain → evaluate → sync.
 *
 * @param {object} [opts]
 * @param {number}  [opts.days=90]          Trading days of history to backfill
 * @param {number}  [opts.chunk=10]         Chunk size for analytics/dataset rebuild during backfill
 * @param {boolean} [opts.overwrite=false]  Rerun backfill for dates whose reports already exist
 * @param {boolean} [opts.rebuild_end_only=true] Skip chunk rebuilds during backfill; we do one big rebuild at end
 * @param {boolean} [opts.skip_backfill=false]   Run only the retrain + evaluate portion
 */
export async function coldStart({
  days = DEFAULT_COLDSTART_DAYS,
  chunk = DEFAULT_COLDSTART_CHUNK,
  overwrite = false,
  rebuild_end_only = true,
  skip_backfill = false,
} = {}) {
  ensureDirs();
  const started_at = nowISO();
  const to   = prevTradingDay(todayET()) ?? todayET();
  const from = nTradingDaysAgo(days);
  logEdge(`coldStart from=${from} to=${to} days=${days} chunk=${chunk} skip_backfill=${skip_backfill}`);

  // Weighting scheme doc
  writeJson(OUT.weighting_doc, getWeightingSchemeDoc());

  const steps = {};

  // 1) Backfill (unless explicitly skipped)
  if (!skip_backfill) {
    try {
      const bf = await runBackfillBatch({
        from, to,
        overwrite,
        chunk,
        rebuild_end_only,
        train_models: false,   // we do one big retrain at the end
      });
      steps.backfill = {
        success: bf?.success ?? false,
        batch_id:         bf?.summary?.batch_id ?? null,
        dates_completed:  bf?.summary?.dates_completed ?? 0,
        dates_failed:     bf?.summary?.dates_failed ?? 0,
        dates_skipped:    bf?.summary?.dates_skipped ?? 0,
      };
      logEdge(`backfill done: ${JSON.stringify(steps.backfill)}`);
    } catch (err) {
      steps.backfill = { success: false, error: err.message };
      logEdge(`backfill error: ${err.message}`);
    }
  } else {
    steps.backfill = { success: true, skipped: true };
  }

  // 2) Final analytics + dataset rebuild (definitely fresh after backfill)
  try { steps.analytics = rebuildAnalytics(); logEdge(`analytics rebuilt: ${steps.analytics.total_records} records`); }
  catch (err) { steps.analytics = { error: err.message }; logEdge(`analytics error: ${err.message}`); }

  try { steps.dataset = rebuildDataset(); logEdge(`dataset rebuilt: ${JSON.stringify(steps.dataset.counts)}`); }
  catch (err) { steps.dataset = { error: err.message }; logEdge(`dataset error: ${err.message}`); }

  // 3) Retrain with weighted samples
  try { steps.training = trainAllModels(); logEdge('models retrained'); }
  catch (err) { steps.training = { error: err.message }; logEdge(`training error: ${err.message}`); }

  // 4) Shadow predictions for latest row
  try { steps.shadow = predictLatestShadow(); logEdge(`shadow predict: ${Object.keys(steps.shadow.predictions ?? {}).length} tasks`); }
  catch (err) { steps.shadow = { error: err.message }; logEdge(`shadow error: ${err.message}`); }

  // 5) Evaluate — ML vs baseline vs rules, agreement, breakdowns
  try { steps.evaluation = await evaluate(); logEdge('evaluation complete'); }
  catch (err) { steps.evaluation = { error: err.message }; logEdge(`evaluation error: ${err.message}`); }

  // 6) App DB sync so the dashboard reflects everything at once
  try { steps.sync = syncAllArtifacts(); logEdge(`sync ok: ${JSON.stringify(steps.sync.counts)}`); }
  catch (err) { steps.sync = { error: err.message }; logEdge(`sync error: ${err.message}`); }

  const finished_at = nowISO();
  const summary = {
    schema_version: EDGE_SCHEMA_VERSION,
    started_at, finished_at,
    duration_ms: new Date(finished_at).getTime() - new Date(started_at).getTime(),
    from, to, days, chunk, overwrite, skip_backfill,
    steps,
  };
  writeJson(OUT.coldstart_summary, summary);
  writeJson(OUT.training_run(todayISO()), summary);
  return summary;
}

// ─── Retrain-only (no backfill) ──────────────────────────────────────────────

export async function retrain({ rebuild_dataset = true } = {}) {
  ensureDirs();
  const started_at = nowISO();
  logEdge(`retrain starting (rebuild_dataset=${rebuild_dataset})`);
  const steps = {};
  if (rebuild_dataset) {
    try { steps.dataset = rebuildDataset(); } catch (err) { steps.dataset = { error: err.message }; }
  }
  try { steps.training = trainAllModels(); } catch (err) { steps.training = { error: err.message }; }
  try { steps.shadow   = predictLatestShadow(); } catch (err) { steps.shadow = { error: err.message }; }
  try { steps.evaluation = await evaluate(); } catch (err) { steps.evaluation = { error: err.message }; }
  try { steps.sync     = syncAllArtifacts(); } catch (err) { steps.sync = { error: err.message }; }
  const finished_at = nowISO();
  const summary = { schema_version: EDGE_SCHEMA_VERSION, started_at, finished_at, steps };
  writeJson(OUT.training_run(todayISO()), summary);
  return summary;
}

// ─── Evaluation ───────────────────────────────────────────────────────────────

/**
 * Load every canonical dataset row (both train/val/test splits combined).
 * We evaluate ML predictions only on rows the model was allowed to see —
 * ie validation + test. Train rows are excluded to avoid overfit-friendly
 * metrics being reported.
 */
function loadAllRows() {
  // Prefer the explicit splits JSONL; if empty, fall back to the full
  // training_ready dataset (useful when n < min split sizes).
  const train = readJsonlSafe(join(SPLITS_DIR, 'train.jsonl'));
  const val   = readJsonlSafe(join(SPLITS_DIR, 'validation.jsonl'));
  const test  = readJsonlSafe(join(SPLITS_DIR, 'test.jsonl'));
  const allRows = readJsonlSafe(TRAINING_READY);
  return { train, val, test, all: allRows };
}

function loadChampionForTask(task) {
  const dir = join(TASKS_DIR, task);
  return {
    champion: readJsonSafe(join(dir, 'champion.json')),
    model:    readJsonSafe(join(dir, 'model.json')),
    preConf:  readJsonSafe(join(dir, 'preprocess_config.json')),
    baseline: readJsonSafe(join(dir, 'baseline_metrics.json')),
  };
}

/**
 * Run the saved champion model on a single canonical row. Returns the
 * predicted class / value, or null when the champion is a baseline or
 * the model artifacts are missing.
 */
function predictRowWithModel({ champion, model, preConf }, row) {
  if (!champion || champion.is_baseline || !model || !preConf) return null;
  // Rebuild a feature vector using the saved preprocess config.
  const vec = [];
  for (const col of preConf.columns) {
    if (col.kind === 'numeric') {
      const raw = (col.source in (row.features ?? {})) ? row.features[col.source]
                : (col.source in (row.metadata ?? {})) ? row.metadata[col.source]
                : null;
      const val = raw != null ? raw : preConf.imputations?.[col.source];
      const sc  = preConf.scalers?.[col.source];
      const std = sc?.std > 0 ? (val - sc.mean) / sc.std : 0;
      vec.push(Number.isFinite(std) ? std : 0);
    } else {
      const raw = (col.source in (row.features ?? {})) ? row.features[col.source]
                : (col.source in (row.metadata ?? {})) ? row.metadata[col.source]
                : null;
      const v = raw == null ? preConf.imputations?.[col.source] : String(raw);
      vec.push(v === col.category ? 1 : 0);
    }
  }

  const fam = model?.model?.family;
  if (fam === 'logreg_binary') {
    let z = model.model.intercept;
    for (let j = 0; j < model.model.d; j++) z += vec[j] * model.model.weights[j];
    const p = 1 / (1 + Math.exp(-z));
    return p >= 0.5;
  }
  if (fam === 'logreg_multiclass') {
    const probs = model.model.classes.map(c => {
      const bm = model.model.binary[c];
      let z = bm.intercept;
      for (let j = 0; j < bm.d; j++) z += vec[j] * bm.weights[j];
      return 1 / (1 + Math.exp(-z));
    });
    const s = probs.reduce((a, b) => a + b, 0) || 1;
    const norm = probs.map(v => v / s);
    const argmax = norm.indexOf(Math.max(...norm));
    return model.model.classes[argmax];
  }
  if (fam === 'ridge') {
    let z = model.model.intercept;
    for (let j = 0; j < model.model.d; j++) z += vec[j] * model.model.weights[j];
    return z * model.model.y_std + model.model.y_mean;
  }
  return null;
}

/**
 * Honest eval of the bias_direction task.
 *   - rules_hit_rate: fraction of rows where labels.bias_correct === true
 *   - ml_hit_rate:    fraction where saved champion's prediction matches labels.bias_actual
 *   - baseline_hit_rate: fraction where majority-class baseline matches
 */
function evaluateBiasDirection(rows, artifacts) {
  const { champion, baseline } = artifacts;
  const isBaseline = !champion || champion.is_baseline;
  let rulesHits = 0, rulesN = 0;
  let mlHits    = 0, mlN    = 0;
  let baseHits  = 0, baseN  = 0;
  let agree     = 0, agreeN = 0;

  const matrix = {}; // rules → ML counts
  const rulesBucket = (v) => v == null ? '_' : String(v);
  const mlBucket    = (v) => v == null ? '_' : String(v);

  const majority = baseline?.baseline_model?.majority_class ?? null;

  for (const row of rows) {
    const actual = row?.labels?.bias_actual;
    const ruleCalled = row?.features?.bias_called;
    if (actual == null || actual === undefined) continue;

    if (ruleCalled != null) {
      rulesN++;
      if (String(ruleCalled) === String(actual)) rulesHits++;
    }

    const mlPred = isBaseline
      ? majority
      : predictRowWithModel(artifacts, row);
    if (mlPred != null) {
      mlN++;
      if (String(mlPred) === String(actual)) mlHits++;
    }

    if (majority != null) {
      baseN++;
      if (String(majority) === String(actual)) baseHits++;
    }

    if (ruleCalled != null && mlPred != null) {
      agreeN++;
      if (String(ruleCalled) === String(mlPred)) agree++;
      const rk = rulesBucket(ruleCalled), mk = mlBucket(mlPred);
      matrix[rk] = matrix[rk] ?? {};
      matrix[rk][mk] = (matrix[rk][mk] ?? 0) + 1;
    }
  }
  const r = (h, n) => n > 0 ? Math.round((h / n) * 10000) / 10000 : null;
  return {
    n: rows.length,
    rules: { hits: rulesHits, n: rulesN, hit_rate: r(rulesHits, rulesN) },
    ml:    { hits: mlHits,    n: mlN,    hit_rate: r(mlHits,    mlN), is_baseline: isBaseline, majority_class: majority },
    baseline: { hits: baseHits, n: baseN, hit_rate: r(baseHits, baseN), majority_class: majority },
    agreement: { agree, n: agreeN, rate: r(agree, agreeN) },
    matrix,
    ml_advantage_over_rules:    (r(mlHits, mlN) != null && r(rulesHits, rulesN) != null) ? Math.round((r(mlHits, mlN) - r(rulesHits, rulesN)) * 10000) / 10000 : null,
    ml_advantage_over_baseline: (r(mlHits, mlN) != null && r(baseHits, baseN) != null) ? Math.round((r(mlHits, mlN) - r(baseHits, baseN)) * 10000) / 10000 : null,
  };
}

/** Honest eval of actual_range_points (regression): MAE for each predictor. */
function evaluateRangePoints(rows, artifacts) {
  const { champion, baseline } = artifacts;
  const isBaseline = !champion || champion.is_baseline;
  const baseMean = baseline?.baseline_model?.mean ?? null;

  const mae = (preds) => {
    const errs = [];
    for (let i = 0; i < preds.length; i++) {
      const t = rows[i]?.labels?.actual_range_points;
      const p = preds[i];
      if (typeof t === 'number' && typeof p === 'number') errs.push(Math.abs(t - p));
    }
    return errs.length ? Math.round((errs.reduce((a, b) => a + b, 0) / errs.length) * 100) / 100 : null;
  };

  const ruleCalled = rows.map(r => r?.features?.expected_range_points ?? null);
  const mlPred     = rows.map(r => isBaseline ? baseMean : predictRowWithModel(artifacts, r));
  const basePred   = rows.map(() => baseMean);

  return {
    n: rows.length,
    rules_mae: mae(ruleCalled),
    ml_mae:    mae(mlPred),
    baseline_mae: mae(basePred),
    ml_is_baseline: isBaseline,
  };
}

/** Group rows by a dimension and compute the bias_direction eval per bucket. */
function biasBreakdownBy(rows, dim, artifacts) {
  const groups = {};
  for (const row of rows) {
    const key = String(
      dim === 'is_backfill'      ? (row.metadata?.is_backfill === true) :
      dim === 'replay_fidelity'  ? (row.metadata?.replay_fidelity ?? 'n/a') :
      dim === 'weekday'          ? (row.metadata?.weekday ?? 'n/a') :
      dim === 'volatility_regime'? (row.features?.volatility_regime ?? 'n/a') :
      dim === 'model_version'    ? (row.metadata?.model_version ?? 'n/a') :
      dim === 'indicator_version'? (row.metadata?.indicator_version ?? 'n/a') :
      dim === 'prompt_version'   ? (row.metadata?.prompt_version ?? 'n/a') :
      dim === 'coverage_bucket'  ? (() => {
        const c = row.quality?.feature_coverage_pct ?? 0;
        if (c >= 0.95) return '>=0.95';
        if (c >= 0.75) return '0.75-0.95';
        if (c >= 0.50) return '0.50-0.75';
        if (c >= 0.25) return '0.25-0.50';
        return '<0.25';
      })() : 'n/a'
    );
    groups[key] = groups[key] ?? [];
    groups[key].push(row);
  }
  const out = {};
  for (const [k, rs] of Object.entries(groups)) out[k] = evaluateBiasDirection(rs, artifacts);
  return out;
}

/**
 * Full evaluation. Uses (validation + test) rows so we don't report
 * overfit-favorable metrics on training rows.
 */
export async function evaluate() {
  ensureDirs();
  // Always keep the weighting-scheme doc on disk after any evaluation —
  // this is what the /edge dashboard reads for the weight-scheme card.
  writeJson(OUT.weighting_doc, getWeightingSchemeDoc());
  const { val, test, all } = loadAllRows();
  // Primary eval set: val + test. Fall back to `all` if splits are empty.
  const primary = [...val, ...test];
  const evalRows = primary.length > 0 ? primary : all;

  const biasArtifacts  = loadChampionForTask('bias_direction');
  const rangeArtifacts = loadChampionForTask('actual_range_points');

  const biasEval  = evaluateBiasDirection(evalRows, biasArtifacts);
  const rangeEval = evaluateRangePoints(evalRows, rangeArtifacts);

  // Breakdowns (bias only — most informative)
  const dims = ['weekday','volatility_regime','is_backfill','replay_fidelity','coverage_bucket','model_version','indicator_version','prompt_version'];
  for (const d of dims) {
    const brk = biasBreakdownBy(evalRows, d, biasArtifacts);
    writeJson(join(EDGE_BREAKDOWNS, `${d}.json`), {
      schema_version: EDGE_SCHEMA_VERSION,
      last_updated: nowISO(),
      dimension: d,
      eval_rows: evalRows.length,
      groups: brk,
    });
  }

  // Count regimes where ML beats rules (for the promotion gate)
  const regimeBrk = biasBreakdownBy(evalRows, 'volatility_regime', biasArtifacts);
  let regimeWins = 0;
  for (const g of Object.values(regimeBrk)) {
    if (g?.ml?.hit_rate != null && g?.rules?.hit_rate != null && g.ml.hit_rate > g.rules.hit_rate) regimeWins++;
  }

  const evaluation = {
    schema_version: EDGE_SCHEMA_VERSION,
    last_updated:   nowISO(),
    eval_rows_total:     evalRows.length,
    eval_rows_from_splits: primary.length,
    eval_rows_from_all:  primary.length === 0 ? all.length : 0,
    bias_direction:      biasEval,
    actual_range_points: rangeEval,
    regime_wins:         regimeWins,
    note: primary.length === 0
      ? 'Validation+test splits empty; using entire training_ready dataset. Not a true holdout — take with caution.'
      : 'Evaluated on chronological validation+test splits only.',
  };

  writeJson(OUT.evaluation_summary, evaluation);
  writeJson(OUT.agreement_matrix, {
    schema_version: EDGE_SCHEMA_VERSION,
    last_updated:   nowISO(),
    task: 'bias_direction',
    matrix: biasEval.matrix,
    agreement_rate: biasEval.agreement.rate,
    agreement_n:    biasEval.agreement.n,
  });

  // Promotion check
  const check = checkPromotionEligibility(evaluation);
  writeJson(OUT.promotion_check, check);

  // Champion report
  const championReport = {
    schema_version: EDGE_SCHEMA_VERSION,
    last_updated: nowISO(),
    bias_direction: {
      champion:      biasArtifacts.champion,
      is_baseline:   biasArtifacts.champion?.is_baseline ?? true,
      validation:    biasEval,
    },
    actual_range_points: {
      champion:      rangeArtifacts.champion,
      is_baseline:   rangeArtifacts.champion?.is_baseline ?? true,
      validation:    rangeEval,
    },
    promotion_check: check,
  };
  writeJson(OUT.champion_report, championReport);

  return evaluation;
}

// ─── Promotion gate — DEFINED ONLY, NEVER ACTIVATED ───────────────────────────

export function checkPromotionEligibility(evaluation) {
  const crit = PROMOTION_POLICY.criteria;
  const bias = evaluation?.bias_direction ?? {};
  const reasons = [];

  const liveRows      = bias.n ?? 0;   // proxy — true live-only count requires further filtering
  const biasAgreement = bias.agreement?.rate ?? null;
  const biasMlVsBase  = bias.ml_advantage_over_baseline;
  const biasMlVsRules = bias.ml_advantage_over_rules;
  const regimeWins    = evaluation?.regime_wins ?? 0;

  const checks = {
    minimum_live_rows_total:
      liveRows >= crit.minimum_live_rows_total
        ? { pass: true }
        : { pass: false, have: liveRows, need: crit.minimum_live_rows_total },

    minimum_agreement_with_rules:
      biasAgreement != null && biasAgreement >= crit.minimum_agreement_with_rules
        ? { pass: true, value: biasAgreement }
        : { pass: false, value: biasAgreement, need: crit.minimum_agreement_with_rules },

    minimum_advantage_over_baseline:
      biasMlVsBase != null && biasMlVsBase >= crit.minimum_advantage_over_baseline
        ? { pass: true, value: biasMlVsBase }
        : { pass: false, value: biasMlVsBase, need: crit.minimum_advantage_over_baseline },

    minimum_advantage_over_rules:
      biasMlVsRules != null && biasMlVsRules >= crit.minimum_advantage_over_rules
        ? { pass: true, value: biasMlVsRules }
        : { pass: false, value: biasMlVsRules, need: crit.minimum_advantage_over_rules },

    minimum_improvement_regimes:
      regimeWins >= crit.minimum_improvement_regimes
        ? { pass: true, regime_wins: regimeWins }
        : { pass: false, regime_wins: regimeWins, need: crit.minimum_improvement_regimes },

    manual_approval_flag: { pass: false, note: 'flag not wired yet — intentional' },
  };

  const passCount = Object.values(checks).filter(c => c.pass).length;
  const allPass   = passCount === Object.keys(checks).length;

  for (const [k, v] of Object.entries(checks)) if (!v.pass) reasons.push(k);

  return {
    schema_version: EDGE_SCHEMA_VERSION,
    last_updated:   nowISO(),
    policy:         PROMOTION_POLICY,
    checks,
    reasons,
    all_pass:       allPass,
    would_promote:  false,    // always false by policy
    promote_now:    false,    // always false by policy
    note: 'DEFINITION ONLY — this function never promotes. Rules engine remains production regardless of result.',
  };
}

// ─── Read-only getters (CLI + MCP) ────────────────────────────────────────────

export function status() {
  ensureDirs();
  return {
    schema_version: EDGE_SCHEMA_VERSION,
    last_updated:   nowISO(),
    edge_dir:       EDGE_DIR,
    coldstart_summary: readJsonSafe(OUT.coldstart_summary),
    last_training_run: (() => {
      const files = readdirSync(EDGE_DIR).filter(f => f.startsWith('training_run_')).sort();
      const last = files[files.length - 1];
      return last ? { file: last, ...readJsonSafe(join(EDGE_DIR, last)) } : null;
    })(),
    evaluation_summary: readJsonSafe(OUT.evaluation_summary),
    champion_report:    readJsonSafe(OUT.champion_report),
    promotion_check:    readJsonSafe(OUT.promotion_check),
    weighting_scheme:   readJsonSafe(OUT.weighting_doc) ?? getWeightingSchemeDoc(),
  };
}

export function getChampionReport()   { return readJsonSafe(OUT.champion_report)   ?? { note: 'no report yet — run `tv edge evaluate`' }; }
export function getAgreementMatrix()  { return readJsonSafe(OUT.agreement_matrix)  ?? { note: 'no matrix yet — run `tv edge evaluate`' }; }
export function getEvaluationSummary(){ return readJsonSafe(OUT.evaluation_summary)?? { note: 'no evaluation yet — run `tv edge evaluate`' }; }
export function getWeightingScheme()  { return getWeightingSchemeDoc(); }
export function getPromotionCheck()   { return readJsonSafe(OUT.promotion_check)   ?? { note: 'no check yet — run `tv edge evaluate`' }; }
