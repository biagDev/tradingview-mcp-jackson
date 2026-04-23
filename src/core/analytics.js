/**
 * Stage 3 — NQ Daily Bias Analytics Layer
 *
 * Deterministic, local-only analytics over the graded JSONL record store
 * produced by Stage 2. No ML. No external DBs. Every number is
 * reproducible by reading the input files and running the same functions.
 *
 * ────────────────────────────────────────────────────────────────────────
 * INPUTS (source of truth)
 *   ~/.tradingview-mcp/performance/daily_grades.jsonl   — Stage 2 append log
 *   ~/.tradingview-mcp/reports/YYYY-MM-DD/              — for on-read
 *                                                         enrichment of
 *                                                         older records
 *
 * OUTPUTS (regenerable)
 *   ~/.tradingview-mcp/analytics/summary.json
 *   ~/.tradingview-mcp/analytics/rolling_windows.json
 *   ~/.tradingview-mcp/analytics/coverage.json
 *   ~/.tradingview-mcp/analytics/drift.json
 *   ~/.tradingview-mcp/analytics/recent_misses.json
 *   ~/.tradingview-mcp/analytics/best_conditions.json
 *   ~/.tradingview-mcp/analytics/worst_conditions.json
 *   ~/.tradingview-mcp/analytics/dashboard_snapshot.json
 *   ~/.tradingview-mcp/analytics/breakdowns/<dim>.json
 *
 * DUPLICATE POLICY
 *   The JSONL is append-only. When a date has multiple records, the one
 *   with the latest `graded_at_utc` wins for all aggregate computations.
 *   Historical records are never deleted.
 *
 * SMALL-SAMPLE POLICY
 *   Cohort rankings require at least MIN_COHORT_SAMPLE_SIZE records.
 *   Windows / breakdowns with 0 records return valid objects with nulls
 *   and an explanatory `note`.
 * ────────────────────────────────────────────────────────────────────────
 */

import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ─── Paths ────────────────────────────────────────────────────────────────────

const HOME_DIR        = join(homedir(), '.tradingview-mcp');
const REPORTS_DIR     = join(HOME_DIR, 'reports');
const PERFORMANCE_DIR = join(HOME_DIR, 'performance');
const GRADES_LOG      = join(PERFORMANCE_DIR, 'daily_grades.jsonl');
const ANALYTICS_DIR   = join(HOME_DIR, 'analytics');
const BREAKDOWNS_DIR  = join(ANALYTICS_DIR, 'breakdowns');

const OUT = {
  summary:        join(ANALYTICS_DIR, 'summary.json'),
  rolling:        join(ANALYTICS_DIR, 'rolling_windows.json'),
  coverage:       join(ANALYTICS_DIR, 'coverage.json'),
  drift:          join(ANALYTICS_DIR, 'drift.json'),
  recentMisses:   join(ANALYTICS_DIR, 'recent_misses.json'),
  best:           join(ANALYTICS_DIR, 'best_conditions.json'),
  worst:          join(ANALYTICS_DIR, 'worst_conditions.json'),
  failureTags:    join(ANALYTICS_DIR, 'failure_tags.json'),
  dashboard:      join(ANALYTICS_DIR, 'dashboard_snapshot.json'),
};

// ─── Constants (all tunable) ──────────────────────────────────────────────────

export const MIN_COHORT_SAMPLE_SIZE = 3;           // require n ≥ 3 to rank a cohort
export const DEFAULT_WINDOWS        = [5, 20, 60]; // rolling window sizes
export const DEFAULT_RECENT_MISSES  = 10;
export const WEAK_GRADE_SCORE       = 55;          // any score < 55 is a miss
export const WEAK_GRADE_LETTERS     = new Set(['D', 'F', 'NG']);
export const BREAKDOWN_DIMENSIONS = [
  'weekday',
  'month',
  'bias_called',
  'bias_actual',
  'day_type_called',
  'day_type_actual',
  'volatility_regime',
  'calendar_source',
  'early_close',
  'model_version',
  'indicator_version',
  'prompt_version',
  'data_quality_completeness',
  'data_quality_fallback_used',
  'partial_grade',
  'expected_range_source',
  'day_type_source',
  'failure_tags',
];

