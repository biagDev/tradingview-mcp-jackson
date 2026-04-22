/**
 * Stage 1 — NQ Daily Bias Report Engine
 *
 * Generates, persists, and retrieves two structured reports per trading day:
 *   premarket_report  — run at ~09:00 ET before RTH open
 *   postclose_report  — run at ~16:05 ET after RTH close
 *
 * Storage: ~/.tradingview-mcp/reports/YYYY-MM-DD/
 *   premarket_nq.json
 *   postclose_nq.json
 *   combined_summary.json
 *
 * Design principles:
 *   - Auto-save on every run; caller never needs to manually persist
 *   - Failed runs still produce a saved report object (status: "failed")
 *   - Indicator-first data strategy; falls back to quote/OHLCV if DBE absent
 *   - Sync file I/O; async only where TradingView CDP calls are needed
 */

import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as health from './health.js';
import * as chart from './chart.js';
import * as data from './data.js';

// ─── Constants ─────────────────────────────────────────────────────────────

const REPORTS_DIR = join(homedir(), '.tradingview-mcp', 'reports');

const MODEL_VERSION     = '1.0.0';
const INDICATOR_VERSION = 'NQ-DBE-v1';
const PROMPT_VERSION    = 'stage1-v1';

const DBE_INDICATOR_NAME = 'NQ Daily Bias Engine';

// ─── Date / Time Helpers ───────────────────────────────────────────────────

/** YYYY-MM-DD in Eastern Time */
function todayET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** ISO 8601 UTC timestamp */
function nowISO() {
  return new Date().toISOString();
}

/** Human-readable ET timestamp */
function nowET() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function reportDir(date) {
  return join(REPORTS_DIR, date);
}

// ─── File I/O ──────────────────────────────────────────────────────────────

/**
 * Persist a report to disk and update the combined_summary for that date.
 * @param {object} opts
 * @param {'premarket_report'|'postclose_report'} opts.report_type
 * @param {string}  opts.date      YYYY-MM-DD
 * @param {object}  opts.data      Full report object to write
 * @returns {{ success: boolean, path: string, date: string }}
 */
export function saveReport({ report_type, date, data: reportData }) {
  const dateStr = date || todayET();
  const dir = reportDir(dateStr);
  mkdirSync(dir, { recursive: true });

  const filename = report_type === 'premarket_report'
    ? 'premarket_nq.json'
    : 'postclose_nq.json';
  const filePath = join(dir, filename);

  writeFileSync(filePath, JSON.stringify(reportData, null, 2));
  _updateCombinedSummary(dateStr, dir);

  return { success: true, path: filePath, date: dateStr };
}

/** Rewrite the combined_summary.json for a trading date directory. */
function _updateCombinedSummary(dateStr, dir) {
  const summaryPath  = join(dir, 'combined_summary.json');
  const premarketPath = join(dir, 'premarket_nq.json');
  const postclosePath = join(dir, 'postclose_nq.json');

  const existing = existsSync(summaryPath)
    ? JSON.parse(readFileSync(summaryPath, 'utf8'))
    : {};

  writeFileSync(summaryPath, JSON.stringify({
    ...existing,
    trading_date:          dateStr,
    symbol:                'NQ1!',
    premarket_report_path: premarketPath,
    postclose_report_path: postclosePath,
    premarket_exists:      existsSync(premarketPath),
    postclose_exists:      existsSync(postclosePath),
    last_updated:          nowISO(),
  }, null, 2));
}

/**
 * Retrieve one or both reports for a trading date.
 * @param {object} opts
 * @param {string} [opts.date]         YYYY-MM-DD (defaults to today ET)
 * @param {'premarket_report'|'postclose_report'} [opts.report_type]  optional filter
 */
