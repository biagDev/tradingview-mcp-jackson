/**
 * Stage 5 — NQ Daily Bias Modeling Layer (SHADOW MODE ONLY)
 *
 * Local, dependency-free, auditable ML training and shadow-mode inference.
 * Hand-rolled logistic regression (one-vs-rest multiclass) and ridge
 * regression via gradient descent. No Python, no external ML libraries,
 * no cloud. Everything is a JSON file you can inspect.
 *
 * ────────────────────────────────────────────────────────────────────────
 * IMPORTANT
 *   The rules-based engine (Stages 1–3) remains the production source of
 *   truth. Nothing here overwrites the daily brief. Predictions are
 *   written to ~/.tradingview-mcp/models/shadow/ for audit only.
 *
 *   With sparse history this module degrades gracefully:
 *     - Baselines are trained whenever n ≥ 1.
 *     - Champion models are skipped below MIN_TRAIN_ROWS / MIN_VAL_ROWS.
 *     - Every task writes a training_status.json explaining what happened.
 *
 * INPUTS
 *   ~/.tradingview-mcp/datasets/splits/{train,validation,test}.jsonl
 *   ~/.tradingview-mcp/datasets/training_ready_dataset.jsonl
 *   ~/.tradingview-mcp/datasets/quality_report.json       (for sparsity)
 *   ~/.tradingview-mcp/datasets/leakage_audit.json        (for policy)
 *   ~/.tradingview-mcp/reports/YYYY-MM-DD/premarket_nq.json (shadow input)
 *
 * OUTPUTS
 *   ~/.tradingview-mcp/models/
 *     manifest.json, training_summary.json, leaderboard.json
 *     tasks/<task>/{training_status,champion,metrics,baseline_metrics,
 *                   feature_importance,confusion_matrix,model_card,
 *                   preprocess_config,predictions_validation,
 *                   predictions_test,model}.json
 *     shadow/{latest_predictions.json, prediction_history.jsonl}
 * ────────────────────────────────────────────────────────────────────────
 */

import {
  readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as datasetCore from './dataset.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const HOME_DIR       = join(homedir(), '.tradingview-mcp');
const REPORTS_DIR    = join(HOME_DIR, 'reports');
const DATASETS_DIR   = join(HOME_DIR, 'datasets');
const SPLITS_DIR     = join(DATASETS_DIR, 'splits');
const MODELS_DIR     = join(HOME_DIR, 'models');
const TASKS_DIR      = join(MODELS_DIR, 'tasks');
const SHADOW_DIR     = join(MODELS_DIR, 'shadow');

const TRAIN_JSONL    = join(SPLITS_DIR, 'train.jsonl');
const VAL_JSONL      = join(SPLITS_DIR, 'validation.jsonl');
const TEST_JSONL     = join(SPLITS_DIR, 'test.jsonl');
const TRAINING_READY = join(DATASETS_DIR, 'training_ready_dataset.jsonl');
const LATEST_ONLY    = join(DATASETS_DIR, 'latest_only_dataset.jsonl');

const SHADOW_LATEST  = join(SHADOW_DIR, 'latest_predictions.json');
const SHADOW_HISTORY = join(SHADOW_DIR, 'prediction_history.jsonl');

const MANIFEST_PATH  = join(MODELS_DIR, 'manifest.json');
const SUMMARY_PATH   = join(MODELS_DIR, 'training_summary.json');
const LEADERBOARD_PATH = join(MODELS_DIR, 'leaderboard.json');

// ─── Constants (tunable) ──────────────────────────────────────────────────────

export const MODEL_SCHEMA_VERSION      = 1;
export const DETERMINISTIC_SEED        = 42;
export const MIN_ROWS_TOTAL            = 20;     // eligible rows needed before any task attempts champion training
export const MIN_ROWS_PER_CLASS        = 3;      // multiclass: each class needs ≥ 3 examples
export const MIN_TRAIN_ROWS            = 10;
export const MIN_VAL_ROWS              = 2;
export const MIN_TEST_ROWS             = 2;
export const SPARSITY_DROP_THRESHOLD   = 0.50;   // drop features with > 50% null in training split
export const GRADIENT_LEARNING_RATE    = 0.05;
export const GRADIENT_MAX_ITER         = 300;
export const GRADIENT_TOL              = 1e-6;

// Allowlist of metadata fields safe to use as features (knowable at premarket time)
const METADATA_FEATURES_ALLOWLIST = [
  'weekday', 'month',
  'calendar_source', 'early_close',
  'model_version', 'indicator_version', 'prompt_version',
];

// ─── Task registry ────────────────────────────────────────────────────────────
//
// Each task declares its label field, target extraction, model type,
// candidate model grid, and champion selection metric.

const TASKS = {
  bias_direction: {
    target:         r => r.labels?.bias_actual ?? null,
    kind:           'classification_multiclass',
    classes:        ['bullish','bearish','neutral'],
    champion_metric:'f1_macro',        // higher is better
    champion_direction: 'max',
    candidates: [
      { name: 'logreg_l2_0.1', family: 'logreg', l2: 0.1 },
      { name: 'logreg_l2_1.0', family: 'logreg', l2: 1.0 },
    ],
  },
  day_type: {
    target:         r => r.labels?.day_type_actual ?? null,
    kind:           'classification_multiclass',
    classes:        ['trending','normal','range','inside'],
    champion_metric:'f1_macro',
    champion_direction: 'max',
    candidates: [
      { name: 'logreg_l2_0.1', family: 'logreg', l2: 0.1 },
      { name: 'logreg_l2_1.0', family: 'logreg', l2: 1.0 },
    ],
  },
  range_in_tolerance: {
    target:         r => r.labels?.range_within_tolerance ?? null,
    kind:           'classification_binary',
    classes:        [false, true],
    champion_metric:'f1',
    champion_direction: 'max',
    candidates: [
      { name: 'logreg_l2_0.1', family: 'logreg', l2: 0.1 },
      { name: 'logreg_l2_1.0', family: 'logreg', l2: 1.0 },
    ],
  },
  actual_range_points: {
    target:         r => r.labels?.actual_range_points ?? null,
    kind:           'regression',
    champion_metric:'mae',             // lower is better
    champion_direction: 'min',
    candidates: [
      { name: 'ridge_a_0.1',  family: 'ridge', alpha: 0.1 },
      { name: 'ridge_a_1.0',  family: 'ridge', alpha: 1.0 },
      { name: 'ridge_a_10.0', family: 'ridge', alpha: 10.0 },
    ],
  },
  good_grade: {
    target:         r => r.labels?.target_good_grade ?? null,
    kind:           'classification_binary',
    classes:        [false, true],
    champion_metric:'f1',
    champion_direction: 'max',
    candidates: [
      { name: 'logreg_l2_0.1', family: 'logreg', l2: 0.1 },
      { name: 'logreg_l2_1.0', family: 'logreg', l2: 1.0 },
    ],
  },
};

// ─── Utility ──────────────────────────────────────────────────────────────────

function nowISO() { return new Date().toISOString(); }

function writeJson(path, obj) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2));
}