const ANALYTICS_SCHEMA_VERSION = 1;

// ─── Time Helpers ─────────────────────────────────────────────────────────────

function nowISO() { return new Date().toISOString(); }

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function weekdayOf(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return WEEKDAY_NAMES[d.getUTCDay()];
}

function monthOf(dateStr) {
  return dateStr?.slice(0, 7) ?? null; // "YYYY-MM"
}

// ─── Record loading + dedup + enrichment ──────────────────────────────────────

/**
 * Read every record from daily_grades.jsonl. Malformed lines are silently
 * skipped — analytics should never crash on a bad append.
 */
function readAllGrades() {
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

/**
 * Deduplicate by trading_date. Latest record (by graded_at_utc) wins.
 * Returns records sorted ascending by trading_date.
 */
function latestPerDate(records) {
  const byDate = new Map();
  for (const r of records) {
    if (!r.trading_date) continue;
    const prev = byDate.get(r.trading_date);
    if (!prev || (r.graded_at_utc ?? '') >= (prev.graded_at_utc ?? '')) {
      byDate.set(r.trading_date, r);
    }
  }
  return [...byDate.values()].sort((a, b) => a.trading_date.localeCompare(b.trading_date));
}

/**
 * Enrich a grade record with fields sourced from that date's saved premarket
 * report (needed for breakdowns by volatility_regime, data_quality, etc.)
 * Fields already present on the record are never overwritten.
 */
function enrichFromReports(record) {
  const date = record.trading_date;
  if (!date) return record;
  const pmPath = join(REPORTS_DIR, date, 'premarket_nq.json');
  if (!existsSync(pmPath)) return record;
  try {
    const pm = JSON.parse(readFileSync(pmPath, 'utf8'));
    record.volatility_regime           = record.volatility_regime           ?? pm.volatility_regime           ?? null;
    record.data_quality_completeness   = record.data_quality_completeness   ?? pm.data_quality?.completeness  ?? null;
    record.data_quality_fallback_used  = record.data_quality_fallback_used  ?? pm.data_quality?.fallback_used ?? null;
    record.day_type_source             = record.day_type_source             ?? pm.day_type_source             ?? null;
  } catch { /* tolerate bad JSON */ }
  return record;
}

/**
 * Attach derived fields that aren't in the JSONL but are useful everywhere
 * (weekday, month).
 */
function withDerived(r) {
  return { ...r, weekday: weekdayOf(r.trading_date), month: monthOf(r.trading_date) };
}

/** Public: all graded records, deduped, enriched, sorted asc. */
export function loadAllGrades() {
  const raw      = readAllGrades();
  const deduped  = latestPerDate(raw);
  return deduped.map(r => withDerived(enrichFromReports(r)));
}

// ─── Metric primitives ────────────────────────────────────────────────────────

function round(v, decimals = 4) {
  if (v == null || Number.isNaN(v)) return null;
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** Rate with guard for 0 denominators. Returns null when no data. */
function rate(hit, den) {
  return den > 0 ? round(hit / den, 4) : null;
}

/** Average over a set of numeric values; null when the set is empty. */
function avg(arr, decimals = 2) {
  const nums = arr.filter(v => typeof v === 'number' && !Number.isNaN(v));
  if (nums.length === 0) return null;
  return round(nums.reduce((s, v) => s + v, 0) / nums.length, decimals);
}

/** Core metric bundle used by every window / group / breakdown. */
function bundle(records) {
  const n = records.length;
  if (n === 0) {
    return {
      n: 0,
      bias_hit_rate: null,
      day_type_hit_rate: null,
      range_within_tolerance_rate: null,
      average_score: null,
      average_range_error_points: null,
      average_range_error_pct: null,
      average_coverage_pct: null,
      full_coverage_rate: null,
      partial_grade_rate: null,
      grade_distribution: {},
      note: 'no records',
    };
  }

  let biasHit = 0, biasN = 0;
  let dtHit   = 0, dtN   = 0;
  let rngHit  = 0, rngN  = 0;
  let fullCov = 0, partial = 0;
  const scoreArr = [];
  const rngErrPts = [];
  const rngErrPct = [];
  const covPct   = [];
  const grades   = {};

  for (const r of records) {
    if (r.bias_correct === true)      { biasHit++; biasN++; }
    else if (r.bias_correct === false){ biasN++; }

    if (r.day_type_correct === true)      { dtHit++; dtN++; }
    else if (r.day_type_correct === false){ dtN++; }

    if (r.range_within_tolerance === true)      { rngHit++; rngN++; }
    else if (r.range_within_tolerance === false){ rngN++; }

    if (typeof r.score_0_to_100 === 'number')            scoreArr.push(r.score_0_to_100);
    if (typeof r.range_estimate_error_points === 'number') rngErrPts.push(r.range_estimate_error_points);
    if (typeof r.range_estimate_error_pct === 'number')    rngErrPct.push(r.range_estimate_error_pct);
    if (typeof r.coverage_pct === 'number')              covPct.push(r.coverage_pct);

    if (r.coverage_pct === 1) fullCov++;
    if (r.partial_grade === true) partial++;

    const g = r.overall_grade ?? '?';
    grades[g] = (grades[g] ?? 0) + 1;
  }

  return {
    n,
    bias_hit_rate:               rate(biasHit, biasN),
    day_type_hit_rate:           rate(dtHit,   dtN),
    range_within_tolerance_rate: rate(rngHit,  rngN),
    average_score:               avg(scoreArr, 1),
    average_range_error_points:  avg(rngErrPts, 1),
    average_range_error_pct:     avg(rngErrPct, 4),
    average_coverage_pct:        avg(covPct,    4),
    full_coverage_rate:          rate(fullCov, n),
    partial_grade_rate:          rate(partial, n),
    grade_distribution:          grades,
  };
}

// ─── Streaks (bias) ──────────────────────────────────────────────────────────

function streaks(recordsAsc) {
  if (recordsAsc.length === 0) {
    return { current_streak: 0, longest_win_streak: 0, longest_loss_streak: 0 };
  }

  let curWin = 0, curLoss = 0;
  let longestWin = 0, longestLoss = 0;

  for (const r of recordsAsc) {
    if (r.bias_correct === true) {
      curWin++; curLoss = 0;
      if (curWin > longestWin) longestWin = curWin;
    } else if (r.bias_correct === false) {
      curLoss++; curWin = 0;
      if (curLoss > longestLoss) longestLoss = curLoss;
    } else {
      // ungradable bias — ends any active streak, contributes to neither
      curWin = 0; curLoss = 0;
    }
  }

  // Current streak: trailing run
  let current = 0;
  for (let i = recordsAsc.length - 1; i >= 0; i--) {
    const r = recordsAsc[i];
    if (r.bias_correct === true) {
      if (current >= 0) current = current === 0 ? 1 : current + 1;
      else break;
    } else if (r.bias_correct === false) {
      if (current <= 0) current = current === 0 ? -1 : current - 1;
      else break;
    } else break;
  }

  return { current_streak: current, longest_win_streak: longestWin, longest_loss_streak: longestLoss };
}

// ─── Public: overall summary ─────────────────────────────────────────────────

export function computeAnalyticsSummary({ records } = {}) {
  const r = records ?? loadAllGrades();
  const b = bundle(r);
  const s = streaks(r);
  return {
    schema_version:    ANALYTICS_SCHEMA_VERSION,
    last_updated:      nowISO(),
    total_days_graded: r.length,
    total_days_with_full_coverage: r.filter(x => x.coverage_pct === 1).length,
    ...b,
    ...s,
  };
}

// ─── Public: rolling windows ─────────────────────────────────────────────────

export function computeWindowMetrics({ days, records } = {}) {
  const r = records ?? loadAllGrades();
  if (!days) return { all_time: bundle(r) };
  const window = r.slice(-days);
  return {
    window_days: days,
    ...bundle(window),
  };
}

export function computeRollingWindows({ records, windows = DEFAULT_WINDOWS } = {}) {
  const r = records ?? loadAllGrades();
  const out = {
    schema_version: ANALYTICS_SCHEMA_VERSION,
    last_updated:   nowISO(),
    total_days_graded: r.length,
    all_time:       bundle(r),
  };
  for (const w of windows) {
    out[`last_${w}_days`] = { window_days: w, ...bundle(r.slice(-w)) };
  }
  return out;
}

// ─── Public: coverage ────────────────────────────────────────────────────────

export function computeCoverageMetrics({ records } = {}) {
  const r = records ?? loadAllGrades();
  const n = r.length;
  if (n === 0) {
    return {
      schema_version: ANALYTICS_SCHEMA_VERSION,
      last_updated:   nowISO(),
      n: 0, note: 'no records',
    };
  }

  const biasGraded  = r.filter(x => x.bias_correct  != null).length;
  const dtGraded    = r.filter(x => x.day_type_correct != null).length;
  const rngGraded   = r.filter(x => x.range_within_tolerance != null).length;
  const full        = r.filter(x => x.coverage_pct === 1).length;
  const partial     = r.filter(x => x.partial_grade === true).length;

  const covArr = r.map(x => x.coverage_pct).filter(v => typeof v === 'number');
  const dimCountArr = r.map(x => (x.graded_dimensions?.length ?? 0));

  // Distribution: how many days have {bias, range}, {bias, day_type, range}, etc.
  const comboDist = {};
  for (const x of r) {
    const key = (x.graded_dimensions ?? []).slice().sort().join('+') || 'none';
    comboDist[key] = (comboDist[key] ?? 0) + 1;
  }

  return {
    schema_version: ANALYTICS_SCHEMA_VERSION,
    last_updated:   nowISO(),
    n,
    percent_with_bias_graded:      rate(biasGraded, n),
    percent_with_day_type_graded:  rate(dtGraded,   n),
    percent_with_range_graded:     rate(rngGraded,  n),
    percent_full_grade:            rate(full,       n),
    percent_partial_grade:         rate(partial,    n),
    average_coverage_pct:          avg(covArr, 4),
    average_graded_dimensions:     avg(dimCountArr, 2),
    graded_dimension_combos:       comboDist,
  };
}

// ─── Public: failure tags ────────────────────────────────────────────────────

export function computeFailureTagMetrics({ records, window = null } = {}) {
  let r = records ?? loadAllGrades();
  if (window) r = r.slice(-window);

  const counts = {};
  const scoreByTag = {};
  for (const rec of r) {
    for (const tag of (rec.failure_tags ?? [])) {
      counts[tag] = (counts[tag] ?? 0) + 1;
      if (!scoreByTag[tag]) scoreByTag[tag] = [];
      if (typeof rec.score_0_to_100 === 'number') scoreByTag[tag].push(rec.score_0_to_100);
    }
  }

  const averages = {};
  for (const [tag, scores] of Object.entries(scoreByTag)) averages[tag] = avg(scores, 1);

  const rates = {};
  for (const [tag, c] of Object.entries(counts)) rates[tag] = rate(c, r.length);

  // Co-occurrence
  const coPairs = {};
  for (const rec of r) {
    const tags = (rec.failure_tags ?? []).slice().sort();
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = `${tags[i]} + ${tags[j]}`;
        coPairs[key] = (coPairs[key] ?? 0) + 1;
      }
    }
  }
  const co_occurrence = Object.entries(coPairs)
    .map(([k, count]) => ({ pair: k, count }))
    .sort((a, b) => b.count - a.count);

  return {
    schema_version: ANALYTICS_SCHEMA_VERSION,
    last_updated:   nowISO(),
    n: r.length,
    window,
    tag_counts:        counts,
    tag_rates:         rates,
    average_score_by_tag: averages,
    co_occurrence,
  };
}

