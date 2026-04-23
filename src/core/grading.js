/**
 * Stage 2 — NQ Daily Bias Grading Engine
 *
 * Deterministic grading of premarket predictions vs. post-close realized
 * session. No ML, no models, no training — explicit rules only.
 *
 * Responsibilities:
 *   1. Read a premarket + post-close report pair for a trading date.
 *   2. Grade directional bias, day-type, and range accuracy against
 *      explicit thresholds.
 *   3. Compute an overall letter grade + 0-100 score.
 *   4. Attach failure tags justified by the saved report data.
 *   5. Write a `grading` block back into the post-close JSON (preserving
 *      the legacy `grading_placeholders` for backward compatibility).
 *   6. Append one record per graded trading date to
 *      ~/.tradingview-mcp/performance/daily_grades.jsonl
 *   7. Rewrite ~/.tradingview-mcp/performance/summary.json with rolling
 *      metrics.
 *
 * Public API:
 *   gradeTradingDate({ date, overwrite })
 *   gradePostcloseReport({ premarket, postclose })
 *   getPerformanceSummary()
 *   getRecentGrades({ count })
 *
 * Design principles:
 *   - Never crash on missing / partial reports — return a structured
 *     { success: false, error, ... } object.
 *   - All thresholds are named constants in the CONSTANTS block below
 *     so they can be tuned without touching the logic.
 *   - JSONL append is the source of truth; summary.json is rebuilt from
 *     it and is safe to delete.
 *   - Re-grading appends a new record (the latest wins in the summary).
 */

