/**
 * Stage 4 — NQ Daily Bias Dataset / Feature-Store Layer
 *
 * Deterministic local dataset preparation. No ML. No training. No fitting.
 * Pure data-transformation over the artifacts written by Stages 1–3.
 *
 * ────────────────────────────────────────────────────────────────────────
 * INPUTS (source of truth)
 *   ~/.tradingview-mcp/reports/YYYY-MM-DD/premarket_nq.json
 *   ~/.tradingview-mcp/reports/YYYY-MM-DD/postclose_nq.json
 *   ~/.tradingview-mcp/performance/daily_grades.jsonl
 *
 * OUTPUTS (all regenerable via rebuildDataset())
 *   ~/.tradingview-mcp/datasets/
 *     dataset_manifest.json        — list of every file written + sizes
 *     dataset_summary.json         — headline counts / coverage / lineage
 *     schema.json                  — canonical row shape
 *     feature_dictionary.json      — every feature, typed + documented
 *     label_dictionary.json        — every label, typed + documented
 *     leakage_audit.json           — per-field leakage status
 *     quality_report.json          — null rates, sparsity, eligibility
 *     nq_daily_bias_dataset.jsonl  — every canonical row (including dups)
 *     nq_daily_bias_dataset.csv
 *     latest_only_dataset.jsonl    — deduped latest-per-date
 *     latest_only_dataset.csv
 *     training_ready_dataset.jsonl — latest-per-date filtered by eligibility
 *     training_ready_dataset.csv
 *     sample_rows.json             — trimmed representative rows
 *     splits/
 *       train.jsonl + .csv         — oldest 70%
 *       validation.jsonl + .csv    — next 15%
 *       test.jsonl + .csv          — newest 15%
 *       split_manifest.json
 *       split_summary.json
 *
 * DUPLICATE POLICY
 *   Canonical dataset preserves every row (including superseded grades)
 *   for full audit. Summaries, splits, and training artifacts use the
 *   latest record per trading_date (latest graded_at_utc wins).
 *
 * LEAKAGE POLICY
 *   Only fields whose value was knowable at the premarket report time
 *   are placed under `features`. Post-close and grading outputs live
 *   under `labels`. Metadata (versions, calendar) lives under `metadata`.
 *   Every field is categorized in leakage_audit.json.
 *
 * SCHEMA
 *   Every canonical row has:
 *     { schema_version, trading_date, symbol, metadata, features,
 *       labels, quality, lineage }
 * ────────────────────────────────────────────────────────────────────────
 */

import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ─── Paths ────────────────────────────────────────────────────────────────────

const HOME_DIR        = join(homedir(), '.tradingview-mcp');
const REPORTS_DIR     = join(HOME_DIR, 'reports');
const PERFORMANCE_DIR = join(HOME_DIR, 'performance');
const GRADES_LOG      = join(PERFORMANCE_DIR, 'daily_grades.jsonl');
const DATASETS_DIR    = join(HOME_DIR, 'datasets');
const SPLITS_DIR      = join(DATASETS_DIR, 'splits');

const OUT = {
  manifest:     join(DATASETS_DIR, 'dataset_manifest.json'),
  summary:      join(DATASETS_DIR, 'dataset_summary.json'),
  schema:       join(DATASETS_DIR, 'schema.json'),
  featuresDict: join(DATASETS_DIR, 'feature_dictionary.json'),
  labelsDict:   join(DATASETS_DIR, 'label_dictionary.json'),
  leakage:      join(DATASETS_DIR, 'leakage_audit.json'),
  quality:      join(DATASETS_DIR, 'quality_report.json'),
  canonicalJsonl:   join(DATASETS_DIR, 'nq_daily_bias_dataset.jsonl'),
  canonicalCsv:     join(DATASETS_DIR, 'nq_daily_bias_dataset.csv'),
  latestJsonl:      join(DATASETS_DIR, 'latest_only_dataset.jsonl'),
  latestCsv:        join(DATASETS_DIR, 'latest_only_dataset.csv'),
  trainingJsonl:    join(DATASETS_DIR, 'training_ready_dataset.jsonl'),
  trainingCsv:      join(DATASETS_DIR, 'training_ready_dataset.csv'),
  sampleRows:   join(DATASETS_DIR, 'sample_rows.json'),
  trainJsonl:   join(SPLITS_DIR, 'train.jsonl'),
  trainCsv:     join(SPLITS_DIR, 'train.csv'),
  valJsonl:     join(SPLITS_DIR, 'validation.jsonl'),
  valCsv:       join(SPLITS_DIR, 'validation.csv'),
  testJsonl:    join(SPLITS_DIR, 'test.jsonl'),
  testCsv:      join(SPLITS_DIR, 'test.csv'),
  splitMfst:    join(SPLITS_DIR, 'split_manifest.json'),
  splitSum:     join(SPLITS_DIR, 'split_summary.json'),
};

// ─── Constants (tunable) ──────────────────────────────────────────────────────

export const DATASET_SCHEMA_VERSION        = 1;
export const DEFAULT_SPLIT_TRAIN_PCT       = 0.70;
export const DEFAULT_SPLIT_VAL_PCT         = 0.15;
export const MIN_FEATURE_COVERAGE          = 0.40;  // rows below this are ineligible
export const SEVERE_SPARSITY_THRESHOLD     = 0.80;  // feature with > 80% null → flagged in quality
export const DEFAULT_SAMPLE_COUNT          = 5;
export const CSV_ARRAY_JOIN                = ';';

// ─── Utility helpers ──────────────────────────────────────────────────────────

function nowISO() { return new Date().toISOString(); }

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function weekdayOf(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return WEEKDAY_NAMES[d.getUTCDay()];
}
function monthOf(dateStr) { return dateStr?.slice(0, 7) ?? null; }

/** Safe nested-path resolver: resolve(obj, 'a.b.c') */
function resolvePath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

function round(v, decimals = 4) {
  if (v == null || typeof v !== 'number' || Number.isNaN(v)) return v;
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** Parse "ATR:441.27 5d:356.85" → { atr: 441.27, atr_5d: 356.85 } */
function parseRegimeDetail(s) {
  if (!s) return { atr: null, atr_5d: null };
  const a = String(s).match(/ATR:([\d.]+)/);
  const b = String(s).match(/5d:([\d.]+)/);
  return {
    atr:    a ? parseFloat(a[1]) : null,
    atr_5d: b ? parseFloat(b[1]) : null,
  };
}

/** Parse "18.92 (NORMAL)" → { raw: 18.92, state: "NORMAL" }. Preserves null. */
function parseVixRaw(s) {
  if (!s) return { raw: null, state: null };
  const m = String(s).match(/^([\d.]+)\s*(?:\(([^)]+)\))?/);
  return { raw: m ? parseFloat(m[1]) : null, state: m && m[2] ? m[2] : null };
}