function readJsonlSafe(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const out  = [];
  for (const line of text.split('\n')) {
    const t = line.trim(); if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip */ }
  }
  return out;
}

function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/** Seeded PRNG (mulberry32) for reproducible initializations. */
function makePRNG(seed) {
  let s = seed | 0;
  return function() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(v, d = 4) {
  if (v == null || typeof v !== 'number' || !Number.isFinite(v)) return v;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function sum(arr) { return arr.reduce((s, v) => s + v, 0); }
function mean(arr) { return arr.length === 0 ? 0 : sum(arr) / arr.length; }
function median(arr) {
  if (arr.length === 0) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function std(arr) {
  if (arr.length < 2) return 1;
  const m = mean(arr);
  const v = mean(arr.map(x => (x - m) ** 2));
  return Math.sqrt(v) || 1;
}

// ─── Preprocessing ────────────────────────────────────────────────────────────
//
// Fit on train rows, apply to val/test/shadow.
// Drops features whose null rate in TRAIN exceeds SPARSITY_DROP_THRESHOLD.
// Numeric → median impute + standardize; categorical → mode impute + one-hot.

function allCandidateFeatureNames() {
  // FEATURE_SPEC-driven list from Stage 4, plus whitelisted metadata fields.
  const spec = datasetCore.FEATURE_SPEC;
  return [
    ...spec.map(s => ({ name: s.name, from: 'features', type: s.type })),
    ...METADATA_FEATURES_ALLOWLIST.map(n => ({ name: n, from: 'metadata', type: 'categorical' })),
  ];
}

function getCell(row, field) {
  // field = { name, from: 'features'|'metadata', type }
  const src = field.from === 'metadata' ? row.metadata : row.features;
  return src?.[field.name] ?? null;
}

function classifyType(type) {
  if (type === 'int' || type === 'float') return 'numeric';
  if (type === 'bool')                     return 'categorical'; // encode as 0/1 via one-hot
  return 'categorical';
}

function fitPreprocess(rows) {
  const fields = allCandidateFeatureNames();
  const kept = [];
  const imputations = {};
  const categoryMaps = {};
  const scalers = {};

  const n = rows.length;
  if (n === 0) return { fields_used: [], kept: [], imputations, categoryMaps, scalers, n: 0 };

  for (const f of fields) {
    const values = rows.map(r => getCell(r, f));
    const nullRate = values.filter(v => v == null).length / n;
    if (nullRate > SPARSITY_DROP_THRESHOLD) continue;

    const kind = classifyType(f.type);
    if (kind === 'numeric') {
      const nums = values.filter(v => v != null && typeof v === 'number');
      if (nums.length === 0) continue;
      const med = median(nums);
      const sd  = std(nums);
      imputations[f.name] = med;
      scalers[f.name]     = { mean: mean(nums), std: sd, median: med };
      kept.push({ ...f, kind: 'numeric' });
    } else {
      const vals = values.map(v => v == null ? '__missing__' : String(v));
      const counts = {};
      for (const v of vals) counts[v] = (counts[v] ?? 0) + 1;
      const mode = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      imputations[f.name] = mode;
      const uniq = [...new Set(vals)].sort();
      categoryMaps[f.name] = Object.fromEntries(uniq.map((c, i) => [c, i]));
      kept.push({ ...f, kind: 'categorical', categories: uniq });
    }
  }

  // Build final expanded feature column list
  const columns = [];
  for (const k of kept) {
    if (k.kind === 'numeric') {
      columns.push({ source: k.name, col: `num__${k.name}`, kind: 'numeric' });
    } else {
      for (const c of k.categories) {
        columns.push({ source: k.name, col: `cat__${k.name}__${c}`, kind: 'categorical', category: c });
      }
    }
  }

  return {
    fields_used: kept.map(k => ({ name: k.name, from: k.from, kind: k.kind, categories: k.categories ?? null })),
    columns,
    imputations,
    categoryMaps,
    scalers,
    n,
  };
}

function transformRow(row, pre) {
  const vec = [];
  for (const col of pre.columns) {
    if (col.kind === 'numeric') {
      const field = pre.fields_used.find(f => f.name === col.source);
      const raw = getCell(row, { name: col.source, from: field?.from ?? 'features' });
      const val = raw != null ? raw : pre.imputations[col.source];
      const sc  = pre.scalers[col.source];
      const standardized = sc?.std > 0 ? (val - sc.mean) / sc.std : 0;
      vec.push(Number.isFinite(standardized) ? standardized : 0);
    } else {
      const field = pre.fields_used.find(f => f.name === col.source);
      const raw = getCell(row, { name: col.source, from: field?.from ?? 'features' });
      const v   = raw == null ? pre.imputations[col.source] : String(raw);
      vec.push(v === col.category ? 1 : 0);
    }
  }
  return vec;
}

function transformMatrix(rows, pre) { return rows.map(r => transformRow(r, pre)); }

// ─── Baselines ────────────────────────────────────────────────────────────────

function fitMajorityClassBaseline(yTrain) {
  const counts = {};
  for (const y of yTrain) if (y != null) counts[String(y)] = (counts[String(y)] ?? 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const majority = entries[0]?.[0] ?? null;
  const total = sum(Object.values(counts));
  const probs = {};
  for (const [c, n] of entries) probs[c] = round(n / total, 4);
  return { family: 'majority_class', majority_class: majority, class_probs: probs, n: total };
}

function predictMajorityClass(model, X) {
  return X.map(() => model.majority_class);
}

function fitMeanBaseline(yTrain) {
  const nums = yTrain.filter(v => typeof v === 'number');
  const m    = mean(nums);
  return { family: 'mean_predictor', mean: round(m, 4), n: nums.length };
}

function predictMean(model, X) {
  return X.map(() => model.mean);
}

// ─── Logistic regression (binary) via gradient descent + L2 ───────────────────

function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

function fitLogisticBinary(X, y, { l2 = 0.1, lr = GRADIENT_LEARNING_RATE, max_iter = GRADIENT_MAX_ITER, seed = DETERMINISTIC_SEED } = {}) {
  const n = X.length;
  if (n === 0) return null;
  const d = X[0].length;
  const rand = makePRNG(seed);
  let w = Array.from({ length: d }, () => (rand() - 0.5) * 0.01);
  let b = 0;

  let prev_loss = Infinity;
  for (let iter = 0; iter < max_iter; iter++) {
    const preds = X.map(row => {
      let z = b;
      for (let j = 0; j < d; j++) z += row[j] * w[j];
      return sigmoid(z);
    });
    // gradients
    const gw = new Array(d).fill(0);
    let gb = 0;
    let loss = 0;
    for (let i = 0; i < n; i++) {
      const err = preds[i] - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
      gb += err;
      const p = Math.max(1e-12, Math.min(1 - 1e-12, preds[i]));
      loss += -(y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p));
    }
    loss /= n;
    for (let j = 0; j < d; j++) gw[j] = gw[j] / n + l2 * w[j];
    gb /= n;
    // l2 loss term
    for (let j = 0; j < d; j++) loss += (l2 / 2) * w[j] * w[j];

    // update
    for (let j = 0; j < d; j++) w[j] -= lr * gw[j];
    b -= lr * gb;

    if (Math.abs(prev_loss - loss) < GRADIENT_TOL) break;
    prev_loss = loss;
  }
  return { family: 'logreg_binary', weights: w, intercept: b, d };
}

function predictLogisticBinary(model, X) {
  return X.map(row => {
    let z = model.intercept;
    for (let j = 0; j < model.d; j++) z += row[j] * model.weights[j];
    return sigmoid(z);
  });
}

// ─── Logistic regression (multiclass via one-vs-rest) ─────────────────────────

function fitLogisticMulticlass(X, y, classes, opts) {
  const binary = {};
  for (const c of classes) {
    const yBin = y.map(v => String(v) === String(c) ? 1 : 0);
    binary[String(c)] = fitLogisticBinary(X, yBin, opts);
  }
  return { family: 'logreg_multiclass', classes: classes.map(String), binary };
}

function predictLogisticMulticlass(model, X) {
  const probs = model.classes.map(c => predictLogisticBinary(model.binary[c], X));
  // probs: [K][n]
  const n = X.length;
  const preds = [];
  const probOut = [];
  for (let i = 0; i < n; i++) {
    const p = model.classes.map((_, k) => probs[k][i]);
    const s = sum(p) || 1;
    const pnorm = p.map(v => v / s);
    const argmax = pnorm.indexOf(Math.max(...pnorm));
    preds.push(model.classes[argmax]);
    probOut.push(Object.fromEntries(model.classes.map((c, k) => [c, round(pnorm[k], 4)])));
  }
  return { predictions: preds, probabilities: probOut };
}

// ─── Ridge regression via gradient descent ────────────────────────────────────

function fitRidge(X, y, { alpha = 1.0, lr = GRADIENT_LEARNING_RATE, max_iter = GRADIENT_MAX_ITER, seed = DETERMINISTIC_SEED } = {}) {
  const n = X.length;
  if (n === 0) return null;
  const d = X[0].length;
  const rand = makePRNG(seed);
  let w = Array.from({ length: d }, () => (rand() - 0.5) * 0.01);
  let b = 0;

  // Standardize target for stability (store mean/std, unstandardize at predict time)
  const yMean = mean(y);
  const yStd  = std(y) || 1;
  const yN    = y.map(v => (v - yMean) / yStd);

  let prev_loss = Infinity;
  for (let iter = 0; iter < max_iter; iter++) {
    const preds = X.map(row => {
      let z = b;
      for (let j = 0; j < d; j++) z += row[j] * w[j];
      return z;
    });
    const gw = new Array(d).fill(0);
    let gb = 0;
    let loss = 0;
    for (let i = 0; i < n; i++) {
      const err = preds[i] - yN[i];
      for (let j = 0; j < d; j++) gw[j] += 2 * err * X[i][j];
      gb += 2 * err;
      loss += err * err;
    }
    loss /= n;
    for (let j = 0; j < d; j++) gw[j] = gw[j] / n + 2 * alpha * w[j];
    gb /= n;
    for (let j = 0; j < d; j++) loss += alpha * w[j] * w[j];

    for (let j = 0; j < d; j++) w[j] -= lr * gw[j];
    b -= lr * gb;

    if (Math.abs(prev_loss - loss) < GRADIENT_TOL) break;
    prev_loss = loss;
  }
  return { family: 'ridge', weights: w, intercept: b, d, y_mean: yMean, y_std: yStd };
}

function predictRidge(model, X) {
  return X.map(row => {
    let z = model.intercept;
    for (let j = 0; j < model.d; j++) z += row[j] * model.weights[j];
    return z * model.y_std + model.y_mean;
  });
}

// ─── Evaluation metrics ───────────────────────────────────────────────────────

function classificationMetrics(yTrue, yPred, classes) {
  const n = yTrue.length;
  if (n === 0) return { n: 0, note: 'no samples' };
  const cm = {};
  for (const c of classes) cm[String(c)] = Object.fromEntries(classes.map(cc => [String(cc), 0]));
  let correct = 0;
  for (let i = 0; i < n; i++) {
    const t = String(yTrue[i]);
    const p = String(yPred[i]);
    if (!cm[t]) cm[t] = Object.fromEntries(classes.map(cc => [String(cc), 0]));
    if (!cm[t][p] && cm[t][p] !== 0) cm[t][p] = 0;
    cm[t][p] += 1;
    if (t === p) correct++;
  }
  const accuracy = round(correct / n, 4);

  const perClass = {};
  let macroF1 = 0, macroP = 0, macroR = 0, macroN = 0;
  let balAccSum = 0, balAccN = 0;
  for (const c of classes) {
    const cs = String(c);
    const tp = cm[cs]?.[cs] ?? 0;
    const fp = sum(classes.map(cc => String(cc) === cs ? 0 : (cm[String(cc)]?.[cs] ?? 0)));
    const fn = sum(classes.map(cc => String(cc) === cs ? 0 : (cm[cs]?.[String(cc)] ?? 0)));
    const support = tp + fn;
    const prec = tp + fp > 0 ? tp / (tp + fp) : 0;
    const rec  = support > 0 ? tp / support   : 0;
    const f1   = prec + rec > 0 ? 2 * prec * rec / (prec + rec) : 0;
    perClass[cs] = { precision: round(prec, 4), recall: round(rec, 4), f1: round(f1, 4), support };
    macroP += prec; macroR += rec; macroF1 += f1; macroN++;
    if (support > 0) { balAccSum += rec; balAccN++; }
  }

  const class_counts = {};
  for (const y of yTrue) class_counts[String(y)] = (class_counts[String(y)] ?? 0) + 1;
  const predicted_class_distribution = {};
  for (const y of yPred) predicted_class_distribution[String(y)] = (predicted_class_distribution[String(y)] ?? 0) + 1;

  return {
    n,
    accuracy,
    balanced_accuracy: balAccN > 0 ? round(balAccSum / balAccN, 4) : null,
    precision_macro:   macroN > 0 ? round(macroP / macroN, 4) : null,
    recall_macro:      macroN > 0 ? round(macroR / macroN, 4) : null,
    f1_macro:          macroN > 0 ? round(macroF1 / macroN, 4) : null,
    per_class:         perClass,
    confusion_matrix:  cm,
    class_counts,
    predicted_class_distribution,
  };
}

function binaryMetrics(yTrue, yPred) {
  const m = classificationMetrics(yTrue, yPred, ['true', 'false']);
  // Re-key with boolean / string flexibility
  const tp = m.confusion_matrix?.true?.true ?? 0;
  const fp = m.confusion_matrix?.false?.true ?? 0;
  const fn = m.confusion_matrix?.true?.false ?? 0;
  const tn = m.confusion_matrix?.false?.false ?? 0;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall    = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1        = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const specificity = tn + fp > 0 ? tn / (tn + fp) : 0;
  const balAcc    = (recall + specificity) / 2;
  return {
    ...m,
    precision: round(precision, 4),
    recall:    round(recall, 4),
    f1:        round(f1, 4),
    specificity: round(specificity, 4),
    balanced_accuracy: round(balAcc, 4),
    true_positive: tp, false_positive: fp, true_negative: tn, false_negative: fn,
  };
}

function regressionMetrics(yTrue, yPred) {
  const n = yTrue.length;
  if (n === 0) return { n: 0, note: 'no samples' };
  const errs = yTrue.map((t, i) => t - yPred[i]);
  const mae  = mean(errs.map(Math.abs));
  const rmse = Math.sqrt(mean(errs.map(e => e * e)));
  const yMean = mean(yTrue);
  const ssTot = sum(yTrue.map(t => (t - yMean) ** 2));
  const ssRes = sum(errs.map(e => e * e));
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : null;
  const safeMape = mean(yTrue.map((t, i) =>
    Math.abs(t) > 1e-9 ? Math.abs((t - yPred[i]) / t) : null
  ).filter(v => v != null));
  return {
    n,
    mae:    round(mae, 4),
    rmse:   round(rmse, 4),
    r2:     r2 != null ? round(r2, 4) : null,
    mape:   Number.isFinite(safeMape) ? round(safeMape, 4) : null,
    mean_actual:    round(yMean, 2),
    mean_predicted: round(mean(yPred), 2),
  };
}

// ─── Task training orchestration ──────────────────────────────────────────────

function pickLabels(rows, task) {
  return rows.map(r => task.target(r));
}

function filterLabeled(rows, labels) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (labels[i] != null && labels[i] !== undefined && !(typeof labels[i] === 'number' && Number.isNaN(labels[i]))) {
      out.push({ row: rows[i], y: labels[i] });
    }
  }
  return out;
}

function checkFeasibility(task, trainLabeled, valLabeled, testLabeled) {
  const issues = [];
  const trainN = trainLabeled.length;
  const valN   = valLabeled.length;
  const testN  = testLabeled.length;

  if (trainN + valN + testN < MIN_ROWS_TOTAL) {
    issues.push({ reason: 'insufficient_total_history', min: MIN_ROWS_TOTAL, have: trainN + valN + testN });
  }
  if (trainN < MIN_TRAIN_ROWS) issues.push({ reason: 'insufficient_train_rows', min: MIN_TRAIN_ROWS, have: trainN });
  if (valN   < MIN_VAL_ROWS)   issues.push({ reason: 'insufficient_validation_rows', min: MIN_VAL_ROWS, have: valN });
  if (testN  < MIN_TEST_ROWS)  issues.push({ reason: 'insufficient_test_rows', min: MIN_TEST_ROWS, have: testN });

  if (task.kind === 'classification_multiclass' || task.kind === 'classification_binary') {
    const counts = {};
    for (const { y } of trainLabeled) counts[String(y)] = (counts[String(y)] ?? 0) + 1;
    const insufficient = Object.entries(counts).filter(([, c]) => c < MIN_ROWS_PER_CLASS);
    if (insufficient.length > 0) {
      issues.push({ reason: 'insufficient_rows_per_class', min: MIN_ROWS_PER_CLASS, per_class: counts });
    }
    // Also check at least 2 classes present
    if (Object.keys(counts).length < 2) {
      issues.push({ reason: 'single_class_in_training', counts });
    }
  }
  return issues;
}

function encodeClassLabel(y, classes) {
  // For multiclass OvR we just pass the string form.
  return String(y);
}

function fitCandidate(cand, X, y, task, pre) {
  if (cand.family === 'logreg') {
    if (task.kind === 'classification_binary') {
      const yBin = y.map(v => (v === true || v === 'true' || v === 1) ? 1 : 0);
      return fitLogisticBinary(X, yBin, { l2: cand.l2 });
    }
    // multiclass
    const classes = [...new Set(y.map(String))];
    const model = fitLogisticMulticlass(X, y.map(String), classes, { l2: cand.l2 });
    return model;
  }
  if (cand.family === 'ridge') {
    return fitRidge(X, y.map(Number), { alpha: cand.alpha });
  }
  throw new Error(`Unknown family: ${cand.family}`);
}

function predictCandidate(model, X, task) {
  if (!model) return { predictions: X.map(() => null), probabilities: null };
  if (model.family === 'logreg_binary') {
    const probs = predictLogisticBinary(model, X);
    const predictions = probs.map(p => p >= 0.5);
    return { predictions, probabilities: probs.map(p => ({ true: round(p, 4), false: round(1 - p, 4) })) };
  }
  if (model.family === 'logreg_multiclass') {
    const { predictions, probabilities } = predictLogisticMulticlass(model, X);
    return { predictions, probabilities };
  }
  if (model.family === 'ridge') {
    return { predictions: predictRidge(model, X), probabilities: null };
  }
  return { predictions: X.map(() => null), probabilities: null };
}

function evalPredictions(yTrue, yPred, task) {
  if (task.kind === 'classification_multiclass') {
    return classificationMetrics(yTrue.map(String), yPred.map(String), task.classes.map(String));
  }
  if (task.kind === 'classification_binary') {
    return binaryMetrics(yTrue.map(v => String(v === true || v === 'true' || v === 1)),
                         yPred.map(v => String(v === true || v === 'true' || v === 1)));
  }
  return regressionMetrics(yTrue.map(Number), yPred.map(Number));
}

function pickChampionMetricValue(metrics, task) {
  return metrics?.[task.champion_metric] ?? null;
}

function compareChampionValues(a, b, direction) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return direction === 'min' ? (b - a) : (a - b); // positive means a is better
}