import {
  readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ─── Paths ────────────────────────────────────────────────────────────────────

const REPORTS_DIR     = join(homedir(), '.tradingview-mcp', 'reports');
const PERFORMANCE_DIR = join(homedir(), '.tradingview-mcp', 'performance');
const GRADES_LOG      = join(PERFORMANCE_DIR, 'daily_grades.jsonl');
const SUMMARY_FILE    = join(PERFORMANCE_DIR, 'summary.json');

// ─── Constants (all tunable) ──────────────────────────────────────────────────
//
// Bias correctness: a session is classified bullish/bearish if BOTH conditions
// are met. Otherwise it is neutral.
const BIAS_MOVE_THRESHOLD      = 0.30; // |(close-open)/range| must exceed this
const BIAS_CLOSE_POS_BULLISH   = 0.55; // close within upper 45% of range
const BIAS_CLOSE_POS_BEARISH   = 0.45; // close within lower 45% of range

// Range tolerance: actual within +/-15% of expected counts as a hit.
const RANGE_TOLERANCE_PCT      = 0.15;

// Grade weights (must sum to 1.0).
const WEIGHT_BIAS      = 0.40;
const WEIGHT_DAY_TYPE  = 0.35;
const WEIGHT_RANGE     = 0.25;

// Letter grade cutoffs on a 0-100 score.
const GRADE_CUTOFFS = [
  { min: 85, grade: 'A' },
  { min: 70, grade: 'B' },
  { min: 55, grade: 'C' },
  { min: 40, grade: 'D' },
  { min:  0, grade: 'F' },
];

// Schema version of the `grading` block we write into postclose_nq.json.
// v2: overall score is computed over GRADED dimensions only (exclude-and-
//     reweight). Ungradable dimensions receive score=null and do NOT
//     contribute to the weighted average. Coverage fields expose what
//     fraction of the prediction was actually graded.
const GRADING_SCHEMA_VERSION = 2;

// ─── Date/Time Helpers ────────────────────────────────────────────────────────

function todayET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function nowISO() {
  return new Date().toISOString();
}

function nowET() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function reportDir(date)   { return join(REPORTS_DIR, date); }
function premarketPath(date) { return join(reportDir(date), 'premarket_nq.json'); }
function postclosePath(date) { return join(reportDir(date), 'postclose_nq.json'); }

// ─── Actual Session Classification ────────────────────────────────────────────

/**
 * Classify the actual realized session bias deterministically.
 *
 * Rules:
 *   bullish  = signedMove > +0.30 AND closePos >= 0.55
 *   bearish  = signedMove < -0.30 AND closePos <= 0.45
 *   neutral  = otherwise
 *
 * Where:
 *   signedMove = (close - open) / range
 *   closePos   = (close - low)   / range
 *
 * Returns one of: 'bullish' | 'bearish' | 'neutral' | null (ungradable)
 */
function classifyActualBias(session) {
  if (!session) return null;
  const { open, high, low, close } = session;
  if ([open, high, low, close].some(v => v == null)) return null;
  const range = high - low;
  if (!(range > 0)) return null;

  const signedMove = (close - open) / range;
  const closePos   = (close - low)  / range;

  if (signedMove > +BIAS_MOVE_THRESHOLD && closePos >= BIAS_CLOSE_POS_BULLISH) return 'bullish';
  if (signedMove < -BIAS_MOVE_THRESHOLD && closePos <= BIAS_CLOSE_POS_BEARISH) return 'bearish';
  return 'neutral';
}

/**
 * Normalize a predicted bias label ('Bullish', 'bearish', 'Strong Bullish',
 * null, etc.) into one of 'bullish' | 'bearish' | 'neutral' | null.
 */
function normalizePredictedBias(raw) {
  if (raw == null) return null;
  const s = String(raw).toLowerCase();
  if (s.includes('bullish')) return 'bullish';
  if (s.includes('bearish')) return 'bearish';
  if (s.includes('neutral')) return 'neutral';
  return null;
}

/**
 * Normalize a predicted day_type into one of:
 *   'trending' | 'normal' | 'range' | 'inside' | 'pending' | null
 */
function normalizeDayType(raw) {
  if (raw == null) return null;
  const s = String(raw).toLowerCase();
  if (s.includes('trend'))   return 'trending';
  if (s.includes('range'))   return 'range';
  if (s.includes('inside'))  return 'inside';
  if (s.includes('normal'))  return 'normal';
  if (s.includes('pending')) return 'pending';
  return null;
}

// ─── Dimension Graders ────────────────────────────────────────────────────────

/**
 * Grade directional bias.
 * Returns { called, actual, correct, score, reason }.
 * When ungradable, score is null (excluded from weighted overall).
 */
function gradeBias(premarket, postclose) {
  const called = normalizePredictedBias(premarket?.bias);
  const actual = classifyActualBias(postclose?.actual_session);

  if (called == null) {
    return { called: null, actual, correct: null, score: null, reason: 'no_predicted_bias' };
  }
  if (actual == null) {
    return { called, actual: null, correct: null, score: null, reason: 'no_actual_session' };
  }

  const correct = (called === actual);
  return { called, actual, correct, score: correct ? 100 : 0, reason: null };
}

/**
 * Grade day-type prediction. Exact match required.
 * 'pending' predictions are ungradable (score=null), not wrong.
 */
function gradeDayType(premarket, postclose) {
  const called = normalizeDayType(premarket?.day_type);
  const actual = normalizeDayType(postclose?.actual_day_type);

  if (called == null || called === 'pending') {
    return { called: called ?? null, actual, correct: null, score: null, reason: 'no_predicted_day_type' };
  }
  if (actual == null) {
    return { called, actual: null, correct: null, score: null, reason: 'no_actual_day_type' };
  }

  const correct = (called === actual);
  return { called, actual, correct, score: correct ? 100 : 0, reason: null };
}

/**
 * Grade expected-range accuracy.
 * within_tolerance = |actual - expected| / expected <= RANGE_TOLERANCE_PCT
 * Score = max(0, 100 - (error_pct * 100))  (clamped to 0..100)
 * Ungradable → score is null.
 */
function gradeRange(premarket, postclose) {
  const expected_pts = premarket?.expected_range?.points ?? null;
  const expected_lo  = premarket?.expected_range?.low    ?? null;
  const expected_hi  = premarket?.expected_range?.high   ?? null;
  const expected_src = premarket?.expected_range?.source ?? null;
  const actual_lo    = postclose?.actual_session?.low    ?? null;
  const actual_hi    = postclose?.actual_session?.high   ?? null;
  const actual_pts   = postclose?.actual_session?.range_points ?? null;

  if (expected_pts == null || actual_pts == null || expected_pts <= 0) {
    return {
      expected:         { low: expected_lo, high: expected_hi, points: expected_pts, source: expected_src },
      actual:           { low: actual_lo,   high: actual_hi,   points: actual_pts   },
      error_points:     null,
      error_pct:        null,
      within_tolerance: null,
      score:            null,
      reason:           expected_pts == null ? 'no_expected_range' : 'no_actual_range',
    };
  }

  const error_points = Math.abs(actual_pts - expected_pts);
  const error_pct    = error_points / expected_pts;
  const within_tolerance = error_pct <= RANGE_TOLERANCE_PCT;
  const score        = Math.max(0, Math.min(100, Math.round(100 - error_pct * 100)));

  return {
    expected:         { low: expected_lo, high: expected_hi, points: expected_pts, source: expected_src },
    actual:           { low: actual_lo,   high: actual_hi,   points: actual_pts   },
    error_points:     Math.round(error_points),
    error_pct:        Number(error_pct.toFixed(4)),
    within_tolerance,
    score,
    reason:           null,
  };
}

/** Convert a 0-100 numeric score into an A-F letter. */
function letterFromScore(score) {
  if (score == null || Number.isNaN(score)) return '?';
  for (const { min, grade } of GRADE_CUTOFFS) {
    if (score >= min) return grade;
  }
  return 'F';
}

/** Build the failure-tag list from the dimension results + source reports. */
function buildFailureTags({ premarket, postclose, biasR, dayTypeR, rangeR }) {
  const tags = [];

  if (!premarket)  tags.push('missing_premarket_report');
  if (!postclose)  tags.push('missing_postclose_fields');

  if (biasR.correct === false)     tags.push('wrong_bias');
  if (dayTypeR.correct === false)  tags.push('wrong_day_type');

  if (rangeR.error_pct != null) {
    if (!rangeR.within_tolerance) {
      if (rangeR.actual.points > rangeR.expected.points)  tags.push('underestimated_range');
      if (rangeR.actual.points < rangeR.expected.points)  tags.push('overestimated_range');
    }
  }

  // Premarket data-quality derived tags.
  const dq = premarket?.data_quality || {};
  if (dq.completeness && dq.completeness !== 'full')     tags.push('low_data_quality');
  if (dq.fallback_used === true)                          tags.push('degraded_indicator_read');

  // Early-close sessions (Stage 1C calendar flag).
  if (premarket?.calendar?.early_close === true ||
      postclose?.calendar?.early_close === true) {
    tags.push('calendar_mismatch');
  }

  // Actual_session fields incomplete.
  const s = postclose?.actual_session || {};
  if ([s.open, s.high, s.low, s.close].some(v => v == null)) {
    if (!tags.includes('missing_postclose_fields')) tags.push('missing_postclose_fields');
  }

  return tags;
}

// ─── Public: grade a pair ─────────────────────────────────────────────────────

/**
 * Grade a premarket/postclose pair.
 * @returns A fully-populated grading object ready to embed in postclose_nq.json
 *          and to append to daily_grades.jsonl.
 */
export function gradePostcloseReport({ premarket, postclose }) {
  const biasR    = gradeBias(premarket, postclose);
  const dayTypeR = gradeDayType(premarket, postclose);
  const rangeR   = gradeRange(premarket, postclose);

  // ── Exclude-and-reweight scoring ──────────────────────────────────────────
  // Dimensions whose score is null (ungradable) are excluded from the
  // weighted average; remaining weights are normalized to sum to 1.
  // Coverage fields report the fraction of prediction surface area that
  // was actually graded, so a "90/100" on only the bias dimension doesn't
  // look identical to a "90/100" on all three.
  const dims = [
    { key: 'bias',     weight: WEIGHT_BIAS,     score: biasR.score    },
    { key: 'day_type', weight: WEIGHT_DAY_TYPE, score: dayTypeR.score },
    { key: 'range',    weight: WEIGHT_RANGE,    score: rangeR.score   },
  ];
  const graded      = dims.filter(d => d.score !== null);
  const ungraded    = dims.filter(d => d.score === null);
  const weight_used = graded.reduce((s, d) => s + d.weight, 0);

  const score_0_to_100 = weight_used > 0
    ? Math.round(graded.reduce((s, d) => s + d.weight * d.score, 0) / weight_used)
    : null;

  const overall_grade = score_0_to_100 == null ? 'NG' : letterFromScore(score_0_to_100);

  const coverage_pct        = Number(weight_used.toFixed(4));
  const graded_dimensions   = graded.map(d => d.key);
  const ungraded_dimensions = ungraded.map(d => d.key);
  const partial_grade       = weight_used > 0 && weight_used < 1.0;

  // ── Failure tags & notes ──────────────────────────────────────────────────
  const failure_tags = buildFailureTags({ premarket, postclose, biasR, dayTypeR, rangeR });

  const notes = [];
  if (biasR.reason)     notes.push(`bias: ${biasR.reason}`);
  if (dayTypeR.reason)  notes.push(`day_type: ${dayTypeR.reason}`);
  if (rangeR.reason)    notes.push(`range: ${rangeR.reason}`);

  return {
    schema_version:    GRADING_SCHEMA_VERSION,
    graded_at_et:      nowET(),
    graded_at_utc:     nowISO(),

    bias_called:       biasR.called,
    bias_actual:       biasR.actual,
    bias_correct:      biasR.correct,
    bias_score:        biasR.score,

    day_type_called:   dayTypeR.called,
    day_type_actual:   dayTypeR.actual,
    day_type_correct:  dayTypeR.correct,
    day_type_score:    dayTypeR.score,

    expected_range_called:       rangeR.expected,
    actual_range:                rangeR.actual,
    range_estimate_error_points: rangeR.error_points,
    range_estimate_error_pct:    rangeR.error_pct,
    range_within_tolerance:      rangeR.within_tolerance,
    range_score:                 rangeR.score,

    overall_grade,
    score_0_to_100,

    // Coverage / partial-grade transparency (schema v2)
    coverage_pct,
    graded_dimensions,
    ungraded_dimensions,
    partial_grade,

    weights: { bias: WEIGHT_BIAS, day_type: WEIGHT_DAY_TYPE, range: WEIGHT_RANGE },
    scoring_method: 'exclude_and_reweight',
    thresholds: {
      bias_move:        BIAS_MOVE_THRESHOLD,
      bias_close_bull:  BIAS_CLOSE_POS_BULLISH,
      bias_close_bear:  BIAS_CLOSE_POS_BEARISH,
      range_tolerance:  RANGE_TOLERANCE_PCT,
    },

    failure_tags,
    notes: notes.join('; '),
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/**
 * Rewrite postclose_nq.json with a `grading` block embedded.
 * Preserves the legacy `grading_placeholders` field for backward compat.
 */
function updatePostcloseWithGrade(date, grading) {
  const path = postclosePath(date);
  if (!existsSync(path)) throw new Error(`postclose_nq.json not found for ${date}`);
  const existing = JSON.parse(readFileSync(path, 'utf8'));
  existing.grading = grading;
  writeFileSync(path, JSON.stringify(existing, null, 2));
  return path;
}

/** Build the JSONL daily-grade record from a graded pair. */
function buildLogRecord({ premarket, postclose, grading }) {
  return {
    trading_date:       postclose?.trading_date ?? premarket?.trading_date ?? null,
    symbol:             postclose?.symbol       ?? premarket?.symbol       ?? 'NQ1!',

    bias_called:        grading.bias_called,
    bias_actual:        grading.bias_actual,
    bias_correct:       grading.bias_correct,

    day_type_called:    grading.day_type_called,
    day_type_actual:    grading.day_type_actual,
    day_type_correct:   grading.day_type_correct,

    expected_range_points:        grading.expected_range_called?.points ?? null,
    actual_range_points:          grading.actual_range?.points          ?? null,
    range_estimate_error_points:  grading.range_estimate_error_points,
    range_estimate_error_pct:     grading.range_estimate_error_pct,
    range_within_tolerance:       grading.range_within_tolerance,

    overall_grade:       grading.overall_grade,
    score_0_to_100:      grading.score_0_to_100,
    coverage_pct:        grading.coverage_pct,
    graded_dimensions:   grading.graded_dimensions,
    ungraded_dimensions: grading.ungraded_dimensions,
    partial_grade:       grading.partial_grade,
    failure_tags:        grading.failure_tags,
    expected_range_source: grading.expected_range_called?.source ?? null,

    calendar_source:    postclose?.calendar?.source       ?? premarket?.calendar?.source       ?? null,
    early_close:        postclose?.calendar?.early_close  ?? premarket?.calendar?.early_close  ?? null,

    model_version:      premarket?.model_version     ?? null,
    indicator_version:  premarket?.indicator_version ?? null,
    prompt_version:     premarket?.prompt_version    ?? null,

    graded_at_utc:      grading.graded_at_utc,
  };
}

/** Append one record to daily_grades.jsonl (auto-creates the file/dir). */
function appendPerformanceLog(record) {
  mkdirSync(PERFORMANCE_DIR, { recursive: true });
  appendFileSync(GRADES_LOG, JSON.stringify(record) + '\n');
}

/**
 * Read every record from daily_grades.jsonl.
 * Returns [] if the file doesn't exist.
 */
function readAllGrades() {
  if (!existsSync(GRADES_LOG)) return [];
  const text = readFileSync(GRADES_LOG, 'utf8');
  const out  = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip malformed line */ }
  }
  return out;
}

/**
 * Deduplicate the log by trading_date — the latest record (by graded_at_utc)
 * wins. Returns them sorted ascending by trading_date.
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

// ─── Summary builder ──────────────────────────────────────────────────────────

function tally(records) {
  const n = records.length;
  if (n === 0) {
    return {
      n: 0,
      bias_hit_rate:              null,
      day_type_hit_rate:          null,
      range_within_tolerance_rate: null,
      average_range_error_points: null,
      average_score:              null,
      average_coverage_pct:       null,
      partial_grade_rate:         null,
      grade_distribution:         {},
    };
  }

  let biasHit = 0, biasN = 0;
  let dtHit   = 0, dtN   = 0;
  let rngHit  = 0, rngN  = 0;
  let rngErrSum = 0, rngErrN = 0;
  let scoreSum = 0, scoreN = 0;
  let covSum   = 0, covN   = 0;
  let partialN = 0;
  const grades = {};

  for (const r of records) {
    if (r.bias_correct === true)  { biasHit++; biasN++; }
    else if (r.bias_correct === false) { biasN++; }

    if (r.day_type_correct === true)  { dtHit++; dtN++; }
    else if (r.day_type_correct === false) { dtN++; }

    if (r.range_within_tolerance === true)  { rngHit++; rngN++; }
    else if (r.range_within_tolerance === false) { rngN++; }

    if (typeof r.range_estimate_error_points === 'number') {
      rngErrSum += r.range_estimate_error_points;
      rngErrN++;
    }

    if (typeof r.score_0_to_100 === 'number') {
      scoreSum += r.score_0_to_100;
      scoreN++;
    }

    if (typeof r.coverage_pct === 'number') {
      covSum += r.coverage_pct;
      covN++;
    }

    if (r.partial_grade === true) partialN++;

    const g = r.overall_grade ?? '?';
    grades[g] = (grades[g] ?? 0) + 1;
  }

  const rate = (hit, den) => den > 0 ? Number((hit / den).toFixed(4)) : null;

  return {
    n,
    bias_hit_rate:              rate(biasHit, biasN),
    day_type_hit_rate:          rate(dtHit,   dtN),
    range_within_tolerance_rate: rate(rngHit, rngN),
    average_range_error_points: rngErrN > 0 ? Math.round(rngErrSum / rngErrN) : null,
    average_score:              scoreN  > 0 ? Math.round(scoreSum / scoreN)   : null,
    average_coverage_pct:       covN    > 0 ? Number((covSum / covN).toFixed(4)) : null,
    partial_grade_rate:         rate(partialN, n),
    grade_distribution:         grades,
  };
}

/**
 * Compute the current streak: longest run of consecutive dates (from the most
 * recent backward) where bias_correct === true OR false — returns a signed
 * integer. Positive = hits, negative = misses, 0 = neutral/null.
 */
function currentStreak(recordsAsc) {
  if (recordsAsc.length === 0) return 0;
  const asc = [...recordsAsc];
  const latest = asc[asc.length - 1];
  if (latest.bias_correct === true) {
    let s = 0;
    for (let i = asc.length - 1; i >= 0; i--) {
      if (asc[i].bias_correct === true) s++; else break;
    }
    return s;
  }
  if (latest.bias_correct === false) {
    let s = 0;
    for (let i = asc.length - 1; i >= 0; i--) {
      if (asc[i].bias_correct === false) s++; else break;
    }
    return -s;
  }
  return 0;
}

/** Rebuild summary.json from the JSONL (atomically). */
function rebuildSummary() {
  mkdirSync(PERFORMANCE_DIR, { recursive: true });
  const all    = readAllGrades();
  const dated  = latestPerDate(all);
  const last5  = dated.slice(-5);
  const last20 = dated.slice(-20);
  const last60 = dated.slice(-60);

  const summary = {
    last_updated:      nowISO(),
    total_days_graded: dated.length,
    ...tally(dated),
    last_5_days:       tally(last5),
    last_20_days:      tally(last20),
    last_60_days:      tally(last60),
    current_streak:    currentStreak(dated),
  };

  writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
  return summary;
}

// ─── Public: grade a trading date end-to-end ──────────────────────────────────

/**
 * Read both reports for `date`, grade the pair, write `grading` back into
 * postclose_nq.json, append to the JSONL log, and rebuild summary.json.
 *
 * @param {object} [opts]
 * @param {string} [opts.date]       YYYY-MM-DD (default: today ET)
 * @param {boolean} [opts.overwrite] If false (default) and the postclose
 *   report already contains a `grading` block, skip and return the existing
 *   one. If true, grade again and append a fresh JSONL record.
 */
export async function gradeTradingDate({ date, overwrite = false } = {}) {
  const dateStr = date || todayET();

  const pmPath = premarketPath(dateStr);
  const pcPath = postclosePath(dateStr);

  if (!existsSync(pcPath)) {
    return { success: false, date: dateStr, reason: 'missing_postclose_report', path: pcPath };
  }

  const postclose = JSON.parse(readFileSync(pcPath, 'utf8'));
  const premarket = existsSync(pmPath) ? JSON.parse(readFileSync(pmPath, 'utf8')) : null;

  if (postclose.grading && !overwrite) {
    return {
      success: true, date: dateStr, skipped: true,
      reason: 'already_graded', grading: postclose.grading, path: pcPath,
    };
  }

  const grading = gradePostcloseReport({ premarket, postclose });

  // Write back into postclose JSON
  updatePostcloseWithGrade(dateStr, grading);

  // Append JSONL record
  const record = buildLogRecord({ premarket, postclose, grading });
  appendPerformanceLog(record);

  // Rebuild summary
  const summary = rebuildSummary();

  return {
    success: true,
    date: dateStr,
    overwrite,
    grading,
    record,
    summary,
    path: pcPath,
    premarket_found: !!premarket,
  };
}

// ─── Public: query helpers ────────────────────────────────────────────────────

/** Return the current summary.json (rebuilding from JSONL if missing). */
export function getPerformanceSummary() {
  if (!existsSync(SUMMARY_FILE)) {
    if (!existsSync(GRADES_LOG)) {
      return { success: true, summary: { total_days_graded: 0, note: 'No grades logged yet.' } };
    }
    return { success: true, summary: rebuildSummary() };
  }
  return { success: true, summary: JSON.parse(readFileSync(SUMMARY_FILE, 'utf8')) };
}

/** Return the most recent N grade records from the JSONL (latest per date). */
export function getRecentGrades({ count = 20 } = {}) {
  const all   = readAllGrades();
  const dated = latestPerDate(all);
  const recent = dated.slice(-count).reverse(); // newest first
  return {
    success: true,
    count: recent.length,
    total_days_graded: dated.length,
    grades: recent,
  };
}

/** Grade the most recently saved postclose report. */
export async function gradeLatest({ overwrite = false } = {}) {
  if (!existsSync(REPORTS_DIR)) {
    return { success: false, reason: 'no_reports_dir' };
  }
  const dates = readdirSync(REPORTS_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter(d => existsSync(postclosePath(d)))
    .sort()
    .reverse();
  if (dates.length === 0) {
    return { success: false, reason: 'no_postclose_reports_found' };
  }
  return gradeTradingDate({ date: dates[0], overwrite });
}