// ─── FEATURE / LABEL SPECS (single source of truth) ───────────────────────────
//
// Every field in the canonical dataset row is defined here. Schema,
// dictionaries, extraction, leakage audit, and quality metrics are all
// derived from these specs — so adding or changing a field is a one-line
// edit and every artifact stays consistent.

/** Every feature is KNOWABLE at premarket report time — no post-close info. */
export const FEATURE_SPEC = [
  // ── System predictions (the engine's own premarket calls) ───────────────
  { name: 'bias_called',               path: 'bias',                                    type: 'categorical', allowed: ['bullish','bearish','neutral'],                stage: 1,   desc: 'System premarket directional call' },
  { name: 'confidence',                path: 'confidence',                              type: 'int',                                                                 stage: 1,   desc: 'Absolute value of bias_total (0..9)' },
  { name: 'day_type_called',           path: 'day_type',                                type: 'categorical', allowed: ['trending','normal','range','inside','pending'], stage: 1, desc: 'System premarket day-type call' },
  { name: 'day_type_source',           path: 'day_type_source',                         type: 'categorical', allowed: ['dbe_probs','inferred_bias_regime','none'],    stage: '2.1', desc: 'How day_type_called was derived' },

  // ── Expected range (forward projection) ─────────────────────────────────
  { name: 'expected_range_low',        path: 'expected_range.low',                      type: 'float',                                                               stage: 1,     desc: 'Predicted session low' },
  { name: 'expected_range_high',       path: 'expected_range.high',                     type: 'float',                                                               stage: 1,     desc: 'Predicted session high' },
  { name: 'expected_range_points',     path: 'expected_range.points',                   type: 'int',                                                                 stage: 1,     desc: 'Predicted session range in points' },
  { name: 'expected_range_source',     path: 'expected_range.source',                   type: 'categorical', allowed: ['dbe_label','value_area','atr_derived','none'], stage: '2.1', desc: 'Which cascade tier produced expected_range' },
  { name: 'rth_open_hint',             path: 'expected_range.rth_open',                 type: 'float',                                                               stage: 1,     desc: 'RTH open label (null when not emitted)' },
  { name: 'ib_high_hint',              path: 'expected_range.ib_high',                  type: 'float',                                                               stage: 1,     desc: 'IB high label (null when not emitted)' },
  { name: 'ib_low_hint',               path: 'expected_range.ib_low',                   type: 'float',                                                               stage: 1,     desc: 'IB low label (null when not emitted)' },

  // ── Volatility regime (categorical + numeric) ───────────────────────────
  { name: 'volatility_regime',         path: 'volatility_regime',                       type: 'categorical', allowed: ['EXPANSION','CONTRACTION','NORMAL','UNKNOWN'], stage: 1,     desc: 'Premarket regime bucket from DBE' },
  { name: 'atr',                       derived: 'atr_from_regime_detail',               type: 'float',                                                               stage: 1,     desc: 'Current ATR, parsed from regime_detail' },
  { name: 'atr_5d',                    derived: 'atr5d_from_regime_detail',             type: 'float',                                                               stage: 1,     desc: '5-day average ATR, parsed from regime_detail' },

  // ── Moving averages / momentum ──────────────────────────────────────────
  { name: 'ema_20',                    path: 'indicator_snapshot.ema.ema20',            type: 'float',                                                               stage: 1,     desc: '20-period EMA' },
  { name: 'ema_50',                    path: 'indicator_snapshot.ema.ema50',            type: 'float',                                                               stage: 1,     desc: '50-period EMA' },
  { name: 'ema_200',                   path: 'indicator_snapshot.ema.ema200',           type: 'float',                                                               stage: 1,     desc: '200-period EMA' },
  { name: 'ema_stack',                 path: 'indicator_snapshot.ema.stack',            type: 'categorical',                                                         stage: 1,     desc: 'Textual description of EMA stack ordering' },
  { name: 'rsi_14',                    path: 'indicator_snapshot.rsi',                  type: 'float',                                                               stage: 1,     desc: 'RSI(14)' },
  { name: 'macd_hist',                 path: 'indicator_snapshot.macd_hist',            type: 'float',                                                               stage: 1,     desc: 'MACD histogram value' },
  { name: 'adx_14',                    path: 'indicator_snapshot.adx',                  type: 'float',                                                               stage: 1,     desc: 'ADX(14)' },

  // ── Prior day / overnight / value area ──────────────────────────────────
  { name: 'pdh',                       path: 'indicator_snapshot.prior_day.pdh',        type: 'float',                                                               stage: 1,     desc: 'Prior Day High' },
  { name: 'pdc',                       path: 'indicator_snapshot.prior_day.pdc',        type: 'float',                                                               stage: 1,     desc: 'Prior Day Close' },
  { name: 'pdl',                       path: 'indicator_snapshot.prior_day.pdl',        type: 'float',                                                               stage: 1,     desc: 'Prior Day Low' },
  { name: 'onh',                       path: 'indicator_snapshot.overnight.onh',        type: 'float',                                                               stage: 1,     desc: 'Overnight High' },
  { name: 'onl',                       path: 'indicator_snapshot.overnight.onl',        type: 'float',                                                               stage: 1,     desc: 'Overnight Low' },
  { name: 'vah',                       path: 'indicator_snapshot.value_area.vah',       type: 'float',                                                               stage: 1,     desc: 'Value Area High (~)' },
  { name: 'poc',                       path: 'indicator_snapshot.value_area.poc',       type: 'float',                                                               stage: 1,     desc: 'Point of Control (~)' },
  { name: 'val',                       path: 'indicator_snapshot.value_area.val',       type: 'float',                                                               stage: 1,     desc: 'Value Area Low (~)' },

  // ── Bias components (9 integers, typically -1/0/+1 each) ────────────────
  { name: 'bc_daily',                  path: 'indicator_snapshot.bias_components.daily',        type: 'int', stage: 1, desc: 'Daily trend bias component' },
  { name: 'bc_h4',                     path: 'indicator_snapshot.bias_components.h4',           type: 'int', stage: 1, desc: 'H4 trend bias component' },
  { name: 'bc_pd_location',            path: 'indicator_snapshot.bias_components.pd_location',  type: 'int', stage: 1, desc: 'Prior-day location bias component' },
  { name: 'bc_overnight',              path: 'indicator_snapshot.bias_components.overnight',    type: 'int', stage: 1, desc: 'Overnight direction bias component' },
  { name: 'bc_dxy',                    path: 'indicator_snapshot.bias_components.dxy',          type: 'int', stage: 1, desc: 'DXY signal bias component' },
  { name: 'bc_ten_year',               path: 'indicator_snapshot.bias_components.ten_year',     type: 'int', stage: 1, desc: '10Y yield signal bias component' },
  { name: 'bc_rel_strength',           path: 'indicator_snapshot.bias_components.rel_strength', type: 'int', stage: 1, desc: 'Relative-strength bias component' },
  { name: 'bc_session',                path: 'indicator_snapshot.bias_components.session',      type: 'int', stage: 1, desc: 'Session-pattern bias component' },
  { name: 'bc_vwap',                   path: 'indicator_snapshot.bias_components.vwap',         type: 'int', stage: 1, desc: 'VWAP bias component' },
  { name: 'bias_total',                path: 'indicator_snapshot.bias_total',                   type: 'int', stage: 1, desc: 'Sum of all 9 bias components (signed)' },

  // ── Day-type probabilities (from DBE — may all be 0 outside session) ────
  { name: 'day_prob_trend',            path: 'indicator_snapshot.day_type_probs.trend',         type: 'float', stage: 1, desc: 'DBE-reported trending-day probability' },
  { name: 'day_prob_normal',           path: 'indicator_snapshot.day_type_probs.normal',        type: 'float', stage: 1, desc: 'DBE-reported normal-day probability' },
  { name: 'day_prob_range',            path: 'indicator_snapshot.day_type_probs.range',         type: 'float', stage: 1, desc: 'DBE-reported range-day probability' },
  { name: 'day_prob_inside',           path: 'indicator_snapshot.day_type_probs.inside',        type: 'float', stage: 1, desc: 'DBE-reported inside-day probability' },

  // ── Gap analysis ────────────────────────────────────────────────────────
  { name: 'gap_direction',             path: 'gap_analysis.direction',                          type: 'categorical', allowed: ['up','down','flat','N/A'], stage: 1, desc: 'Premarket gap direction' },
  { name: 'gap_category',              path: 'gap_analysis.category',                           type: 'categorical',                                       stage: 1, desc: 'Premarket gap size category' },
  { name: 'gap_points',                path: 'gap_analysis.points',                             type: 'float',                                             stage: 1, desc: 'Premarket gap in points' },
  { name: 'gap_atr_pct',               path: 'gap_analysis.atr_pct',                            type: 'float',                                             stage: 1, desc: 'Premarket gap as percent of ATR' },

  // ── Sessions (Asia / London) ────────────────────────────────────────────
  { name: 'asia_high',                 path: 'session_structure.asia.high',                     type: 'float', stage: 1, desc: 'Asia session high' },
  { name: 'asia_low',                  path: 'session_structure.asia.low',                      type: 'float', stage: 1, desc: 'Asia session low' },
  { name: 'london_high',               path: 'session_structure.london.high',                   type: 'float', stage: 1, desc: 'London session high' },
  { name: 'london_low',                path: 'session_structure.london.low',                    type: 'float', stage: 1, desc: 'London session low' },
  { name: 'session_pattern',           path: 'session_structure.pattern',                       type: 'categorical', stage: 1, desc: 'DBE session pattern label (P1..P4, etc.)' },

  // ── Intermarket ─────────────────────────────────────────────────────────
  { name: 'dxy_pct',                   path: 'intermarket.dxy_pct',                             type: 'float', stage: 1, desc: 'DXY % change at premarket time' },
  { name: 'ten_year_pct',              path: 'intermarket.ten_year_pct',                        type: 'float', stage: 1, desc: '10Y yield % change at premarket time' },
  { name: 'es_pct',                    path: 'intermarket.es_pct',                              type: 'float', stage: 1, desc: 'ES % change at premarket time' },
  { name: 'vix',                       path: 'intermarket.vix',                                 type: 'float', stage: 1, desc: 'VIX numeric value' },
  { name: 'vix_state',                 derived: 'vix_state_from_raw',                           type: 'categorical', stage: 1, desc: 'VIX regime label parsed from "18.92 (NORMAL)"' },

  // ── Key level counts (derived from key_levels array) ────────────────────
  { name: 'key_level_count',           derived: 'key_level_count',                              type: 'int',   stage: 1, desc: 'Total number of DBE key levels emitted' },

  // ── Data quality ────────────────────────────────────────────────────────
  { name: 'dq_dbe_present',            path: 'data_quality.dbe_indicator_present',              type: 'bool',  stage: 1, desc: 'DBE indicator was present at report time' },
  { name: 'dq_table_rows',             path: 'data_quality.table_rows',                         type: 'int',   stage: 1, desc: 'Row count in the DBE table' },
  { name: 'dq_labels_count',           path: 'data_quality.labels_count',                       type: 'int',   stage: 1, desc: 'Number of labels read' },
  { name: 'dq_lines_count',            path: 'data_quality.lines_count',                        type: 'int',   stage: 1, desc: 'Number of horizontal lines read' },
  { name: 'dq_boxes_count',            path: 'data_quality.boxes_count',                        type: 'int',   stage: 1, desc: 'Number of FVG boxes read' },
  { name: 'dq_fallback_used',          path: 'data_quality.fallback_used',                      type: 'bool',  stage: 1, desc: 'Whether study_values fallback was required' },
  { name: 'dq_source',                 path: 'data_quality.source',                             type: 'categorical', allowed: ['dbe_indicator','study_values_fallback','none'], stage: 1, desc: 'Which data path produced the snapshot' },
  { name: 'dq_completeness',           path: 'data_quality.completeness',                       type: 'categorical', allowed: ['full','partial','none'], stage: 1, desc: 'DBE table completeness bucket' },
  { name: 'dq_quote_available',        path: 'data_quality.quote_available',                    type: 'bool',  stage: 1, desc: 'Whether quote_get returned data' },
];