/** Train and evaluate a single task, writing all artifacts. */
export function trainTaskModel({ task: taskName, overwrite = true } = {}) {
  const task = TASKS[taskName];
  if (!task) throw new Error(`Unknown task: ${taskName}. Known: ${Object.keys(TASKS).join(', ')}`);

  const taskDir = join(TASKS_DIR, taskName);
  mkdirSync(taskDir, { recursive: true });

  const statusPath = join(taskDir, 'training_status.json');
  const attempted_at = nowISO();

  const trainRows = readJsonlSafe(TRAIN_JSONL);
  const valRows   = readJsonlSafe(VAL_JSONL);
  const testRows  = readJsonlSafe(TEST_JSONL);

  const trainY = pickLabels(trainRows, task);
  const valY   = pickLabels(valRows, task);
  const testY  = pickLabels(testRows, task);

  const trainLabeled = filterLabeled(trainRows, trainY);
  const valLabeled   = filterLabeled(valRows, valY);
  const testLabeled  = filterLabeled(testRows, testY);

  const allLabeled = [...trainLabeled, ...valLabeled, ...testLabeled];
  const rows_available = trainRows.length + valRows.length + testRows.length;
  const rows_eligible  = allLabeled.length;

  // Always compute a baseline if we have any labeled rows
  let baselineModel = null, baselineKind = null, baselineMetrics = null;
  if (rows_eligible >= 1) {
    if (task.kind === 'regression') {
      baselineModel = fitMeanBaseline(allLabeled.map(r => r.y));
      baselineKind  = 'mean_predictor';
      baselineMetrics = {
        train: regressionMetrics(trainLabeled.map(r => r.y), trainLabeled.map(() => baselineModel.mean)),
        validation: regressionMetrics(valLabeled.map(r => r.y), valLabeled.map(() => baselineModel.mean)),
        test:       regressionMetrics(testLabeled.map(r => r.y), testLabeled.map(() => baselineModel.mean)),
      };
    } else {
      baselineModel = fitMajorityClassBaseline(allLabeled.map(r => r.y));
      baselineKind  = 'majority_class';
      baselineMetrics = {
        train:      evalPredictions(trainLabeled.map(r => r.y), trainLabeled.map(() => baselineModel.majority_class), task),
        validation: evalPredictions(valLabeled.map(r => r.y),   valLabeled.map(()   => baselineModel.majority_class), task),
        test:       evalPredictions(testLabeled.map(r => r.y),  testLabeled.map(()  => baselineModel.majority_class), task),
      };
    }
    writeJson(join(taskDir, 'baseline_metrics.json'), {
      schema_version: MODEL_SCHEMA_VERSION,
      task: taskName,
      attempted_at,
      baseline_kind: baselineKind,
      baseline_model: baselineModel,
      metrics: baselineMetrics,
    });
  }

  // Feasibility for champion training
  const issues = checkFeasibility(task, trainLabeled, valLabeled, testLabeled);

  if (issues.length > 0) {
    const status = {
      schema_version:         MODEL_SCHEMA_VERSION,
      task:                   taskName,
      attempted_at,
      rows_available,
      rows_eligible,
      rows_train:             trainLabeled.length,
      rows_validation:        valLabeled.length,
      rows_test:              testLabeled.length,
      class_distribution:     task.kind !== 'regression' ? Object.fromEntries(
        Object.entries(
          allLabeled.reduce((acc, r) => {
            acc[String(r.y)] = (acc[String(r.y)] ?? 0) + 1; return acc;
          }, {})
        )
      ) : null,
      target_summary:         task.kind === 'regression' && allLabeled.length > 0 ? {
        n: allLabeled.length,
        mean: round(mean(allLabeled.map(r => r.y)), 2),
        min:  Math.min(...allLabeled.map(r => r.y)),
        max:  Math.max(...allLabeled.map(r => r.y)),
      } : null,
      status:                 baselineModel ? 'baseline_only' : 'insufficient_history',
      reason:                 'Feasibility gate not met for champion training',
      issues,
      candidate_models_attempted: [],
      champion_selected:      baselineModel ? `baseline_${baselineKind}` : null,
      baseline_exists:        !!baselineModel,
      notes:                  'Baseline computed but champion models skipped. Re-run after more graded history accumulates.',
    };
    writeJson(statusPath, status);
    writeJson(join(taskDir, 'champion.json'), {
      schema_version: MODEL_SCHEMA_VERSION,
      task: taskName,
      is_baseline: true,
      baseline_kind: baselineKind,
      baseline_model: baselineModel,
      champion_metric: task.champion_metric,
      champion_metric_value: baselineMetrics && baselineMetrics.validation ? pickChampionMetricValue(baselineMetrics.validation, task) : null,
      notes: 'Champion is the baseline because champion training was skipped',
    });
    writeJson(join(taskDir, 'model_card.json'), {
      schema_version:  MODEL_SCHEMA_VERSION,
      task:             taskName,
      last_updated:     nowISO(),
      champion:         { is_baseline: true, kind: baselineKind },
      notes:            'Insufficient history; champion equals baseline',
      data_window:      { train: trainLabeled.length, validation: valLabeled.length, test: testLabeled.length },
    });
    return status;
  }

  // ── Full training path ────────────────────────────────────────────────────
  const pre = fitPreprocess(trainLabeled.map(r => r.row));
  writeJson(join(taskDir, 'preprocess_config.json'), {
    schema_version:       MODEL_SCHEMA_VERSION,
    task:                  taskName,
    fields_used:           pre.fields_used,
    columns:               pre.columns,
    imputations:           pre.imputations,
    category_maps:         pre.categoryMaps,
    scalers:               pre.scalers,
    sparsity_drop_threshold: SPARSITY_DROP_THRESHOLD,
    metadata_allowlist:    METADATA_FEATURES_ALLOWLIST,
  });

  const Xtrain = transformMatrix(trainLabeled.map(r => r.row), pre);
  const Xval   = transformMatrix(valLabeled.map(r => r.row),   pre);
  const Xtest  = transformMatrix(testLabeled.map(r => r.row),  pre);
  const yTrain = trainLabeled.map(r => r.y);
  const yVal   = valLabeled.map(r => r.y);
  const yTest  = testLabeled.map(r => r.y);

  // Fit every candidate
  const candidateResults = [];
  for (const cand of task.candidates) {
    let model, valPred, valMetrics;
    try {
      model = fitCandidate(cand, Xtrain, yTrain, task, pre);
      const p = predictCandidate(model, Xval, task);
      valPred = p.predictions;
      valMetrics = evalPredictions(yVal, valPred, task);
    } catch (err) {
      candidateResults.push({ name: cand.name, family: cand.family, error: err.message });
      continue;
    }
    candidateResults.push({
      name: cand.name,
      family: cand.family,
      params: { l2: cand.l2, alpha: cand.alpha },
      validation: valMetrics,
      champion_metric_value: pickChampionMetricValue(valMetrics, task),
      model,
    });
  }

  // Include baseline as a candidate
  const baselineValMetrics = baselineMetrics.validation;
  candidateResults.push({
    name: `baseline_${baselineKind}`,
    family: baselineKind,
    validation: baselineValMetrics,
    champion_metric_value: pickChampionMetricValue(baselineValMetrics, task),
    is_baseline: true,
  });

  // Champion selection
  const finite = candidateResults.filter(c => c.champion_metric_value != null && !c.error);
  finite.sort((a, b) => compareChampionValues(a.champion_metric_value, b.champion_metric_value, task.champion_direction));
  const champion = finite[0] ?? null;

  // Evaluate champion on test
  let testMetrics = null, testPredictions = null, championModel = null;
  if (champion) {
    if (champion.is_baseline) {
      if (task.kind === 'regression') {
        testPredictions = testLabeled.map(() => baselineModel.mean);
        testMetrics = regressionMetrics(yTest, testPredictions);
      } else {
        testPredictions = testLabeled.map(() => baselineModel.majority_class);
        testMetrics = evalPredictions(yTest, testPredictions, task);
      }
    } else {
      championModel = champion.model;
      const p = predictCandidate(championModel, Xtest, task);
      testPredictions = p.predictions;
      testMetrics = evalPredictions(yTest, testPredictions, task);
      // save model weights
      writeJson(join(taskDir, 'model.json'), {
        schema_version: MODEL_SCHEMA_VERSION,
        task: taskName,
        candidate: champion.name,
        family: champion.family,
        params: champion.params,
        model: championModel,
      });
      // feature importance
      writeJson(join(taskDir, 'feature_importance.json'), buildFeatureImportance(championModel, pre));
    }
  }

  // Save predictions
  writeJson(join(taskDir, 'predictions_validation.json'), {
    schema_version: MODEL_SCHEMA_VERSION,
    task: taskName,
    champion: champion?.name ?? null,
    rows: valLabeled.map((r, i) => ({
      trading_date: r.row.trading_date,
      actual:       r.y,
      predicted:    (predictCandidate(championModel ?? baselineModel, [Xval[i]], task).predictions[0]) ?? null,
    })),
  });
  writeJson(join(taskDir, 'predictions_test.json'), {
    schema_version: MODEL_SCHEMA_VERSION,
    task: taskName,
    champion: champion?.name ?? null,
    rows: testLabeled.map((r, i) => ({
      trading_date: r.row.trading_date,
      actual:       r.y,
      predicted:    testPredictions?.[i] ?? null,
    })),
  });

  // Save champion manifest
  writeJson(join(taskDir, 'champion.json'), {
    schema_version: MODEL_SCHEMA_VERSION,
    task: taskName,
    is_baseline: champion?.is_baseline === true,
    family: champion?.family ?? null,
    candidate_name: champion?.name ?? null,
    champion_metric: task.champion_metric,
    validation_metric_value: champion?.champion_metric_value ?? null,
    test_metrics: testMetrics,
  });

  writeJson(join(taskDir, 'metrics.json'), {
    schema_version: MODEL_SCHEMA_VERSION,
    task: taskName,
    champion_name: champion?.name ?? null,
    champion_metric: task.champion_metric,
    validation: champion?.validation ?? null,
    test: testMetrics,
    all_candidates: candidateResults.map(c => ({
      name: c.name, family: c.family, params: c.params ?? null,
      validation: c.validation, champion_metric_value: c.champion_metric_value,
      error: c.error ?? null, is_baseline: c.is_baseline ?? false,
    })),
  });

  if (task.kind !== 'regression') {
    writeJson(join(taskDir, 'confusion_matrix.json'), {
      schema_version: MODEL_SCHEMA_VERSION,
      task: taskName,
      validation: champion?.validation?.confusion_matrix ?? null,
      test:       testMetrics?.confusion_matrix ?? null,
    });
  }

  writeJson(join(taskDir, 'model_card.json'), {
    schema_version:  MODEL_SCHEMA_VERSION,
    task:             taskName,
    last_updated:     nowISO(),
    kind:             task.kind,
    champion: {
      name:           champion?.name ?? null,
      family:         champion?.family ?? null,
      is_baseline:    champion?.is_baseline === true,
      metric_name:    task.champion_metric,
      validation:     champion?.champion_metric_value ?? null,
    },
    data_window: {
      train: trainLabeled.length,
      validation: valLabeled.length,
      test: testLabeled.length,
    },
    test_metrics:     testMetrics,
    feature_count:    pre.columns.length,
    notes: 'SHADOW-MODE artifact. Rules engine is still production source of truth.',
  });

  const status = {
    schema_version: MODEL_SCHEMA_VERSION,
    task: taskName,
    attempted_at,
    rows_available,
    rows_eligible,
    rows_train: trainLabeled.length,
    rows_validation: valLabeled.length,
    rows_test: testLabeled.length,
    class_distribution: task.kind !== 'regression' ? Object.fromEntries(
      Object.entries(
        allLabeled.reduce((acc, r) => { acc[String(r.y)] = (acc[String(r.y)] ?? 0) + 1; return acc; }, {})
      )
    ) : null,
    status: 'trained',
    reason: null,
    candidate_models_attempted: candidateResults.map(c => c.name),
    champion_selected: champion?.name ?? null,
    notes: 'Stage 5 shadow-mode training complete',
  };
  writeJson(statusPath, status);
  return status;
}