export function getReportByDate({ date, report_type } = {}) {
  const dateStr = date || todayET();
  const dir = reportDir(dateStr);

  if (!existsSync(dir)) {
    return { success: false, error: `No reports found for ${dateStr}`, reports_dir: dir };
  }

  if (report_type) {
    const filename = report_type === 'premarket_report'
      ? 'premarket_nq.json'
      : 'postclose_nq.json';
    const filePath = join(dir, filename);
    if (!existsSync(filePath)) {
      return { success: false, error: `No ${report_type} for ${dateStr}`, path: filePath };
    }
    return { success: true, date: dateStr, report: JSON.parse(readFileSync(filePath, 'utf8')) };
  }

  // Return both reports + summary
  const result = { success: true, date: dateStr };
  const summaryPath   = join(dir, 'combined_summary.json');
  const premarketPath = join(dir, 'premarket_nq.json');
  const postclosePath = join(dir, 'postclose_nq.json');

  if (existsSync(summaryPath))   result.summary   = JSON.parse(readFileSync(summaryPath, 'utf8'));
  if (existsSync(premarketPath)) result.premarket = JSON.parse(readFileSync(premarketPath, 'utf8'));
  if (existsSync(postclosePath)) result.postclose = JSON.parse(readFileSync(postclosePath, 'utf8'));

  return result;
}

/**
 * List the N most recent trading-date directories with their summary status.
 * @param {object} opts
 * @param {number} [opts.count=7]
 */