/** Every label/target is POST-CLOSE truth. Must never leak into features. */
export const LABEL_SPEC = [
  // ── Realized session (from post-close report) ───────────────────────────
  { name: 'bias_actual',               from: 'postclose',  path: 'grading.bias_actual',                 type: 'categorical', allowed: ['bullish','bearish','neutral'],       desc: 'Actual realized directional bias' },
  { name: 'bias_correct',              from: 'postclose',  path: 'grading.bias_correct',                type: 'bool',                                                          desc: 'Did the premarket call match the actual?' },
  { name: 'day_type_actual',           from: 'postclose',  path: 'actual_day_type',                     type: 'categorical', allowed: ['trending','normal','range','inside'], desc: 'Actual day-type classification' },
  { name: 'day_type_correct',          from: 'postclose',  path: 'grading.day_type_correct',            type: 'bool',                                                          desc: 'Did day_type_called match actual?' },
  { name: 'actual_open',               from: 'postclose',  path: 'actual_session.open',                 type: 'float',                                                         desc: 'RTH session open' },
  { name: 'actual_high',               from: 'postclose',  path: 'actual_session.high',                 type: 'float',                                                         desc: 'RTH session high' },
  { name: 'actual_low',                from: 'postclose',  path: 'actual_session.low',                  type: 'float',                                                         desc: 'RTH session low' },
  { name: 'actual_close',              from: 'postclose',  path: 'actual_session.close',                type: 'float',                                                         desc: 'RTH session close' },
  { name: 'actual_range_points',       from: 'postclose',  path: 'actual_session.range_points',         type: 'int',                                                           desc: 'Realized RTH range in points' },
  { name: 'range_within_tolerance',    from: 'postclose',  path: 'grading.range_within_tolerance',      type: 'bool',                                                          desc: 'Actual range within ±15% of expected' },
  { name: 'range_estimate_error_points', from: 'postclose', path: 'grading.range_estimate_error_points', type: 'int',                                                          desc: 'Absolute range error in points' },
  { name: 'range_estimate_error_pct',  from: 'postclose',  path: 'grading.range_estimate_error_pct',    type: 'float',                                                         desc: 'Range error as fraction of expected' },
  { name: 'actual_volatility_regime',  from: 'postclose',  path: 'actual_volatility_regime',            type: 'categorical', allowed: ['EXPANSION','CONTRACTION','NORMAL','UNKNOWN'], desc: 'Regime as seen after RTH close' },

  // ── Grading outputs ─────────────────────────────────────────────────────
  { name: 'overall_grade',             from: 'grade',      path: 'overall_grade',            type: 'categorical', allowed: ['A','B','C','D','F','NG','?'], desc: 'Stage 2 letter grade' },
  { name: 'score_0_to_100',            from: 'grade',      path: 'score_0_to_100',           type: 'int',                                                  desc: 'Stage 2 weighted numeric score' },
  { name: 'failure_tags',              from: 'grade',      path: 'failure_tags',             type: 'array_string',                                         desc: 'Array of failure tags' },
  { name: 'partial_grade',             from: 'grade',      path: 'partial_grade',            type: 'bool',                                                 desc: 'Whether coverage < 1.0' },
  { name: 'coverage_pct',              from: 'grade',      path: 'coverage_pct',             type: 'float',                                                desc: 'Fraction of prediction surface graded' },

  // ── Helper binary targets (derived from labels above) ───────────────────
  { name: 'target_bias_up_day',        derived: 'is_bias_up',            type: 'bool', desc: 'Actual bias == bullish' },
  { name: 'target_bias_down_day',      derived: 'is_bias_down',          type: 'bool', desc: 'Actual bias == bearish' },
  { name: 'target_bias_neutral_day',   derived: 'is_bias_neutral',       type: 'bool', desc: 'Actual bias == neutral' },
  { name: 'target_trend_day',          derived: 'is_trend_day',          type: 'bool', desc: 'Actual day type == trending' },
  { name: 'target_range_day',          derived: 'is_range_day',          type: 'bool', desc: 'Actual day type == range' },
  { name: 'target_expansion_day',      derived: 'is_expansion_day',      type: 'bool', desc: 'Actual volatility regime == EXPANSION' },
  { name: 'target_good_grade',         derived: 'is_good_grade',         type: 'bool', desc: 'Overall grade A or B' },
  { name: 'target_bad_grade',          derived: 'is_bad_grade',          type: 'bool', desc: 'Overall grade D, F, or NG' },
  { name: 'target_range_in_tolerance', derived: 'is_range_in_tolerance', type: 'bool', desc: 'range_within_tolerance === true' },
];