// ─── Feature importance ──────────────────────────────────────────────────────

function buildFeatureImportance(model, pre) {
  const columns = pre.columns.map(c => c.col);
  if (model.family === 'logreg_binary') {
    const rows = columns.map((name, i) => ({ feature: name, weight: round(model.weights[i], 6) }));
    rows.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
    return { family: model.family, top_positive: rows.filter(r => r.weight > 0).slice(0, 10),
             top_negative: rows.filter(r => r.weight < 0).slice(0, 10),
             intercept: round(model.intercept, 6),
             full_weights: rows };
  }
  if (model.family === 'logreg_multiclass') {
    const out = {};
    for (const [cls, bm] of Object.entries(model.binary)) {
      const rows = columns.map((name, i) => ({ feature: name, weight: round(bm.weights[i], 6) }));
      rows.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
      out[cls] = {
        intercept:   round(bm.intercept, 6),
        top_positive: rows.filter(r => r.weight > 0).slice(0, 10),
        top_negative: rows.filter(r => r.weight < 0).slice(0, 10),
      };
    }
    return { family: model.family, per_class: out };
  }
  if (model.family === 'ridge') {
    const rows = columns.map((name, i) => ({ feature: name, weight: round(model.weights[i], 6) }));
    rows.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
    return { family: model.family, top_positive: rows.filter(r => r.weight > 0).slice(0, 10),
             top_negative: rows.filter(r => r.weight < 0).slice(0, 10),
             intercept: round(model.intercept, 6),
             y_mean: round(model.y_mean, 4), y_std: round(model.y_std, 4),
             full_weights: rows };
  }
  return { family: 'unknown' };
}

