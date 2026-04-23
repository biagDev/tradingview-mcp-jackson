/**
 * Deterministic premarket narrative generator.
 *
 * Reads the structured premarket report and emits a short, trader-readable
 * multi-paragraph summary. No LLM. No chat context. Pure template over
 * structured fields. Every sentence is independently guarded against
 * missing data — if a field is null the sentence is skipped.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROVIDER ARCHITECTURE (hybrid upgrade path)
 *
 * This module implements the `deterministic` narrative provider. A future
 * `llm` provider can be registered in NARRATIVE_PROVIDERS below without
 * changes to reports.js, the scheduler, the app sync, or the dashboard —
 * any provider returns the same { text, metadata } shape.
 *
 *   const provider = getNarrativeProvider('deterministic');
 *   const { text, metadata } = provider(report);
 *
 * Stored on disk (in premarket_nq.json) as:
 *   narrative_report       — string   (the prose)
 *   narrative_metadata     — object   { provider, version, generated_at_utc, sections }
 *
 * Caller-supplied narratives (e.g. when Claude calls
 * run_premarket_report --narrative "...") take precedence; the
 * deterministic generator is a fallback, not a replacement.
 * ────────────────────────────────────────────────────────────────────────
 */

const NARRATIVE_SCHEMA_VERSION = '1.0.0';
const PROVIDER_NAME            = 'deterministic';

// ─── Bias-component labels (stable ordering) ──────────────────────────────────

const BC_LABEL = {
  daily:        'Daily',
  h4:           'H4',
  pd_location:  'PDLoc',
  overnight:    'ON',
  dxy:          'DXY',
  ten_year:     '10Y',
  rel_strength: 'RS',
  session:      'Sess',
  vwap:         'VWAP',
};