// ─── Public: breakdowns ──────────────────────────────────────────────────────

/** Extract the group-key(s) for a record and a dimension. Arrays unroll. */
function extractKey(record, by) {
  switch (by) {
    case 'weekday':                    return record.weekday ?? null;
    case 'month':                      return record.month ?? null;
    case 'bias_called':                return record.bias_called ?? null;
    case 'bias_actual':                return record.bias_actual ?? null;
    case 'day_type_called':            return record.day_type_called ?? null;
    case 'day_type_actual':            return record.day_type_actual ?? null;
    case 'volatility_regime':          return record.volatility_regime ?? null;
    case 'calendar_source':            return record.calendar_source ?? null;
    case 'early_close':                return record.early_close == null ? null : String(record.early_close);
    case 'model_version':              return record.model_version ?? null;
    case 'indicator_version':          return record.indicator_version ?? null;
    case 'prompt_version':             return record.prompt_version ?? null;
    case 'data_quality_completeness':  return record.data_quality_completeness ?? null;
    case 'data_quality_fallback_used': return record.data_quality_fallback_used == null ? null : String(record.data_quality_fallback_used);
    case 'partial_grade':              return record.partial_grade == null ? null : String(record.partial_grade);
    case 'expected_range_source':      return record.expected_range_source ?? null;
    case 'day_type_source':            return record.day_type_source ?? null;
    case 'failure_tags':               return (record.failure_tags ?? []).length > 0 ? record.failure_tags : ['__none__'];
    default: return null;
  }
}