// ─── Train all tasks ──────────────────────────────────────────────────────────

export function trainAllModels({ tasks = Object.keys(TASKS) } = {}) {
  mkdirSync(TASKS_DIR, { recursive: true });
  mkdirSync(SHADOW_DIR, { recursive: true });

  const perTask = {};
  for (const t of tasks) {
    try { perTask[t] = trainTaskModel({ task: t }); }
    catch (err) { perTask[t] = { task: t, status: 'error', error: err.message }; }
  }

  // Leaderboard
  const leaderboard = [];
  for (const [t, s] of Object.entries(perTask)) {
    const championPath = join(TASKS_DIR, t, 'champion.json');
    const championObj  = readJsonSafe(championPath) ?? {};
    leaderboard.push({
      task:               t,
      status:             s.status,
      champion_name:      championObj.candidate_name ?? championObj.baseline_kind ?? null,
      champion_family:    championObj.family ?? championObj.baseline_kind ?? null,
      is_baseline:        championObj.is_baseline === true,
      champion_metric:    championObj.champion_metric ?? null,
      validation_metric:  championObj.validation_metric_value ?? championObj.champion_metric_value ?? null,
      test_metrics:       championObj.test_metrics ?? null,
      rows_train:         s.rows_train ?? null,
      rows_validation:    s.rows_validation ?? null,
      rows_test:          s.rows_test ?? null,
    });
  }
  writeJson(LEADERBOARD_PATH, {
    schema_version: MODEL_SCHEMA_VERSION,
    last_updated:   nowISO(),
    tasks:          leaderboard,
  });

  const summary = {
    schema_version: MODEL_SCHEMA_VERSION,
    last_updated:   nowISO(),
    data_window: {
      train:      readJsonlSafe(TRAIN_JSONL).length,
      validation: readJsonlSafe(VAL_JSONL).length,
      test:       readJsonlSafe(TEST_JSONL).length,
    },
    per_task: perTask,
    rules_engine_is_production: true,
    shadow_mode_only:           true,
    notes: 'Stage 5 artifacts are shadow-mode only. The rules-based engine (Stages 1–3) remains the production source of truth.',
  };
  writeJson(SUMMARY_PATH, summary);

  // Manifest — list every file produced
  const files = [];
  for (const t of tasks) {
    const d = join(TASKS_DIR, t);
    for (const f of ['training_status.json','champion.json','metrics.json','baseline_metrics.json','feature_importance.json','confusion_matrix.json','model_card.json','preprocess_config.json','predictions_validation.json','predictions_test.json','model.json']) {
      const p = join(d, f);
      if (existsSync(p)) {
        try { files.push({ path: p, bytes: statSync(p).size }); }
        catch { files.push({ path: p, bytes: 0 }); }
      }
    }
  }
  const topFiles = [MANIFEST_PATH, SUMMARY_PATH, LEADERBOARD_PATH]
    .filter(p => existsSync(p))
    .map(p => ({ path: p, bytes: (() => { try { return statSync(p).size; } catch { return 0; } })() }));
  writeJson(MANIFEST_PATH, {
    schema_version: MODEL_SCHEMA_VERSION,
    last_updated:   nowISO(),
    models_dir:     MODELS_DIR,
    files:          [...topFiles, ...files],
  });

  return { success: true, summary };
}