const BC_ORDER = ['daily','h4','pd_location','overnight','dxy','ten_year','rel_strength','session','vwap'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (v, d = 2) => {
  if (v == null || typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
};
const signed = (v) => v == null ? null : `${v >= 0 ? '+' : ''}${v}`;

function nowISO() { return new Date().toISOString(); }

// ─── Section builders — each returns string | null ────────────────────────────

/**
 * Bias direction + top component drivers.
 * "NQ leans bullish (+5, Bullish). Top drivers: Daily +1, H4 +1, ON +1, RS +1, VWAP +1."
 */
export function buildBiasNarrative(report) {
  const bias      = report?.bias;
  const biasTotal = report?.indicator_snapshot?.bias_total ?? null;
  const biasLabel = report?.indicator_snapshot?.bias_label ?? null;
  const conf      = report?.confidence;

  if (!bias) return null;

  const lean = {
    bullish: conf != null && conf >= 6 ? 'is strongly bullish' :
             conf != null && conf >= 4 ? 'leans bullish'       : 'tilts bullish',
    bearish: conf != null && conf >= 6 ? 'is strongly bearish' :
             conf != null && conf >= 4 ? 'leans bearish'       : 'tilts bearish',
    neutral: 'is neutral / mixed',
  }[bias] ?? `is ${bias}`;

  const scoreStr = biasTotal != null
    ? ` (score ${signed(biasTotal)}${biasLabel ? `, ${biasLabel}` : ''})`
    : '';

  // Surface the non-zero components
  const bc = report?.indicator_snapshot?.bias_components ?? {};
  const drivers = BC_ORDER
    .filter(k => typeof bc[k] === 'number' && bc[k] !== 0)
    .sort((a, b) => Math.abs(bc[b]) - Math.abs(bc[a]))
    .slice(0, 5)
    .map(k => `${BC_LABEL[k]} ${signed(bc[k])}`);

  let s = `NQ premarket ${lean}${scoreStr}.`;
  if (drivers.length > 0) s += ` Top drivers: ${drivers.join(', ')}.`;
  return s;
}

/**
 * Day-type + source.
 * "Day type: trending (inferred from bias strength + EXPANSION regime)."
 */
export function buildDayTypeNarrative(report) {
  const dt  = report?.day_type;
  const src = report?.day_type_source;
  if (!dt || dt === 'pending') return null;

  const sourceText = {
    dbe_probs:              'from DBE probability rows',
    inferred_bias_regime:   'inferred from bias strength + regime',
    none:                   'source unavailable',
  }[src] ?? (src ? `source: ${src}` : null);

  return sourceText ? `Day type: ${dt} (${sourceText}).` : `Day type: ${dt}.`;
}

/**
 * Expected range + regime context.
 * "Expected range: 286 pts (26847–27133), sourced from value_area.
 *  EXPANSION regime — ATR:456.84 5d:356.85."
 */
export function buildRangeNarrative(report) {
  const er = report?.expected_range ?? {};
  const pts = er.points;
  if (pts == null) return null;

  const low  = er.low  != null ? fmt(er.low, 0)  : null;
  const high = er.high != null ? fmt(er.high, 0) : null;
  const src  = er.source;

  let s = `Expected range: ${pts} pts`;
  if (low && high) s += ` (${low} — ${high})`;
  if (src) s += `, sourced from ${src}`;
  s += '.';

  const regime    = report?.volatility_regime ?? report?.indicator_snapshot?.regime;
  const regDetail = report?.indicator_snapshot?.regime_detail;
  if (regime) {
    s += ` ${regime} regime`;
    if (regDetail) s += ` — ${regDetail}`;
    s += '.';
  }
  return s;
}

/**
 * Intermarket cross-asset read.
 * "Intermarket: DXY -0.04%, 10Y +0.09%, ES -0.24%, VIX 18.92."
 */
export function buildIntermarketNarrative(report) {
  const im = report?.indicator_snapshot?.intermarket ?? report?.intermarket;
  if (!im) return null;
  const parts = [];
  if (typeof im.dxy_pct      === 'number') parts.push(`DXY ${signed(im.dxy_pct)}%`);
  if (typeof im.ten_year_pct === 'number') parts.push(`10Y ${signed(im.ten_year_pct)}%`);
  if (typeof im.es_pct       === 'number') parts.push(`ES ${signed(im.es_pct)}%`);
  if (typeof im.vix          === 'number') parts.push(`VIX ${fmt(im.vix, 2)}`);
  if (parts.length === 0) return null;
  return `Intermarket: ${parts.join(', ')}.`;
}

/**
 * Targets + invalidations structured from PDH/PDC/PDL + value area.
 * "Primary target PDH 27136; secondary VAH~ 27133.
 *  Primary invalidation on break of PDC 27106.5; secondary PDL 26727.75."
 */
export function buildLevelsNarrative(report) {
  const bias = report?.bias;
  const pd   = report?.indicator_snapshot?.prior_day ?? {};
  const va   = report?.indicator_snapshot?.value_area ?? {};

  const pdh = pd.pdh ?? null, pdc = pd.pdc ?? null, pdl = pd.pdl ?? null;
  const vah = va.vah ?? null, val = va.val ?? null;

  const parts = [];
  if (bias === 'bullish') {
    if (pdh != null) parts.push(`primary target PDH ${fmt(pdh, 2)}`);
    if (vah != null) parts.push(`secondary VAH~ ${fmt(vah, 2)}`);
    if (pdc != null) parts.push(`primary invalidation on break of PDC ${fmt(pdc, 2)}`);
    if (pdl != null) parts.push(`secondary PDL ${fmt(pdl, 2)}`);
  } else if (bias === 'bearish') {
    if (pdl != null) parts.push(`primary target PDL ${fmt(pdl, 2)}`);
    if (val != null) parts.push(`secondary VAL~ ${fmt(val, 2)}`);
    if (pdc != null) parts.push(`primary invalidation on break of PDC ${fmt(pdc, 2)}`);
    if (pdh != null) parts.push(`secondary PDH ${fmt(pdh, 2)}`);
  } else {
    if (pdh != null && pdl != null) parts.push(`outer bounds PDH ${fmt(pdh, 2)} / PDL ${fmt(pdl, 2)}`);
    else return null;
  }
  if (parts.length === 0) return null;
  return `Structural levels: ${parts.join('; ')}.`;
}

/**
 * Deterministic watchouts.
 * "Watchouts: NYSE early close, EXPANSION regime — wider stops, partial DBE coverage."
 */
export function buildWatchoutsNarrative(report) {
  const wo = [];
  if (report?.calendar?.early_close === true)           wo.push('NYSE early-close day');
  if (report?.indicator_snapshot?.regime === 'EXPANSION')   wo.push('EXPANSION regime — wider stops');
  if (report?.indicator_snapshot?.regime === 'CONTRACTION') wo.push('CONTRACTION regime — fade extensions');
  const gapCat = report?.indicator_snapshot?.gap?.category ?? report?.gap_analysis?.category;
  if (gapCat && gapCat !== 'N/A' && gapCat !== 'None')  wo.push(`${gapCat} gap at open`);
  const dq = report?.data_quality ?? {};
  if (dq.completeness && dq.completeness !== 'full')    wo.push(`DBE coverage ${dq.completeness}`);
  if (dq.fallback_used === true)                         wo.push('indicator fallback used');
  if (wo.length === 0) return null;
  return `Watchouts: ${wo.join(', ')}.`;
}

/**
 * Optional data-quality postscript only when something is degraded.
 */
export function buildDataQualityNarrative(report) {
  const dq = report?.data_quality ?? {};
  if (dq.completeness === 'full' && dq.fallback_used !== true) return null;
  // All real warnings already fold into buildWatchoutsNarrative — skip double-reporting.
  return null;
}

// ─── Top-level provider: deterministic ────────────────────────────────────────

/**
 * Compose every section into a short narrative.
 *
 * @param {object} report  Premarket report (as produced by src/core/reports.js)
 * @returns {{ text: string, metadata: object }}
 */
export function generatePremarketNarrative(report) {
  const sections = [
    { name: 'bias',        text: buildBiasNarrative(report) },
    { name: 'day_type',    text: buildDayTypeNarrative(report) },
    { name: 'range',       text: buildRangeNarrative(report) },
    { name: 'intermarket', text: buildIntermarketNarrative(report) },
    { name: 'levels',      text: buildLevelsNarrative(report) },
    { name: 'watchouts',   text: buildWatchoutsNarrative(report) },
  ].filter(s => s.text);

  const text = sections.map(s => s.text).join('\n\n');

  return {
    text,
    metadata: {
      provider:           PROVIDER_NAME,
      version:            NARRATIVE_SCHEMA_VERSION,
      generated_at_utc:   nowISO(),
      sections:           sections.map(s => s.name),
      caller_supplied:    false,
    },
  };
}

// ─── Provider registry ────────────────────────────────────────────────────────
//
// To add an LLM provider later, register it here. Every provider must return
// the same { text: string, metadata: object } shape; nothing else needs to
// change in the pipeline.

export const NARRATIVE_PROVIDERS = {
  deterministic: generatePremarketNarrative,
  // llm: <future LLM-backed provider — must return { text, metadata }>
};

export function getNarrativeProvider(name = 'deterministic') {
  return NARRATIVE_PROVIDERS[name] ?? NARRATIVE_PROVIDERS.deterministic;
}

/**
 * Build metadata for a caller-supplied (e.g. Claude-authored) narrative so
 * downstream consumers can distinguish it from an auto-generated one.
 */
export function buildCallerSuppliedMetadata() {
  return {
    provider:         'caller_supplied',
    version:          NARRATIVE_SCHEMA_VERSION,
    generated_at_utc: nowISO(),
    sections:         [],
    caller_supplied:  true,
  };
}