export function computeBreakdown({ by, window = null, records } = {}) {
  let r = records ?? loadAllGrades();
  if (window) r = r.slice(-window);

  const groups = new Map();
  for (const rec of r) {
    const keyOrKeys = extractKey(rec, by);
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    for (const k of keys) {
      if (k == null) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(rec);
    }
  }

  const out = [];
  for (const [key, recs] of groups.entries()) {
    out.push({ key, ...bundle(recs) });
  }
  // Sort most-populated first, then alpha by key for stability
  out.sort((a, b) => (b.n - a.n) || String(a.key).localeCompare(String(b.key)));

  return {
    schema_version: ANALYTICS_SCHEMA_VERSION,
    last_updated:   nowISO(),
    by,
    window,
    total_records:  r.length,
    group_count:    out.length,
    groups:         out,
    notes:          out.length === 0 ? 'no groups for this dimension yet' : undefined,
  };
}

// ─── Public: recent misses ───────────────────────────────────────────────────

function isMiss(r, weakScoreThreshold) {
  if (r.bias_correct === false)                                    return true;
  if (r.day_type_correct === false)                                return true;
  if (r.range_within_tolerance === false)                          return true;
  if (WEAK_GRADE_LETTERS.has(r.overall_grade))                     return true;
  if (r.partial_grade === true &&
      typeof r.score_0_to_100 === 'number' &&
      r.score_0_to_100 < weakScoreThreshold)                       return true;
  return false;
}