// ─── Shadow inference ─────────────────────────────────────────────────────────

function findLatestPremarketDate() {
  if (!existsSync(REPORTS_DIR)) return null;
  const dates = readdirSync(REPORTS_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter(d => existsSync(join(REPORTS_DIR, d, 'premarket_nq.json')))
    .sort();
  return dates[dates.length - 1] ?? null;
}

/** Turn a premarket file + metadata into a dataset-row-shaped object. */
function buildShadowRowFromPremarket(date) {
  const pm = readJsonSafe(join(REPORTS_DIR, date, 'premarket_nq.json'));
  if (!pm) return null;
  // Use Stage 4's feature extractor so the feature surface is identical to training.
  const features = datasetCore.derivePremarketFeatures(pm);
  const metadata = {
    trading_date:       date,
    symbol:             pm.symbol ?? 'NQ1!',
    weekday:            (() => { const d = new Date(`${date}T12:00:00Z`); return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()]; })(),
    month:              date.slice(0, 7),
    model_version:      pm.model_version ?? null,
    indicator_version:  pm.indicator_version ?? null,
    prompt_version:     pm.prompt_version ?? null,
    calendar_source:    pm.calendar?.source ?? null,
    early_close:        pm.calendar?.early_close ?? null,
    run_time_et:        pm.run_time_et ?? null,
    run_time_utc:       pm.run_time_utc ?? null,
  };
  return { trading_date: date, symbol: metadata.symbol, metadata, features, labels: {} };
}