const METADATA_FIELDS = [
  'trading_date', 'symbol', 'weekday', 'month',
  'model_version', 'indicator_version', 'prompt_version',
  'calendar_source', 'early_close',
  'run_time_et', 'run_time_utc',
  'graded_at_utc',
  // Backfill provenance (Stage: replay harness) — useful for Stage 5
  // to filter / downweight replay-derived rows vs live runs.
  'is_backfill', 'backfill_batch_id', 'replay_fidelity',
];

// ─── Derived feature resolvers ────────────────────────────────────────────────

const FEATURE_DERIVERS = {
  atr_from_regime_detail: pm => parseRegimeDetail(resolvePath(pm, 'indicator_snapshot.regime_detail')).atr,
  atr5d_from_regime_detail: pm => parseRegimeDetail(resolvePath(pm, 'indicator_snapshot.regime_detail')).atr_5d,
  vix_state_from_raw: pm => parseVixRaw(resolvePath(pm, 'intermarket.vix_raw')).state,
  key_level_count: pm => Array.isArray(pm?.key_levels) ? pm.key_levels.length : 0,
};

const LABEL_DERIVERS = {
  is_bias_up:            labels => labels.bias_actual === 'bullish',
  is_bias_down:          labels => labels.bias_actual === 'bearish',
  is_bias_neutral:       labels => labels.bias_actual === 'neutral',
  is_trend_day:          labels => labels.day_type_actual === 'trending',
  is_range_day:          labels => labels.day_type_actual === 'range',
  is_expansion_day:      labels => labels.actual_volatility_regime === 'EXPANSION',
  is_good_grade:         labels => labels.overall_grade === 'A' || labels.overall_grade === 'B',
  is_bad_grade:          labels => ['D','F','NG'].includes(labels.overall_grade),
  is_range_in_tolerance: labels => labels.range_within_tolerance === true,
};

// ─── Loaders / dedup ──────────────────────────────────────────────────────────

function readGradeLog() {
  if (!existsSync(GRADES_LOG)) return [];
  const text = readFileSync(GRADES_LOG, 'utf8');
  const out  = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip malformed */ }
  }
  return out;
}