export function computeRecentMisses({ count = DEFAULT_RECENT_MISSES, records } = {}) {
  const r = records ?? loadAllGrades();
  const missed = [];
  // Walk newest → oldest
  for (let i = r.length - 1; i >= 0; i--) {
    if (missed.length >= count) break;
    const rec = r[i];
    if (isMiss(rec, WEAK_GRADE_SCORE)) {
      missed.push({
        trading_date:       rec.trading_date,
        symbol:             rec.symbol,
        overall_grade:      rec.overall_grade,
        score_0_to_100:     rec.score_0_to_100,
        coverage_pct:       rec.coverage_pct,
        partial_grade:      rec.partial_grade,
        bias_called:        rec.bias_called,
        bias_actual:        rec.bias_actual,
        bias_correct:       rec.bias_correct,
        day_type_called:    rec.day_type_called,
        day_type_actual:    rec.day_type_actual,
        day_type_correct:   rec.day_type_correct,
        expected_range_points:   rec.expected_range_points,
        actual_range_points:     rec.actual_range_points,
        range_estimate_error_points: rec.range_estimate_error_points,
        range_within_tolerance:      rec.range_within_tolerance,
        expected_range_source: rec.expected_range_source,
        failure_tags:       rec.failure_tags,
        volatility_regime:  rec.volatility_regime,
        calendar_source:    rec.calendar_source,
        early_close:        rec.early_close,
        model_version:      rec.model_version,
        indicator_version:  rec.indicator_version,
        prompt_version:     rec.prompt_version,
      });
    }
  }
  return {
    schema_version: ANALYTICS_SCHEMA_VERSION,
    last_updated:   nowISO(),
    count_requested: count,
    count_found:     missed.length,
    weak_score_threshold: WEAK_GRADE_SCORE,
    misses:         missed,
  };
}