/** Run shadow predictions across every task's champion for the latest date. */
export function predictLatestShadow({ date } = {}) {
  mkdirSync(SHADOW_DIR, { recursive: true });
  const theDate = date ?? findLatestPremarketDate();
  if (!theDate) {
    const msg = { success: false, reason: 'no_premarket_reports_found' };
    writeJson(SHADOW_LATEST, { ...msg, last_updated: nowISO() });
    return msg;
  }
  const row = buildShadowRowFromPremarket(theDate);
  if (!row) {
    const msg = { success: false, reason: 'premarket_read_failed', trading_date: theDate };
    writeJson(SHADOW_LATEST, { ...msg, last_updated: nowISO() });
    return msg;
  }

  const predictions = {};
  for (const [taskName, task] of Object.entries(TASKS)) {
    const taskDir = join(TASKS_DIR, taskName);
    const champion = readJsonSafe(join(taskDir, 'champion.json'));
    const preConf  = readJsonSafe(join(taskDir, 'preprocess_config.json'));
    const modelObj = readJsonSafe(join(taskDir, 'model.json'));

    if (!champion) {
      predictions[taskName] = {
        task: taskName, status: 'no_champion_artifact',
        note: 'Run `tv model train` first.',
      };
      continue;
    }

    // Baseline path
    if (champion.is_baseline || !modelObj) {
      if (task.kind === 'regression') {
        predictions[taskName] = {
          task:         taskName,
          trading_date: theDate,
          timestamp:    nowISO(),
          is_baseline:  true,
          family:       champion.baseline_kind ?? 'mean_predictor',
          prediction:   round(champion.baseline_model?.mean ?? null, 4),
          probabilities: null,
          champion_metric: task.champion_metric,
          model_version: { model: 'baseline', indicator_version: row.metadata.indicator_version, prompt_version: row.metadata.prompt_version },
          shadow_mode:  true,
          note:         'BASELINE PREDICTION ONLY — rules engine remains production source of truth.',
        };
      } else {
        predictions[taskName] = {
          task:         taskName,
          trading_date: theDate,
          timestamp:    nowISO(),
          is_baseline:  true,
          family:       champion.baseline_kind ?? 'majority_class',
          prediction:   champion.baseline_model?.majority_class ?? null,
          probabilities: champion.baseline_model?.class_probs ?? null,
          champion_metric: task.champion_metric,
          model_version: { model: 'baseline', indicator_version: row.metadata.indicator_version, prompt_version: row.metadata.prompt_version },
          shadow_mode:  true,
          note:         'BASELINE PREDICTION ONLY — rules engine remains production source of truth.',
        };
      }
      continue;
    }

    // Champion model path
    if (!preConf || !preConf.columns) {
      predictions[taskName] = { task: taskName, status: 'missing_preprocess_config', note: 'Preprocess config not found; re-train.' };
      continue;
    }
    const pre = {
      fields_used:   preConf.fields_used,
      columns:       preConf.columns,
      imputations:   preConf.imputations,
      categoryMaps:  preConf.category_maps,
      scalers:       preConf.scalers,
    };
    const Xone = [transformRow(row, pre)];
    const { predictions: preds, probabilities: probs } = predictCandidate(modelObj.model, Xone, task);
    predictions[taskName] = {
      task:          taskName,
      trading_date:  theDate,
      timestamp:     nowISO(),
      is_baseline:   false,
      family:        modelObj.family,
      candidate:     modelObj.candidate,
      prediction:    preds[0] ?? null,
      probabilities: probs?.[0] ?? null,
      champion_metric: task.champion_metric,
      model_version: { model: modelObj.candidate, indicator_version: row.metadata.indicator_version, prompt_version: row.metadata.prompt_version },
      shadow_mode:   true,
      note:          'SHADOW-MODE PREDICTION — rules engine remains production source of truth.',
    };
  }

  const out = {
    schema_version:              MODEL_SCHEMA_VERSION,
    last_updated:                nowISO(),
    trading_date:                theDate,
    symbol:                      row.symbol,
    shadow_mode:                 true,
    rules_engine_is_production:  true,
    note: 'These predictions DO NOT drive any live decisions. They are written for audit only and compared against the rules-engine bias brief.',
    predictions,
  };
  writeJson(SHADOW_LATEST, out);

  // Append to prediction_history.jsonl
  try {
    appendFileSync(SHADOW_HISTORY, JSON.stringify(out) + '\n');
  } catch { /* non-fatal */ }

  return { success: true, ...out };
}