function listReportDates() {
  if (!existsSync(REPORTS_DIR)) return [];
  return readdirSync(REPORTS_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
}

function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/**
 * Gather every source trio (premarket, postclose, grade) indexed by date.
 * Returns: [{ date, premarket, postclose, grade, allGrades }]
 *   where allGrades is every JSONL record for that date (for duplicate counting)
 *   and `grade` is the latest one (by graded_at_utc).
 */
export function loadAllSourceRecords() {
  const grades   = readGradeLog();
  const byDate   = new Map();

  // Collect grades by date
  for (const g of grades) {
    if (!g.trading_date) continue;
    if (!byDate.has(g.trading_date)) byDate.set(g.trading_date, { grades: [] });
    byDate.get(g.trading_date).grades.push(g);
  }

  // Add every date that has a postclose or premarket file (may not yet be graded)
  for (const date of listReportDates()) {
    if (!byDate.has(date)) byDate.set(date, { grades: [] });
  }

  const out = [];
  for (const [date, { grades: gList }] of byDate.entries()) {
    const pm = readJsonSafe(join(REPORTS_DIR, date, 'premarket_nq.json'));
    const pc = readJsonSafe(join(REPORTS_DIR, date, 'postclose_nq.json'));
    const latestGrade = gList.slice().sort(
      (a, b) => (b.graded_at_utc ?? '').localeCompare(a.graded_at_utc ?? '')
    )[0] ?? null;
    out.push({ date, premarket: pm, postclose: pc, grade: latestGrade, allGrades: gList });
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// ─── Feature / Label extraction ───────────────────────────────────────────────

export function derivePremarketFeatures(premarket) {
  const features = {};
  for (const spec of FEATURE_SPEC) {
    let v;
    if (spec.derived) {
      const fn = FEATURE_DERIVERS[spec.derived];
      v = fn ? fn(premarket ?? {}) : null;
    } else {
      v = resolvePath(premarket, spec.path);
    }
    features[spec.name] = v === undefined ? null : v;
  }
  return features;
}

export function deriveLabels({ postclose, grade }) {
  const labels = {};
  for (const spec of LABEL_SPEC) {
    if (spec.derived) continue; // filled after primary pass
    let v;
    if (spec.from === 'postclose') v = resolvePath(postclose, spec.path);
    else if (spec.from === 'grade') {
      v = resolvePath(grade, spec.path);
      // Fall back to the grading block inside postclose if the JSONL grade is missing
      if (v === undefined || v === null) v = resolvePath(postclose, `grading.${spec.path}`);
    }
    labels[spec.name] = v === undefined ? null : v;
  }
  // Derived binary targets
  for (const spec of LABEL_SPEC) {
    if (!spec.derived) continue;
    const fn = LABEL_DERIVERS[spec.derived];
    labels[spec.name] = fn ? fn(labels) : null;
  }
  return labels;
}

// ─── Quality / Eligibility ────────────────────────────────────────────────────

function featureCoverage(features) {
  const total = FEATURE_SPEC.length;
  if (total === 0) return 1.0;
  const nonNull = FEATURE_SPEC.filter(s => features[s.name] != null).length;
  return round(nonNull / total, 4);
}

function labelCoverage(labels) {
  const total = LABEL_SPEC.length;
  if (total === 0) return 1.0;
  const nonNull = LABEL_SPEC.filter(s => labels[s.name] != null).length;
  return round(nonNull / total, 4);
}

function nullFeaturesList(features) {
  return FEATURE_SPEC.filter(s => features[s.name] == null).map(s => s.name);
}

function nullLabelsList(labels) {
  return LABEL_SPEC.filter(s => labels[s.name] == null).map(s => s.name);
}

function computeEligibility({ features, labels, lineage, featureCov }) {
  const reasons = [];
  if (!lineage.has_premarket) reasons.push('missing_premarket');
  if (!lineage.has_postclose) reasons.push('missing_postclose');
  if (labels.bias_actual == null && labels.overall_grade == null) reasons.push('missing_core_label');
  if (featureCov < MIN_FEATURE_COVERAGE) reasons.push('severe_feature_sparsity');
  return { is_eligible: reasons.length === 0, excluded_reasons: reasons };
}

// ─── Canonical row builder ────────────────────────────────────────────────────

export function buildCanonicalDatasetRow({ date, premarket, postclose, grade, allGrades = [] }) {
  const features = derivePremarketFeatures(premarket);
  const labels   = deriveLabels({ postclose, grade });

  const metadata = {
    trading_date:       date,
    symbol:             premarket?.symbol ?? postclose?.symbol ?? grade?.symbol ?? 'NQ1!',
    weekday:            weekdayOf(date),
    month:              monthOf(date),
    model_version:      premarket?.model_version     ?? grade?.model_version     ?? null,
    indicator_version:  premarket?.indicator_version ?? grade?.indicator_version ?? null,
    prompt_version:     premarket?.prompt_version    ?? grade?.prompt_version    ?? null,
    calendar_source:    premarket?.calendar?.source     ?? postclose?.calendar?.source     ?? grade?.calendar_source ?? null,
    early_close:        premarket?.calendar?.early_close ?? postclose?.calendar?.early_close ?? grade?.early_close    ?? null,
    run_time_et:        premarket?.run_time_et  ?? null,
    run_time_utc:       premarket?.run_time_utc ?? null,
    graded_at_utc:      grade?.graded_at_utc    ?? postclose?.grading?.graded_at_utc ?? null,
    // Backfill provenance (populated only for replay-derived reports)
    is_backfill:        premarket?.is_backfill ?? postclose?.is_backfill ?? false,
    backfill_batch_id:  premarket?.backfill_metadata?.batch_id ?? postclose?.backfill_metadata?.batch_id ?? null,
    replay_fidelity:    premarket?.backfill_metadata?.replay_fidelity ?? postclose?.backfill_metadata?.replay_fidelity ?? null,
  };

  const lineage = {
    grade_schema_version: postclose?.grading?.schema_version ?? null,
    has_premarket:        premarket != null,
    has_postclose:        postclose != null,
    has_grade:            grade != null || (postclose?.grading != null),
    grade_count_for_date: allGrades.length,
    premarket_path:       join(REPORTS_DIR, date, 'premarket_nq.json'),
    postclose_path:       join(REPORTS_DIR, date, 'postclose_nq.json'),
    source:               'jsonl+reports',
  };

  const featureCov = featureCoverage(features);
  const labelCov   = labelCoverage(labels);
  const nullFeatures = nullFeaturesList(features);
  const nullLabels   = nullLabelsList(labels);

  const elig = computeEligibility({ features, labels, lineage, featureCov });
  const sample_weight = elig.is_eligible ? round(0.5 + 0.5 * featureCov, 4) : 0;

  const quality = {
    is_training_eligible:  elig.is_eligible,
    excluded_reasons:      elig.excluded_reasons,
    sample_weight,
    feature_coverage_pct:  featureCov,
    label_coverage_pct:    labelCov,
    null_features:         nullFeatures,
    null_labels:           nullLabels,
  };

  return {
    schema_version: DATASET_SCHEMA_VERSION,
    trading_date:   date,
    symbol:         metadata.symbol,
    metadata,
    features,
    labels,
    quality,
    lineage,
  };
}

// ─── Schema / Dictionaries / Leakage audit ────────────────────────────────────

export function getDatasetSchema() {
  return {
    schema_version:  DATASET_SCHEMA_VERSION,
    last_updated:    nowISO(),
    row_shape: {
      schema_version: 'int',
      trading_date:   'string YYYY-MM-DD',
      symbol:         'string',
      metadata:       METADATA_FIELDS.reduce((a, n) => ({ ...a, [n]: 'see feature/label dicts' }), {}),
      features:       FEATURE_SPEC.map(s => s.name),
      labels:         LABEL_SPEC.map(s => s.name),
      quality:        ['is_training_eligible','excluded_reasons','sample_weight','feature_coverage_pct','label_coverage_pct','null_features','null_labels'],
      lineage:        ['grade_schema_version','has_premarket','has_postclose','has_grade','grade_count_for_date','premarket_path','postclose_path','source'],
    },
    feature_count:   FEATURE_SPEC.length,
    label_count:     LABEL_SPEC.length,
    metadata_fields: METADATA_FIELDS,
    storage: {
      jsonl: 'nq_daily_bias_dataset.jsonl (canonical, all rows)',
      csv:   'nq_daily_bias_dataset.csv (flat, meta__/feat__/label__/qual__/lin__ prefixes)',
    },
  };
}

export function getFeatureDictionary() {
  return {
    schema_version: DATASET_SCHEMA_VERSION,
    last_updated:   nowISO(),
    leakage_policy: 'All features are premarket-only — knowable at or before the premarket report time.',
    features: FEATURE_SPEC.map(s => ({
      name:            s.name,
      type:            s.type,
      source:          s.derived ? `derived:${s.derived}` : `premarket.${s.path}`,
      description:     s.desc,
      allowed_values:  s.allowed ?? null,
      nullable:        true,
      stage_introduced: s.stage,
      leakage_status:  'feature_allowed',
      recommended_usage: 'Stage 5 model input',
    })),
  };
}

export function getLabelDictionary() {
  return {
    schema_version: DATASET_SCHEMA_VERSION,
    last_updated:   nowISO(),
    leakage_policy: 'Every label is post-close truth or grading output — never use as an input feature.',
    labels: LABEL_SPEC.map(s => ({
      name:             s.name,
      type:             s.type,
      source:           s.derived ? `derived:${s.derived}` : `${s.from}.${s.path}`,
      description:      s.desc,
      allowed_values:   s.allowed ?? null,
      nullable:         true,
      stage_introduced: 2,
      leakage_status:   'label_only',
      recommended_usage: 'Stage 5 model target',
    })),
  };
}

/** Explicit per-field leakage audit. */
export function auditLeakage() {
  const entries = [];
  for (const s of FEATURE_SPEC) {
    entries.push({
      field:  `features.${s.name}`,
      status: 'feature_allowed',
      rationale: 'Knowable at premarket report time',
    });
  }
  for (const s of LABEL_SPEC) {
    entries.push({
      field:  `labels.${s.name}`,
      status: 'label_only',
      rationale: s.derived
        ? 'Derived from post-close/grade labels; never use as feature'
        : `From ${s.from} (post-close or grading output)`,
    });
  }
  for (const f of METADATA_FIELDS) {
    entries.push({
      field:  `metadata.${f}`,
      status: 'metadata_only',
      rationale: 'Identifier / version / calendar; not recommended as training feature',
    });
  }
  for (const f of ['is_training_eligible','excluded_reasons','sample_weight','feature_coverage_pct','label_coverage_pct','null_features','null_labels']) {
    entries.push({ field: `quality.${f}`, status: 'metadata_only', rationale: 'Dataset-prep bookkeeping' });
  }
  for (const f of ['grade_schema_version','has_premarket','has_postclose','has_grade','grade_count_for_date','premarket_path','postclose_path','source']) {
    entries.push({ field: `lineage.${f}`, status: 'metadata_only', rationale: 'Provenance / audit only' });
  }
  // Explicit forbidden fields: any post-close truth that ends up in features would be leakage.
  const forbidden_examples = [
    'features.bias_actual',
    'features.bias_correct',
    'features.day_type_actual',
    'features.actual_session.*',
    'features.score_0_to_100',
    'features.overall_grade',
    'features.failure_tags',
    'features.range_within_tolerance',
  ];
  return {
    schema_version: DATASET_SCHEMA_VERSION,
    last_updated:   nowISO(),
    policy: 'Only premarket-time-knowable fields allowed under features. All post-close/grading fields are labels.',
    entries,
    forbidden_examples,
    allowed_feature_count: FEATURE_SPEC.length,
    label_count:           LABEL_SPEC.length,
    metadata_field_count:  METADATA_FIELDS.length,
  };
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function csvEscape(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v)) return csvEscape(v.join(CSV_ARRAY_JOIN));
    return csvEscape(JSON.stringify(v));
  }
  const s = String(v);
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function flattenRow(row) {
  const flat = {
    schema_version: row.schema_version,
    trading_date:   row.trading_date,
    symbol:         row.symbol,
  };
  for (const [k, v] of Object.entries(row.metadata ?? {})) flat[`meta__${k}`]  = v;
  for (const [k, v] of Object.entries(row.features ?? {})) flat[`feat__${k}`]  = v;
  for (const [k, v] of Object.entries(row.labels   ?? {})) flat[`label__${k}`] = v;
  for (const [k, v] of Object.entries(row.quality  ?? {})) flat[`qual__${k}`]  = v;
  for (const [k, v] of Object.entries(row.lineage  ?? {})) flat[`lin__${k}`]   = v;
  return flat;
}

function writeCsv(path, rows) {
  if (!rows || rows.length === 0) { writeFileSync(path, ''); return; }
  const flattened = rows.map(flattenRow);
  const keys = [...new Set(flattened.flatMap(Object.keys))];
  // Stable ordering: identity cols first, then sorted prefixed cols
  const identity = ['schema_version','trading_date','symbol'];
  const prefixed = keys.filter(k => !identity.includes(k)).sort();
  const order    = [...identity, ...prefixed];
  const lines = [order.join(',')];
  for (const r of flattened) {
    lines.push(order.map(k => csvEscape(r[k])).join(','));
  }
  writeFileSync(path, lines.join('\n') + '\n');
}

function writeJsonl(path, rows) {
  const text = rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  writeFileSync(path, text);
}

function writeJson(path, obj) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2));
}