// ─── Public: best / worst conditions ─────────────────────────────────────────

/**
 * For each breakdown dimension, produce a "best" and "worst" list of cohorts.
 * Cohorts with n < MIN_COHORT_SAMPLE_SIZE are excluded from ranking.
 *
 * Metrics ranked:
 *   - bias_hit_rate
 *   - average_score
 *   - range_within_tolerance_rate
 */
export function computeBestWorstConditions({ records, minSample = MIN_COHORT_SAMPLE_SIZE } = {}) {
  const r = records ?? loadAllGrades();

  const best  = {};
  const worst = {};

  for (const dim of BREAKDOWN_DIMENSIONS) {
    const br = computeBreakdown({ by: dim, records: r });
    const eligible = br.groups.filter(g => g.n >= minSample);
    if (eligible.length === 0) continue;

    const top = (metric, dir = 'desc') => eligible
      .filter(g => g[metric] != null)
      .slice()
      .sort((a, b) => dir === 'desc' ? (b[metric] - a[metric]) : (a[metric] - b[metric]))
      .slice(0, 5)
      .map(g => ({
        by: dim, key: g.key, n: g.n,
        bias_hit_rate: g.bias_hit_rate,
        day_type_hit_rate: g.day_type_hit_rate,
        range_within_tolerance_rate: g.range_within_tolerance_rate,
        average_score: g.average_score,
        average_range_error_points: g.average_range_error_points,
        grade_distribution: g.grade_distribution,
      }));

    best[dim]  = {
      by_bias_hit_rate:               top('bias_hit_rate',               'desc'),
      by_average_score:               top('average_score',               'desc'),
      by_range_within_tolerance_rate: top('range_within_tolerance_rate', 'desc'),
    };
    worst[dim] = {
      by_bias_hit_rate:               top('bias_hit_rate',               'asc'),
      by_average_score:               top('average_score',               'asc'),
      by_range_within_tolerance_rate: top('range_within_tolerance_rate', 'asc'),
    };
  }

  // Global flat "top-5 any dimension" lists for the dashboard snapshot.
  const globalTop = [];
  const globalBot = [];
  for (const [dim, b] of Object.entries(best))  globalTop.push(...b.by_average_score.map(x => ({ ...x })));
  for (const [dim, w] of Object.entries(worst)) globalBot.push(...w.by_average_score.map(x => ({ ...x })));
  globalTop.sort((a, b) => (b.average_score ?? 0) - (a.average_score ?? 0));
  globalBot.sort((a, b) => (a.average_score ?? 0) - (b.average_score ?? 0));

  return {
    schema_version:      ANALYTICS_SCHEMA_VERSION,
    last_updated:        nowISO(),
    min_sample_size:     minSample,
    best_by_dimension:   best,
    worst_by_dimension:  worst,
    top_5_global:        globalTop.slice(0, 5),
    bottom_5_global:     globalBot.slice(0, 5),
  };
}

// ─── Public: drift (current vs prior window) ─────────────────────────────────

function deltaPair(current, prior, key, decimals = 4) {
  const c = current[key];
  const p = prior[key];
  if (c == null || p == null) return { current: c, prior: p, delta: null };
  return { current: c, prior: p, delta: round(c - p, decimals) };
}

