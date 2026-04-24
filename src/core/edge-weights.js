/**
 * Stage 7 — Sample-weight scheme.
 *
 * Central, documented, easily-tunable function that turns per-row metadata +
 * quality into a training weight in [0.20, 1.00]. Used by:
 *   - src/core/dataset.js   (writes sample_weight into quality.sample_weight)
 *   - src/core/modeling.js  (trains with these weights; validation selection
 *                             respects them; test metrics do NOT weight —
 *                             honest evaluation stays honest).
 *
 * ────────────────────────────────────────────────────────────────────────
 * DEFAULT WEIGHTS (per user spec, easily tuned via the constants below)
 *
 *   live       / clean                      1.00
 *   backfill   / clean                      0.80
 *   backfill   / degraded_session           0.60
 *   backfill   / degraded_intermarket       0.50
 *   backfill   / mixed (both degraded)      0.45
 *   partial coverage or fallback (any kind) min-cap 0.40
 *   all three (backfill + degraded + partial)          floor 0.25
 *
 * A sparse row (feature_coverage_pct < 0.40) receives an extra 0.50 multiplier
 * so training doesn't overfit on mostly-null vectors.
 *
 * Ineligible rows (is_training_eligible = false) return 0, consistent with
 * the previous dataset behavior.
 * ────────────────────────────────────────────────────────────────────────
 */

export const EDGE_WEIGHTS_SCHEMA_VERSION = 1;

// Top-level provenance tier
export const WEIGHTS = {
  live_clean:                      1.00,
  backfill_clean:                  0.80,
  backfill_degraded_session:       0.60,
  backfill_degraded_intermarket:   0.50,
  backfill_mixed:                  0.45,
};

// Cap applied when the row has any partial / fallback data-quality flag
export const PARTIAL_COVERAGE_CAP  = 0.40;

// Absolute floor when everything is degraded (backfill + degraded + partial)
export const FLOOR_ALL_DEGRADED    = 0.25;

// Extra penalty for very sparse feature vectors
export const SPARSE_FEATURE_THRESHOLD  = 0.40;
export const SPARSE_FEATURE_MULTIPLIER = 0.50;

// Absolute floor / ceiling
export const MIN_WEIGHT = 0.20;
export const MAX_WEIGHT = 1.00;

/**
 * Compute sample weight from the raw source objects (pre-canonical).
 *
 * @param {object} args
 * @param {object} [args.premarket]  Saved premarket report JSON (may carry is_backfill + backfill_metadata)
 * @param {object} [args.postclose]  Saved postclose report JSON (same fields if backfill-sourced)
 * @param {object} [args.quality]    { is_training_eligible, feature_coverage_pct } — optional
 * @returns {{ weight: number, reason: string, tags: string[] }}
 */
export function computeSampleWeight({ premarket, postclose, quality } = {}) {
  // Eligibility gate — matches dataset.js semantics
  if (quality && quality.is_training_eligible === false) {
    return { weight: 0, reason: 'ineligible', tags: ['ineligible'] };
  }

  const tags = [];
  const isBackfill =
    premarket?.is_backfill === true ||
    postclose?.is_backfill === true;

  // Fidelity comes from whichever side recorded it; prefer premarket
  const fidelity =
    premarket?.backfill_metadata?.replay_fidelity ??
    postclose?.backfill_metadata?.replay_fidelity ??
    null;

  const dqCompleteness =
    premarket?.data_quality?.completeness ??
    postclose?.data_quality?.completeness ??
    null;

  const fallbackUsed =
    premarket?.data_quality?.fallback_used === true ||
    postclose?.data_quality?.fallback_used === true;

  const partial = (dqCompleteness && dqCompleteness !== 'full') || fallbackUsed;

  // ── Base weight by provenance + fidelity ───────────────────────────────
  let weight;
  let reason;
  if (!isBackfill) {
    weight = WEIGHTS.live_clean;     reason = 'live_clean';   tags.push('live');
  } else {
    tags.push('backfill');
    switch (fidelity) {
      case 'degraded_session':
        weight = WEIGHTS.backfill_degraded_session;
        reason = 'backfill_degraded_session';
        tags.push('degraded_session');
        break;
      case 'degraded_intermarket':
        weight = WEIGHTS.backfill_degraded_intermarket;
        reason = 'backfill_degraded_intermarket';
        tags.push('degraded_intermarket');
        break;
      case 'mixed':
        weight = WEIGHTS.backfill_mixed;
        reason = 'backfill_mixed';
        tags.push('mixed_fidelity');
        break;
      case 'full':
      case null:
      case undefined:
      default:
        weight = WEIGHTS.backfill_clean;
        reason = 'backfill_clean';
        break;
    }
  }

  // ── Partial-coverage cap ───────────────────────────────────────────────
  if (partial) {
    tags.push('partial_or_fallback');
    if (weight > PARTIAL_COVERAGE_CAP) {
      weight = PARTIAL_COVERAGE_CAP;
      reason = `${reason}+partial_coverage`;
    }
  }

  // ── Floor when all three degradations stack ────────────────────────────
  if (isBackfill && fidelity && fidelity !== 'full' && partial) {
    if (weight > FLOOR_ALL_DEGRADED) {
      weight = FLOOR_ALL_DEGRADED;
      reason = 'floor_all_degraded';
    }
  }

  // ── Sparsity multiplier ────────────────────────────────────────────────
  const cov = quality?.feature_coverage_pct ?? 1;
  if (typeof cov === 'number' && cov < SPARSE_FEATURE_THRESHOLD) {
    weight *= SPARSE_FEATURE_MULTIPLIER;
    tags.push('sparse_features');
    reason = `${reason}+sparse`;
  }

  // ── Clamp ──────────────────────────────────────────────────────────────
  weight = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, weight));
  weight = Math.round(weight * 1000) / 1000;

  return { weight, reason, tags };
}

/**
 * Return the weight summary for documentation / UI surfacing.
 */
export function getWeightingSchemeDoc() {
  return {
    schema_version: EDGE_WEIGHTS_SCHEMA_VERSION,
    tiers:      WEIGHTS,
    partial_coverage_cap: PARTIAL_COVERAGE_CAP,
    floor_all_degraded:   FLOOR_ALL_DEGRADED,
    sparse_feature_threshold:  SPARSE_FEATURE_THRESHOLD,
    sparse_feature_multiplier: SPARSE_FEATURE_MULTIPLIER,
    bounds: { min: MIN_WEIGHT, max: MAX_WEIGHT },
    notes: [
      'Live clean rows receive full weight (1.00).',
      'Backfilled rows are capped at 0.80 even if fidelity is clean.',
      'Degraded replay fidelity (intermarket, session, mixed) drops weight further.',
      'Partial DBE coverage or fallback_used caps the weight at 0.40.',
      'Backfill + any degradation + partial coverage enforces a 0.25 floor.',
      'Rows below 40% feature coverage receive an additional 0.50 multiplier.',
      'Training uses these weights; test metrics are UNWEIGHTED (honest eval).',
    ],
  };
}