// ─── Read-only getters ────────────────────────────────────────────────────────

function readOrCompute(path, compute) {
  if (existsSync(path)) {
    try { return { success: true, ...JSON.parse(readFileSync(path, 'utf8')) }; }
    catch { /* fallthrough */ }
  }
  return { success: true, ...compute(), note: 'computed on demand (file missing)' };
}

export function getModelSummary()     { return readOrCompute(SUMMARY_PATH,     () => ({ note: 'run `tv model train` first' })); }
export function getModelLeaderboard() { return readOrCompute(LEADERBOARD_PATH, () => ({ note: 'run `tv model train` first' })); }
export function getModelManifest()    { return readOrCompute(MANIFEST_PATH,    () => ({ note: 'run `tv model train` first' })); }

export function getLatestShadow()     { return readOrCompute(SHADOW_LATEST,    () => ({ note: 'run `tv model shadow-predict` first' })); }

export function getTrainingStatus({ task } = {}) {
  if (task) {
    return readOrCompute(join(TASKS_DIR, task, 'training_status.json'),
                         () => ({ task, note: 'not trained yet' }));
  }
  // All tasks
  const out = {};
  for (const t of Object.keys(TASKS)) {
    out[t] = readJsonSafe(join(TASKS_DIR, t, 'training_status.json')) ?? { task: t, status: 'not_trained' };
  }
  return { success: true, schema_version: MODEL_SCHEMA_VERSION, last_updated: nowISO(), tasks: out };
}

export function inspectTask({ task } = {}) {
  if (!TASKS[task]) return { success: false, error: `Unknown task: ${task}. Known: ${Object.keys(TASKS).join(', ')}` };
  const taskDir = join(TASKS_DIR, task);
  const files = {
    training_status:    readJsonSafe(join(taskDir, 'training_status.json')),
    champion:           readJsonSafe(join(taskDir, 'champion.json')),
    metrics:            readJsonSafe(join(taskDir, 'metrics.json')),
    baseline_metrics:   readJsonSafe(join(taskDir, 'baseline_metrics.json')),
    feature_importance: readJsonSafe(join(taskDir, 'feature_importance.json')),
    confusion_matrix:   readJsonSafe(join(taskDir, 'confusion_matrix.json')),
    model_card:         readJsonSafe(join(taskDir, 'model_card.json')),
  };
  return { success: true, task, files };
}

export function listTasks() {
  return { success: true, tasks: Object.keys(TASKS), configs: TASKS };
}