export function computeDrift({ records } = {}) {
  const r = records ?? loadAllGrades();
  const compareWindows = [5, 20];

  const out = {
    schema_version: ANALYTICS_SCHEMA_VERSION,
    last_updated:   nowISO(),
    total_days_graded: r.length,
    comparisons: {},
  };

  for (const w of compareWindows) {
    const needed = 2 * w;
    if (r.length < needed) {
      out.comparisons[`last_${w}_vs_prior_${w}`] = {
        window: w,
        sufficient_history: false,
        required_records:   needed,
        note: `need ≥${needed} records for a ${w}-vs-${w} comparison; have ${r.length}`,
      };
      continue;
    }
    const current = bundle(r.slice(-w));
    const prior   = bundle(r.slice(-2 * w, -w));
    out.comparisons[`last_${w}_vs_prior_${w}`] = {
      window: w,
      sufficient_history: true,
      average_score:              deltaPair(current, prior, 'average_score',              1),
      bias_hit_rate:              deltaPair(current, prior, 'bias_hit_rate',              4),
      day_type_hit_rate:          deltaPair(current, prior, 'day_type_hit_rate',          4),
      range_within_tolerance_rate: deltaPair(current, prior, 'range_within_tolerance_rate', 4),
      average_range_error_points: deltaPair(current, prior, 'average_range_error_points', 1),
      grade_distribution: { current: current.grade_distribution, prior: prior.grade_distribution },
    };
  }

  return out;
}

// ─── Public: dashboard snapshot ──────────────────────────────────────────────

function top3(list) { return (list ?? []).slice(0, 3); }

export function computeDashboardSnapshot({ records } = {}) {
  const r       = records ?? loadAllGrades();
  const summary = computeAnalyticsSummary({ records: r });
  const rolling = computeRollingWindows({ records: r });
  const misses  = computeRecentMisses({ records: r, count: 3 });
  const bw      = computeBestWorstConditions({ records: r });
  const drift   = computeDrift({ records: r });
  const latest  = r[r.length - 1] ?? null;

  return {
    schema_version:  ANALYTICS_SCHEMA_VERSION,
    last_updated:    nowISO(),
    headline: {
      total_days_graded:          summary.total_days_graded,
      total_days_with_full_coverage: summary.total_days_with_full_coverage,
      bias_hit_rate:              summary.bias_hit_rate,
      day_type_hit_rate:          summary.day_type_hit_rate,
      range_within_tolerance_rate: summary.range_within_tolerance_rate,
      average_score:              summary.average_score,
      current_streak:             summary.current_streak,
      longest_win_streak:         summary.longest_win_streak,
      longest_loss_streak:        summary.longest_loss_streak,
    },
    latest_grade: latest && {
      trading_date:       latest.trading_date,
      overall_grade:      latest.overall_grade,
      score_0_to_100:     latest.score_0_to_100,
      coverage_pct:       latest.coverage_pct,
      bias_correct:       latest.bias_correct,
      day_type_correct:   latest.day_type_correct,
      range_within_tolerance: latest.range_within_tolerance,
      failure_tags:       latest.failure_tags,
    },
    rolling: {
      last_5:  rolling.last_5_days,
      last_20: rolling.last_20_days,
      last_60: rolling.last_60_days,
    },
    top_3_recent_misses:    top3(misses.misses),
    top_3_best_conditions:  top3(bw.top_5_global),
    top_3_worst_conditions: top3(bw.bottom_5_global),
    drift:                  drift.comparisons,
  };
}

// ─── Write all artifacts ──────────────────────────────────────────────────────

function writeJson(path, data) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

/**
 * Rebuild every analytics artifact from the JSONL.
 * Returns the dashboard snapshot (compact for caller display).
 */