// ─── Quality report ───────────────────────────────────────────────────────────

export function computeDatasetQuality(rows) {
  const n = rows.length;

  const exclusionTally = {};
  let fullCov = 0, partialCov = 0, elig = 0, ineligible = 0;
  const featureNullCounts = {};
  const labelNullCounts   = {};
  const gradeCounts       = {};
  const modelVer = {}, indVer = {}, promptVer = {};
  const covBuckets = { '<0.25': 0, '0.25-0.50': 0, '0.50-0.75': 0, '0.75-0.95': 0, '>=0.95': 0 };

  let hasConfidence = 0, hasDayType = 0, hasExpRange = 0;
  const dates = new Set();

  for (const r of rows) {
    dates.add(r.trading_date);
    for (const f of FEATURE_SPEC) {
      if (r.features[f.name] == null) featureNullCounts[f.name] = (featureNullCounts[f.name] ?? 0) + 1;
    }
    for (const l of LABEL_SPEC) {
      if (r.labels[l.name] == null) labelNullCounts[l.name] = (labelNullCounts[l.name] ?? 0) + 1;
    }

    if (r.features.confidence != null)                            hasConfidence++;
    if (r.features.day_type_called && r.features.day_type_called !== 'pending') hasDayType++;
    if (r.features.expected_range_points != null)                 hasExpRange++;

    const cov = r.quality?.feature_coverage_pct ?? 0;
    if      (cov >= 0.95) { fullCov++; covBuckets['>=0.95']++; }
    else if (cov >= 0.75) { partialCov++; covBuckets['0.75-0.95']++; }
    else if (cov >= 0.50) { partialCov++; covBuckets['0.50-0.75']++; }
    else if (cov >= 0.25) { partialCov++; covBuckets['0.25-0.50']++; }
    else                  { covBuckets['<0.25']++; }

    if (r.quality?.is_training_eligible) elig++;
    else { ineligible++; for (const reason of (r.quality?.excluded_reasons ?? [])) exclusionTally[reason] = (exclusionTally[reason] ?? 0) + 1; }

    if (r.labels?.overall_grade) gradeCounts[r.labels.overall_grade] = (gradeCounts[r.labels.overall_grade] ?? 0) + 1;

    if (r.metadata?.model_version)     modelVer[r.metadata.model_version]       = (modelVer[r.metadata.model_version] ?? 0) + 1;
    if (r.metadata?.indicator_version) indVer[r.metadata.indicator_version]     = (indVer[r.metadata.indicator_version] ?? 0) + 1;
    if (r.metadata?.prompt_version)    promptVer[r.metadata.prompt_version]     = (promptVer[r.metadata.prompt_version] ?? 0) + 1;
  }

  const featureNullRate = Object.fromEntries(
    FEATURE_SPEC.map(f => [f.name, n > 0 ? round((featureNullCounts[f.name] ?? 0) / n, 4) : null])
  );
  const labelNullRate = Object.fromEntries(
    LABEL_SPEC.map(l => [l.name, n > 0 ? round((labelNullCounts[l.name] ?? 0) / n, 4) : null])
  );
  const featureSparsityRanking = Object.entries(featureNullRate)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([name, rate]) => ({ name, null_rate: rate, flagged_sparse: (rate ?? 0) > SEVERE_SPARSITY_THRESHOLD }));

  const dateList = [...dates].sort();

  return {
    schema_version:                    DATASET_SCHEMA_VERSION,
    last_updated:                      nowISO(),
    total_rows:                        n,
    unique_trading_dates:              dates.size,
    duplicate_date_count:              Math.max(0, n - dates.size),
    rows_with_full_feature_coverage:   fullCov,
    rows_with_partial_feature_coverage: partialCov,
    rows_eligible_for_training:        elig,
    rows_excluded_from_training:       ineligible,
    exclusion_reasons:                 exclusionTally,
    feature_null_rate:                 featureNullRate,
    label_null_rate:                   labelNullRate,
    feature_sparsity_ranking:          featureSparsityRanking,
    severe_sparsity_threshold:         SEVERE_SPARSITY_THRESHOLD,
    coverage_distribution:             covBuckets,
    confidence_availability_rate:      n > 0 ? round(hasConfidence / n, 4) : null,
    day_type_availability_rate:        n > 0 ? round(hasDayType / n, 4) : null,
    expected_range_availability_rate:  n > 0 ? round(hasExpRange / n, 4) : null,
    grade_distribution:                gradeCounts,
    version_distribution: {
      model_version:      modelVer,
      indicator_version:  indVer,
      prompt_version:     promptVer,
    },
    earliest_date:                     dateList[0] ?? null,
    latest_date:                       dateList[dateList.length - 1] ?? null,
    note:                              n < 5 ? 'dataset is sparse; quality metrics will stabilize as more days accumulate' : undefined,
  };
}