export function getLatestReports({ count = 7 } = {}) {
  if (!existsSync(REPORTS_DIR)) {
    return { success: true, reports: [], reports_dir: REPORTS_DIR };
  }

  const dates = readdirSync(REPORTS_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse()
    .slice(0, count);

  const reports = dates.map(date => {
    const dir = reportDir(date);
    const summaryPath = join(dir, 'combined_summary.json');
    return {
      date,
      premarket_exists: existsSync(join(dir, 'premarket_nq.json')),
      postclose_exists: existsSync(join(dir, 'postclose_nq.json')),
      summary: existsSync(summaryPath)
        ? JSON.parse(readFileSync(summaryPath, 'utf8'))
        : null,
    };
  });

  return { success: true, count: reports.length, reports_dir: REPORTS_DIR, reports };
}

// ─── DBE Table Parser ──────────────────────────────────────────────────────

/**
 * Convert the flat row array from data_get_pine_tables into a key→value map.
 * Rows are either "Key | Value" pairs or section separators ("── TREND ──").
 */
function parseDBETable(rows) {
  const kv = {};
  for (const row of rows) {
    const sep = row.indexOf(' | ');
    if (sep === -1) continue;              // section header — skip
    kv[row.slice(0, sep).trim()] = row.slice(sep + 3).trim();
  }
  return kv;
}

// ─── Primitive Parsers ─────────────────────────────────────────────────────

function pf(s) {
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/** "0.57%" → 0.57 | "-0.3%" → -0.3 | "N/A" → null */
function parsePct(s) {
  if (!s || s.trim() === 'N/A') return null;
  return pf(s.replace('%', '').trim());
}

/** Parse a value that might be "N/A" */
function parseNA(s) {
  if (!s || s.trim() === 'N/A') return null;
  return pf(s.trim());
}

// ─── DBE Snapshot Builder ──────────────────────────────────────────────────

/**
 * Parse the KV map from the DBE table into a typed indicator_snapshot object.
 */
function buildIndicatorSnapshot(kv) {
  const ema    = (kv['EMA 20/50/200'] || '').split('/');
  const pdRaw  = (kv['PDH/PDC/PDL']   || '').split('/');
  const onRaw  = (kv['ONH / ONL']     || '').split(' / ');
  const vaRaw  = (kv['VAH~/POC~/VAL~']|| '').split('/');
  const biasT  = (kv['TOTAL / BIAS']  || '').split(' — ');
  const dtTN   = (kv['TREND/NORMAL']  || '').split(' / ');
  const dtRI   = (kv['RANGE/INSIDE']  || '').split(' / ');
  const bc1    = (kv['Daily/H4/PDLoc']|| '').split('/');
  const bc2    = (kv['ON/DXY/10Y']    || '').split('/');
  const bc3    = (kv['RS/Sess/VWAP']  || '').split('/');
  const gapDC  = (kv['Dir/Cat']       || 'N/A / N/A').split(' / ');
  const gapAP  = (kv['Gap / ATR%']    || 'N/A / N/A').split(' / ');
  const asiaHL = (kv['Asia H/L']      || 'N/A / N/A').split(' / ');
  const lonHL  = (kv['London H/L']    || 'N/A / N/A').split(' / ');

  // Find regime row (the key itself is EXPANSION / CONTRACTION / NORMAL)
  let regime = 'UNKNOWN', regimeDetail = '';
  for (const key of Object.keys(kv)) {
    if (/^(EXPANSION|CONTRACTION|NORMAL)$/.test(key)) {
      regime = key;
      regimeDetail = kv[key];
      break;
    }
  }

  return {
    ema: {
      ema20:  pf(ema[0]),
      ema50:  pf(ema[1]),
      ema200: pf(ema[2]),
      stack:  kv['EMA Stack'] || null,
    },
    rsi:       pf(kv['RSI(14)']),
    macd_hist: pf(kv['MACD Hist']),
    adx:       pf(kv['ADX(14)']),
    prior_day: {
      pdh: parseNA(pdRaw[0]),
      pdc: parseNA(pdRaw[1]),
      pdl: parseNA(pdRaw[2]),
    },
    overnight: {
      onh: parseNA(onRaw[0]),
      onl: parseNA(onRaw[1]),
    },
    value_area: {
      vah: pf(vaRaw[0]),
      poc: pf(vaRaw[1]),
      val: pf(vaRaw[2]),
    },
    bias_components: {
      daily:        parseInt(bc1[0]) || 0,
      h4:           parseInt(bc1[1]) || 0,
      pd_location:  parseInt(bc1[2]) || 0,
      overnight:    parseInt(bc2[0]) || 0,
      dxy:          parseInt(bc2[1]) || 0,
      ten_year:     parseInt(bc2[2]) || 0,
      rel_strength: parseInt(bc3[0]) || 0,
      session:      parseInt(bc3[1]) || 0,
      vwap:         parseInt(bc3[2]) || 0,
    },
    bias_total: pf(biasT[0]),
    bias_label: biasT[1] || null,
    day_type_probs: {
      trend:  parsePct(dtTN[0]),
      normal: parsePct(dtTN[1]),
      range:  parsePct(dtRI[0]),
      inside: parsePct(dtRI[1]),
    },
    regime,
    regime_detail: regimeDetail,
    gap: {
      direction: gapDC[0]?.trim() || null,
      category:  gapDC[1]?.trim() || null,
      points:    parseNA(gapAP[0]),
      atr_pct:   parsePct(gapAP[1]),
    },
    sessions: {
      asia_high:   parseNA(asiaHL[0]),
      asia_low:    parseNA(asiaHL[1]),
      london_high: parseNA(lonHL[0]),
      london_low:  parseNA(lonHL[1]),
      pattern:     kv['Session Pattern'] || null,
    },
    intermarket: {
      dxy_pct:      parsePct(kv['DXY Δ%']),
      ten_year_pct: parsePct(kv['10Y Δ%']),
      es_pct:       parsePct(kv['ES Δ%']),
      vix_raw:      kv['VIX'] || null,
      vix:          pf((kv['VIX'] || '').split(' ')[0]),
    },
  };
}

/**
 * Convert the labels array into a typed, price-sorted key-levels list.
 */
function buildKeyLevels(labels) {
  return [...labels]
    .map(({ text, price }) => {
      // "PDH 26901.75" → type="PDH", or "FVG Bull 26754.25" → type="FVG Bull"
      const parts  = text.trim().split(' ');
      const priceStr = parts[parts.length - 1];
      const type = parts.slice(0, parts.findIndex(p => p === priceStr)).join(' ') || parts[0];
      return { label: text, type, price };
    })
    .sort((a, b) => b.price - a.price);
}

// ─── Normalizers ───────────────────────────────────────────────────────────

function normalizeBias(biasLabel) {
  if (!biasLabel) return 'neutral';
  const l = biasLabel.toLowerCase();
  if (l.includes('bullish')) return 'bullish';
  if (l.includes('bearish')) return 'bearish';
  return 'neutral';
}

function normalizeDayType(kv) {
  const trend  = parsePct((kv['TREND/NORMAL']  || '').split(' / ')[0]);
  const normal = parsePct((kv['TREND/NORMAL']  || '').split(' / ')[1]);
  const range  = parsePct((kv['RANGE/INSIDE']  || '').split(' / ')[0]);
  const inside = parsePct((kv['RANGE/INSIDE']  || '').split(' / ')[1]);

  if (trend === null) return 'pending';

  const best = [
    { type: 'trending', prob: trend  || 0 },
    { type: 'normal',   prob: normal || 0 },
    { type: 'range',    prob: range  || 0 },
    { type: 'inside',   prob: inside || 0 },
  ].sort((a, b) => b.prob - a.prob)[0];

  return best.prob > 0 ? best.type : 'pending';
}

// ─── Base Report Skeletons ─────────────────────────────────────────────────

function basePremarket(dateStr, runTimeET, runTimeUtc) {
  return {
    report_type:       'premarket_report',
    symbol:            'NQ1!',
    trading_date:      dateStr,
    run_time_et:       runTimeET,
    run_time_utc:      runTimeUtc,
    model_version:     MODEL_VERSION,
    indicator_version: INDICATOR_VERSION,
    prompt_version:    PROMPT_VERSION,
    status:            'failed',
    bias:              null,
    confidence:        null,
    day_type:          null,
    expected_range:    { low: null, high: null, points: null, rth_open: null, ib_high: null, ib_low: null },
    volatility_regime: null,
    gap_analysis:      {},
    session_structure: {},
    intermarket:       {},
    key_levels:        [],
    indicator_snapshot:{},
    data_quality:      {},
    narrative_report:  '',
    raw_inputs:        {},
  };
}

function basePostclose(dateStr, runTimeET, runTimeUtc) {
  return {
    report_type:      'postclose_report',
    symbol:           'NQ1!',
    trading_date:     dateStr,
    run_time_et:      runTimeET,
    run_time_utc:     runTimeUtc,
    status:           'failed',
    actual_session:   { open: null, high: null, low: null, close: null, range_points: null },
    actual_day_type:  null,
    actual_volatility_regime: null,
    key_level_outcomes: [],
    comparison_to_premarket: {
      premarket_report_found: false,
      bias_called:            null,
      day_type_called:        null,
      expected_range_called:  {},
      narrative_called:       '',
    },
    grading_placeholders: {
      bias_correct:         null,   // Stage 2 fills this
      day_type_correct:     null,   // Stage 2 fills this
      range_estimate_error: null,   // Stage 2 fills this
      notes:                '',
    },
    narrative_report: '',
    raw_inputs:       {},
  };
}

// ─── Premarket Report ──────────────────────────────────────────────────────

/**
 * Read NQ DBE indicator from TradingView, build a structured premarket report,
 * and auto-save it to disk.
 *
 * @param {object} [opts]
 * @param {string} [opts.date]      Override trading date (YYYY-MM-DD). Defaults to today ET.
 * @param {string} [opts.narrative] Optional narrative text to store in narrative_report.
 *                                  Pass the full brief text here when calling after generating it.
 * @returns {{ success: boolean, path?: string, report: object, error?: string }}
 */
export async function generatePremarketReport({ date, narrative } = {}) {
  const dateStr    = date || todayET();
  const runTimeUtc = nowISO();
  const runTimeET  = nowET();
  const base       = basePremarket(dateStr, runTimeET, runTimeUtc);

  // If the report already exists and we're only updating the narrative, do a fast upsert.
  if (narrative) {
    const existingPath = join(reportDir(dateStr), 'premarket_nq.json');
    if (existsSync(existingPath)) {
      const existing = JSON.parse(readFileSync(existingPath, 'utf8'));
      const updated  = { ...existing, narrative_report: narrative, run_time_et: runTimeET, run_time_utc: runTimeUtc };
      const result   = saveReport({ report_type: 'premarket_report', date: dateStr, data: updated });
      return { success: true, path: result.path, report: updated };
    }
  }

  try {
    // 1. Verify TradingView connection
    const hc = await health.healthCheck();
    if (!hc.cdp_connected) throw new Error('TradingView CDP not connected');

    // 2. Verify chart symbol is NQ
    const chartState = await chart.getState();
    if (!chartState.symbol?.includes('NQ')) {
      throw new Error(`Chart symbol is "${chartState.symbol}", expected NQ1!`);
    }

    // 3. Check for NQ DBE indicator
    const studies   = chartState.studies || [];
    const dbeStudy  = studies.find(s => s.name?.includes(DBE_INDICATOR_NAME));
    const dbePresent = !!dbeStudy;

    // 4. Read all Pine data channels (indicator-first)
    const [tablesRes, labelsRes, linesRes, boxesRes, quoteRes] = await Promise.all([
      data.getPineTables({}),
      data.getPineLabels({ max_labels: 100 }),
      data.getPineLines({}),
      data.getPineBoxes({}),
      data.getQuote({}),
    ]);

    // Locate NQ DBE study in each result set
    const dbeTable = (tablesRes.studies || []).find(s => s.name?.includes(DBE_INDICATOR_NAME));
    const dbeLabel = (labelsRes.studies || []).find(s => s.name?.includes(DBE_INDICATOR_NAME));
    const dbeLine  = (linesRes.studies  || []).find(s => s.name?.includes(DBE_INDICATOR_NAME));
    const dbeBox   = (boxesRes.studies  || []).find(s => s.name?.includes(DBE_INDICATOR_NAME));

    const tableRows = dbeTable?.tables?.[0]?.rows || [];
    const labels    = dbeLabel?.labels             || [];
    const lines     = dbeLine?.horizontal_levels   || [];
    const boxes     = dbeBox?.zones                || [];

    // 5. Fall back to study values + OHLCV if DBE table is empty
    let fallbackUsed = false;
    let studyValues  = null;
    if (tableRows.length === 0) {
      fallbackUsed = true;
      try { studyValues = await data.getStudyValues(); } catch (_) {}
    }

    // Parse DBE table into structured snapshot
    const kv       = parseDBETable(tableRows);
    const snapshot = buildIndicatorSnapshot(kv);
    const keyLevels = buildKeyLevels(labels);

    // Data quality
    const dataQuality = {
      dbe_indicator_present: dbePresent,
      table_rows:    tableRows.length,
      labels_count:  labels.length,
      lines_count:   lines.length,
      boxes_count:   boxes.length,
      quote_available: !!quoteRes?.last,
      fallback_used: fallbackUsed,
      source:        tableRows.length > 0 ? 'dbe_indicator' : (fallbackUsed ? 'study_values_fallback' : 'none'),
      completeness:  tableRows.length >= 25 ? 'full' : tableRows.length > 0 ? 'partial' : 'none',
    };

    // Extract key labels for expected range and IB
    const findLabel = prefix => labels.find(l => l.text?.startsWith(prefix));
    const expHigh  = findLabel('Expected High')?.price || null;
    const expLow   = findLabel('Expected Low')?.price  || null;
    const rthOpen  = findLabel('RTH Open')?.price      || null;
    const ibHigh   = findLabel('IB High')?.price       || null;
    const ibLow    = findLabel('IB Low')?.price        || null;

    // Bias
    const biasRaw  = (kv['TOTAL / BIAS'] || '').split(' — ');
    const biasTxt  = biasRaw[1] || '';
    const biasNum  = pf(biasRaw[0]);

    const report = {
      ...base,
      status:            'success',
      bias:              normalizeBias(biasTxt),
      confidence:        biasNum !== null ? Math.abs(biasNum) : null,
      day_type:          normalizeDayType(kv),
      expected_range:    { low: expLow, high: expHigh,
                           points: expHigh && expLow ? Math.round(expHigh - expLow) : null,
                           rth_open: rthOpen, ib_high: ibHigh, ib_low: ibLow },
      volatility_regime: snapshot.regime,
      gap_analysis:      snapshot.gap,
      session_structure: {
        asia:     { high: snapshot.sessions.asia_high,   low: snapshot.sessions.asia_low },
        london:   { high: snapshot.sessions.london_high, low: snapshot.sessions.london_low },
        overnight:{ high: snapshot.overnight.onh,        low: snapshot.overnight.onl },
        pattern:  snapshot.sessions.pattern,
      },
      intermarket:        snapshot.intermarket,
      key_levels:         keyLevels,
      indicator_snapshot: snapshot,
      data_quality:       dataQuality,
      narrative_report:   narrative || '',
      raw_inputs: {
        quote:       quoteRes,
        table_rows:  tableRows,
        labels,
        lines,
        boxes,
        study_values: studyValues,
        chart_state: { symbol: chartState.symbol, resolution: chartState.resolution },
      },
    };

    const saved = saveReport({ report_type: 'premarket_report', date: dateStr, data: report });
    return { success: true, path: saved.path, report };

  } catch (err) {
    const failed = { ...base, status: 'failed', error: err.message };
    try { saveReport({ report_type: 'premarket_report', date: dateStr, data: failed }); } catch (_) {}
    return { success: false, error: err.message, report: failed };
  }
}

// ─── Post-Close Report ─────────────────────────────────────────────────────

/**
 * Build a post-close review for a completed trading session.
 * Loads the matching premarket report if available, reads actual OHLCV + Pine data,
 * and auto-saves the result.
 *
 * @param {object} [opts]
 * @param {string} [opts.date]      Override trading date (YYYY-MM-DD). Defaults to today ET.
 * @param {string} [opts.narrative] Optional narrative text (post-close review summary).
 * @returns {{ success: boolean, path?: string, report: object, error?: string }}
 */
export async function generatePostCloseReport({ date, narrative } = {}) {
  const dateStr    = date || todayET();
  const runTimeUtc = nowISO();
  const runTimeET  = nowET();
  const base       = basePostclose(dateStr, runTimeET, runTimeUtc);

  try {
    // 1. Load premarket report for the same trading date
    const premarketPath = join(reportDir(dateStr), 'premarket_nq.json');
    const premarketReport = existsSync(premarketPath)
      ? JSON.parse(readFileSync(premarketPath, 'utf8'))
      : null;

    // 2. Pull actual session data from TradingView
    const [ohlcvRes, quoteRes, tablesRes, labelsRes] = await Promise.all([
      data.getOhlcv({ count: 200, summary: false }),
      data.getQuote({}),
      data.getPineTables({}),
      data.getPineLabels({ max_labels: 100 }),
    ]);

    const bars = ohlcvRes.bars || [];

    // Extract RTH session bars: 09:30–16:00 ET = 13:30–20:00 UTC (seconds)
    const RTH_START_SEC = 13 * 3600 + 30 * 60; // 13:30 UTC
    const RTH_END_SEC   = 20 * 3600;            // 20:00 UTC
    const rthBars = bars.filter(b => {
      const secInDay = b.time % 86400;
      return secInDay >= RTH_START_SEC && secInDay <= RTH_END_SEC;
    });
    // Fall back to all bars if RTH filter returns nothing
    const sessionBars = rthBars.length > 0 ? rthBars : bars;

    let sessionOpen = null, sessionHigh = null, sessionLow = null, sessionClose = null;
    if (sessionBars.length > 0) {
      sessionOpen  = sessionBars[0].open;
      sessionHigh  = Math.max(...sessionBars.map(b => b.high));
      sessionLow   = Math.min(...sessionBars.map(b => b.low));
      sessionClose = sessionBars[sessionBars.length - 1].close;
    } else if (quoteRes?.last) {
      // Last-resort: use quote snapshot
      sessionOpen  = quoteRes.open  || null;
      sessionHigh  = quoteRes.high  || null;
      sessionLow   = quoteRes.low   || null;
      sessionClose = quoteRes.close || null;
    }

    const dayRange = sessionHigh && sessionLow ? sessionHigh - sessionLow : null;

    // 3. Parse DBE table for actual regime
    const dbeTable  = (tablesRes.studies || []).find(s => s.name?.includes(DBE_INDICATOR_NAME));
    const dbeLabel  = (labelsRes.studies || []).find(s => s.name?.includes(DBE_INDICATOR_NAME));
    const tableRows = dbeTable?.tables?.[0]?.rows || [];
    const labels    = dbeLabel?.labels || [];
    const kv        = parseDBETable(tableRows);

    let actualRegime = 'UNKNOWN';
    for (const key of Object.keys(kv)) {
      if (/^(EXPANSION|CONTRACTION|NORMAL)$/.test(key)) { actualRegime = key; break; }
    }

    // Classify actual day type by range / ATR ratio
    const atrMatch = (kv[actualRegime] || '').match(/ATR:([\d.]+)/);
    const atr = atrMatch ? parseFloat(atrMatch[1]) : null;
    let actualDayType = null;
    if (dayRange && atr) {
      const r = dayRange / atr;
      if      (r >= 0.70) actualDayType = 'trending';
      else if (r >= 0.45) actualDayType = 'normal';
      else if (r >= 0.25) actualDayType = 'range';
      else                actualDayType = 'inside';
    }

    // 4. Key-level outcomes: which of the premarket levels were touched intraday?
    const keyLevelOutcomes = (premarketReport?.key_levels || [])
      .slice(0, 20)
      .map(level => ({
        label:   level.label,
        price:   level.price,
        touched: sessionHigh !== null && sessionLow !== null
          ? level.price <= sessionHigh && level.price >= sessionLow
          : null,
        role:    null,  // Stage 2: classify as support / resistance / target / stop-raid
        notes:   '',
      }));

    // 5. Range estimate error vs premarket expected range
    const pmRange  = premarketReport?.expected_range?.points || null;
    const rangeErr = pmRange && dayRange
      ? Math.round(Math.abs(pmRange - dayRange))
      : null;

    const report = {
      ...base,
      status:           'success',
      actual_session:   {
        open:         sessionOpen,
        high:         sessionHigh,
        low:          sessionLow,
        close:        sessionClose,
        range_points: dayRange ? Math.round(dayRange) : null,
      },
      actual_day_type:          actualDayType,
      actual_volatility_regime: actualRegime,
      key_level_outcomes:       keyLevelOutcomes,
      comparison_to_premarket: {
        premarket_report_found: !!premarketReport,
        bias_called:            premarketReport?.bias            || null,
        day_type_called:        premarketReport?.day_type        || null,
        expected_range_called:  premarketReport?.expected_range  || {},
        narrative_called:       premarketReport?.narrative_report || '',
      },
      grading_placeholders: {
        bias_correct:         null,   // Stage 2 fills
        day_type_correct:     null,   // Stage 2 fills
        range_estimate_error: rangeErr,
        notes:                '',
      },
      narrative_report: narrative || '',
      raw_inputs: {
        quote:           quoteRes,
        bar_count:       bars.length,
        rth_bar_count:   rthBars.length,
        table_rows:      tableRows,
        labels,
      },
    };

    const saved = saveReport({ report_type: 'postclose_report', date: dateStr, data: report });
    return { success: true, path: saved.path, report };

  } catch (err) {
    const failed = { ...base, status: 'failed', error: err.message };
    try { saveReport({ report_type: 'postclose_report', date: dateStr, data: failed }); } catch (_) {}
    return { success: false, error: err.message, report: failed };
  }
}