export function rebuildAnalytics() {
  mkdirSync(ANALYTICS_DIR,  { recursive: true });
  mkdirSync(BREAKDOWNS_DIR, { recursive: true });

  const records = loadAllGrades();

  const summary  = computeAnalyticsSummary({ records });
  const rolling  = computeRollingWindows({ records });
  const coverage = computeCoverageMetrics({ records });
  const drift    = computeDrift({ records });
  const misses   = computeRecentMisses({ records });
  const tags     = computeFailureTagMetrics({ records });
  const bw       = computeBestWorstConditions({ records });
  const dashboard = computeDashboardSnapshot({ records });

  writeJson(OUT.summary,       summary);
  writeJson(OUT.rolling,       rolling);
  writeJson(OUT.coverage,      coverage);
  writeJson(OUT.drift,         drift);
  writeJson(OUT.recentMisses,  misses);
  writeJson(OUT.failureTags,   tags);
  writeJson(OUT.best,          { ...bw, only: 'best_by_dimension + top_5_global' });
  writeJson(OUT.worst,         { ...bw, only: 'worst_by_dimension + bottom_5_global' });
  writeJson(OUT.dashboard,     dashboard);

  // Per-dimension breakdown files
  const breakdownsIndex = [];
  for (const dim of BREAKDOWN_DIMENSIONS) {
    const br = computeBreakdown({ by: dim, records });
    const p  = join(BREAKDOWNS_DIR, `${dim}.json`);
    writeJson(p, br);
    breakdownsIndex.push({ dimension: dim, path: p, groups: br.group_count });
  }
  writeJson(join(BREAKDOWNS_DIR, '_index.json'), {
    schema_version: ANALYTICS_SCHEMA_VERSION,
    last_updated:   nowISO(),
    total_records:  records.length,
    breakdowns:     breakdownsIndex,
  });

  return {
    success: true,
    total_records: records.length,
    analytics_dir: ANALYTICS_DIR,
    written: Object.values(OUT).concat(breakdownsIndex.map(b => b.path)),
    dashboard,
  };
}

// ─── Public read-only getters (CLI/MCP surface) ──────────────────────────────

function readOrCompute(path, compute) {
  if (existsSync(path)) {
    try { return { success: true, ...JSON.parse(readFileSync(path, 'utf8')) }; }
    catch { /* fallthrough to compute */ }
  }
  return { success: true, ...compute(), note: 'rebuilt on demand (file missing)' };
}

export function getAnalyticsSummary() {
  return readOrCompute(OUT.summary, () => computeAnalyticsSummary());
}

export function getRollingWindows() {
  return readOrCompute(OUT.rolling, () => computeRollingWindows());
}

export function getCoverage() {
  return readOrCompute(OUT.coverage, () => computeCoverageMetrics());
}

export function getDrift() {
  return readOrCompute(OUT.drift, () => computeDrift());
}

export function getDashboardSnapshot() {
  return readOrCompute(OUT.dashboard, () => computeDashboardSnapshot());
}

export function getBestConditions() {
  return readOrCompute(OUT.best, () => ({ ...computeBestWorstConditions(), only: 'best_by_dimension + top_5_global' }));
}

export function getWorstConditions() {
  return readOrCompute(OUT.worst, () => ({ ...computeBestWorstConditions(), only: 'worst_by_dimension + bottom_5_global' }));
}

export function getFailureTags() {
  return readOrCompute(OUT.failureTags, () => computeFailureTagMetrics());
}

export function getRecentMisses({ count = DEFAULT_RECENT_MISSES } = {}) {
  // Always computed fresh so --count can vary without a rebuild
  return { success: true, ...computeRecentMisses({ count }) };
}

export function getBreakdown({ by, window }) {
  if (!BREAKDOWN_DIMENSIONS.includes(by)) {
    return { success: false, error: `Unknown dimension "${by}". Allowed: ${BREAKDOWN_DIMENSIONS.join(', ')}` };
  }
  // If a window is requested, compute fresh (breakdown files on disk are all-time)
  if (window) return { success: true, ...computeBreakdown({ by, window }) };
  const p = join(BREAKDOWNS_DIR, `${by}.json`);
  return readOrCompute(p, () => computeBreakdown({ by }));
}