// ─── Chronological splits ─────────────────────────────────────────────────────

export function buildChronologicalSplits(rows, { train_pct = DEFAULT_SPLIT_TRAIN_PCT, val_pct = DEFAULT_SPLIT_VAL_PCT } = {}) {
  const sorted = [...rows].sort((a, b) => a.trading_date.localeCompare(b.trading_date));
  const n = sorted.length;
  const train_end = Math.floor(n * train_pct);
  const val_end   = Math.floor(n * (train_pct + val_pct));
  return {
    train:      sorted.slice(0,         train_end),
    validation: sorted.slice(train_end, val_end),
    test:       sorted.slice(val_end),
    n_total:    n,
    train_pct, val_pct, test_pct: round(1 - train_pct - val_pct, 4),
  };
}

function bundleForSplit(rows) {
  const n = rows.length;
  if (n === 0) return { n: 0, note: 'empty split' };
  const dates = rows.map(r => r.trading_date).sort();
  const biasCalled = {}, biasActual = {}, grade = {};
  let biasCorrect = 0, biasCorrectN = 0, elig = 0;
  let covSum = 0, covN = 0;
  for (const r of rows) {
    const bc = r.features?.bias_called;  if (bc) biasCalled[bc] = (biasCalled[bc] ?? 0) + 1;
    const ba = r.labels?.bias_actual;    if (ba) biasActual[ba] = (biasActual[ba] ?? 0) + 1;
    const g  = r.labels?.overall_grade;  if (g)  grade[g] = (grade[g] ?? 0) + 1;
    if (r.labels?.bias_correct === true)      { biasCorrect++; biasCorrectN++; }
    else if (r.labels?.bias_correct === false){ biasCorrectN++; }
    if (r.quality?.is_training_eligible) elig++;
    if (typeof r.quality?.feature_coverage_pct === 'number') { covSum += r.quality.feature_coverage_pct; covN++; }
  }
  return {
    n,
    date_range:              { start: dates[0], end: dates[dates.length - 1] },
    eligible_count:          elig,
    average_feature_coverage: covN > 0 ? round(covSum / covN, 4) : null,
    bias_called_distribution:  biasCalled,
    bias_actual_distribution:  biasActual,
    grade_distribution:       grade,
    bias_hit_rate:            biasCorrectN > 0 ? round(biasCorrect / biasCorrectN, 4) : null,
  };
}

// ─── Sample rows ──────────────────────────────────────────────────────────────

function trimmedSample(row) {
  // Remove nothing sensitive (reports are local), but keep samples compact.
  return {
    trading_date: row.trading_date,
    symbol:       row.symbol,
    metadata:     row.metadata,
    features:     row.features,
    labels:       row.labels,
    quality:      row.quality,
  };
}

// ─── Orchestrator: rebuildDataset ─────────────────────────────────────────────

export function rebuildDataset({ trainPct = DEFAULT_SPLIT_TRAIN_PCT, valPct = DEFAULT_SPLIT_VAL_PCT } = {}) {
  mkdirSync(DATASETS_DIR, { recursive: true });
  mkdirSync(SPLITS_DIR,   { recursive: true });

  const sources = loadAllSourceRecords();

  // Canonical rows include every date (even duplicates surface via lineage.grade_count_for_date)
  const canonical = [];
  for (const s of sources) {
    const row = buildCanonicalDatasetRow(s);
    canonical.push(row);
  }

  // Latest-only: one row per trading_date (sources is already latest-per-date)
  const latestByDate = new Map();
  for (const r of canonical) latestByDate.set(r.trading_date, r);
  const latestOnly = [...latestByDate.values()].sort((a, b) => a.trading_date.localeCompare(b.trading_date));

  // Training-ready: latest-only filtered by eligibility
  const trainingReady = latestOnly.filter(r => r.quality?.is_training_eligible);

  // Splits from training-ready
  const splits = buildChronologicalSplits(trainingReady, { train_pct: trainPct, val_pct: valPct });

  // ── Write all artifacts ─────────────────────────────────────────────────
  writeJsonl(OUT.canonicalJsonl, canonical);
  writeCsv  (OUT.canonicalCsv,   canonical);
  writeJsonl(OUT.latestJsonl,    latestOnly);
  writeCsv  (OUT.latestCsv,      latestOnly);
  writeJsonl(OUT.trainingJsonl,  trainingReady);
  writeCsv  (OUT.trainingCsv,    trainingReady);

  writeJsonl(OUT.trainJsonl, splits.train);
  writeCsv  (OUT.trainCsv,   splits.train);
  writeJsonl(OUT.valJsonl,   splits.validation);
  writeCsv  (OUT.valCsv,     splits.validation);
  writeJsonl(OUT.testJsonl,  splits.test);
  writeCsv  (OUT.testCsv,    splits.test);

  const quality  = computeDatasetQuality(latestOnly);
  const schema   = getDatasetSchema();
  const featDict = getFeatureDictionary();
  const labDict  = getLabelDictionary();
  const leakage  = auditLeakage();

  writeJson(OUT.schema,        schema);
  writeJson(OUT.featuresDict,  featDict);
  writeJson(OUT.labelsDict,    labDict);
  writeJson(OUT.leakage,       leakage);
  writeJson(OUT.quality,       quality);

  const sampleCount = Math.min(DEFAULT_SAMPLE_COUNT, latestOnly.length);
  writeJson(OUT.sampleRows, {
    schema_version: DATASET_SCHEMA_VERSION,
    last_updated:   nowISO(),
    count:          sampleCount,
    note:           'trimmed canonical rows for quick inspection',
    samples:        latestOnly.slice(-sampleCount).map(trimmedSample),
  });

  const splitSummary = {
    schema_version: DATASET_SCHEMA_VERSION,
    last_updated:   nowISO(),
    policy:         `chronological — oldest ${Math.round(trainPct*100)}% train, next ${Math.round(valPct*100)}% validation, newest ${Math.round((1-trainPct-valPct)*100)}% test`,
    n_total:        splits.n_total,
    train:      bundleForSplit(splits.train),
    validation: bundleForSplit(splits.validation),
    test:       bundleForSplit(splits.test),
    note:           splits.n_total < 20 ? 'split sizes are small; statistical power will be limited until ≥ 20 eligible days' : undefined,
  };
  const splitManifest = {
    schema_version: DATASET_SCHEMA_VERSION,
    last_updated:   nowISO(),
    files: {
      train:      { jsonl: OUT.trainJsonl,     csv: OUT.trainCsv     },
      validation: { jsonl: OUT.valJsonl,       csv: OUT.valCsv       },
      test:       { jsonl: OUT.testJsonl,      csv: OUT.testCsv      },
      summary:    OUT.splitSum,
    },
  };
  writeJson(OUT.splitMfst, splitManifest);
  writeJson(OUT.splitSum,  splitSummary);

  // ── Manifest + summary ──────────────────────────────────────────────────
  const allPaths = Object.values(OUT);
  const filesWithSize = allPaths.map(p => ({
    path:  p,
    exists: existsSync(p),
    bytes: existsSync(p) ? statSync(p).size : 0,
  }));
  const manifest = {
    schema_version: DATASET_SCHEMA_VERSION,
    last_updated:   nowISO(),
    datasets_dir:   DATASETS_DIR,
    files:          filesWithSize,
  };
  writeJson(OUT.manifest, manifest);

  const summary = {
    schema_version: DATASET_SCHEMA_VERSION,
    last_updated:   nowISO(),
    datasets_dir:   DATASETS_DIR,
    counts: {
      canonical_rows:           canonical.length,
      unique_trading_dates:     latestOnly.length,
      training_ready_rows:      trainingReady.length,
      train_rows:               splits.train.length,
      validation_rows:          splits.validation.length,
      test_rows:                splits.test.length,
    },
    date_range: {
      earliest: quality.earliest_date,
      latest:   quality.latest_date,
    },
    key_feature_availability: {
      confidence:      quality.confidence_availability_rate,
      day_type:        quality.day_type_availability_rate,
      expected_range:  quality.expected_range_availability_rate,
    },
    key_label_availability: {
      bias_actual:     latestOnly.length > 0 ? round(latestOnly.filter(r => r.labels.bias_actual    != null).length / latestOnly.length, 4) : null,
      overall_grade:   latestOnly.length > 0 ? round(latestOnly.filter(r => r.labels.overall_grade  != null).length / latestOnly.length, 4) : null,
      score_0_to_100:  latestOnly.length > 0 ? round(latestOnly.filter(r => r.labels.score_0_to_100 != null).length / latestOnly.length, 4) : null,
    },
    version_coverage:         quality.version_distribution,
    leakage_audit_summary:    {
      allowed_features:   leakage.allowed_feature_count,
      labels:             leakage.label_count,
      metadata_fields:    leakage.metadata_field_count,
      forbidden_examples: leakage.forbidden_examples.length,
    },
    split_ratios: { train: trainPct, validation: valPct, test: round(1 - trainPct - valPct, 4) },
  };
  writeJson(OUT.summary, summary);

  return {
    success: true,
    datasets_dir: DATASETS_DIR,
    counts:       summary.counts,
    files_written: filesWithSize.filter(f => f.exists).map(f => f.path),
    summary,
  };
}

// ─── Read helpers (for CLI/MCP) ───────────────────────────────────────────────

function readOrCompute(path, compute) {
  if (existsSync(path)) {
    try { return { success: true, ...JSON.parse(readFileSync(path, 'utf8')) }; }
    catch { /* fallthrough */ }
  }
  return { success: true, ...compute(), note: 'computed on demand (file missing)' };
}

export function getDatasetSummary()       { return readOrCompute(OUT.summary,      () => ({ summary_missing: true })); }
export function getDatasetManifest()      { return readOrCompute(OUT.manifest,     () => ({ manifest_missing: true })); }
export function getDatasetQuality()       { return readOrCompute(OUT.quality,      () => computeDatasetQuality(loadAllSourceRecords().map(buildCanonicalDatasetRow))); }
export function getDatasetLeakageAudit()  { return readOrCompute(OUT.leakage,      () => auditLeakage()); }
export function getDatasetSplitSummary()  { return readOrCompute(OUT.splitSum,     () => ({ note: 'rebuild required' })); }
export function getDatasetSchemaObj()     { return readOrCompute(OUT.schema,       () => getDatasetSchema()); }
export function getFeatureDictionaryObj() { return readOrCompute(OUT.featuresDict, () => getFeatureDictionary()); }
export function getLabelDictionaryObj()   { return readOrCompute(OUT.labelsDict,   () => getLabelDictionary()); }

export function getDatasetSample({ count = DEFAULT_SAMPLE_COUNT } = {}) {
  // Always read fresh so --count works without a rebuild
  const sources = loadAllSourceRecords();
  const rows    = sources.map(buildCanonicalDatasetRow);
  const latest  = [...new Map(rows.map(r => [r.trading_date, r])).values()]
    .sort((a, b) => a.trading_date.localeCompare(b.trading_date));
  const pick = latest.slice(-count).map(trimmedSample);
  return {
    success: true,
    schema_version: DATASET_SCHEMA_VERSION,
    count:          pick.length,
    samples:        pick,
  };
}
