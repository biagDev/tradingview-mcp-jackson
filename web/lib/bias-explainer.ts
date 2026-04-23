/**
 * Deterministic human-friendly labels for the NQ DBE bias-component vector.
 * These are Stage-1-style explainers — no ML, no prose.
 */

export interface BiasComponents {
  daily?:        number;
  h4?:           number;
  pd_location?:  number;
  overnight?:    number;
  dxy?:          number;
  ten_year?:     number;
  rel_strength?: number;
  session?:      number;
  vwap?:         number;
}

export const BIAS_COMPONENT_LABELS: Record<keyof BiasComponents, { label: string; detail: string }> = {
  daily:        { label: 'Daily trend',      detail: 'Daily price structure direction' },
  h4:           { label: 'H4 trend',         detail: '4-hour price structure direction' },
  pd_location:  { label: 'Prior-day loc.',   detail: 'Position vs PDH / PDC / PDL' },
  overnight:    { label: 'Overnight',        detail: 'Globex session direction' },
  dxy:          { label: 'DXY',              detail: 'US Dollar Index (usually inverse)' },
  ten_year:     { label: '10Y yield',        detail: '10-year note yield change' },
  rel_strength: { label: 'Rel. strength',    detail: 'NQ vs ES / SPX this session' },
  session:      { label: 'Session pattern',  detail: 'Asia / London pattern (P1..P4)' },
  vwap:         { label: 'VWAP',             detail: 'Position vs session VWAP' },
};

export function biasComponentEntries(bc: BiasComponents | undefined | null) {
  if (!bc) return [];
  const order: (keyof BiasComponents)[] = [
    'daily','h4','pd_location','overnight','dxy','ten_year','rel_strength','session','vwap',
  ];
  return order.map(k => ({
    key: k,
    label: BIAS_COMPONENT_LABELS[k].label,
    detail: BIAS_COMPONENT_LABELS[k].detail,
    value: bc[k] ?? 0,
  }));
}

/**
 * Build a deterministic invalidation model from structured premarket fields.
 * No free-form prose — pure data lookup.
 */
export interface InvalidationModel {
  bias: 'bullish' | 'bearish' | 'neutral' | null;
  primaryTarget?:        { label: string; price: number };
  secondaryTarget?:      { label: string; price: number };
  primaryInvalidation?:  { label: string; price: number };
  secondaryInvalidation?:{ label: string; price: number };
  expectedLow?:   number;
  expectedHigh?: number;
  watchouts: string[];
}

export function buildInvalidation(
  bias: string | null | undefined,
  snapshot: any,
  expected: any,
  calendar: any,
  dataQuality: any,
): InvalidationModel {
  const pdh = snapshot?.prior_day?.pdh ?? null;
  const pdl = snapshot?.prior_day?.pdl ?? null;
  const pdc = snapshot?.prior_day?.pdc ?? null;
  const vah = snapshot?.value_area?.vah ?? null;
  const val = snapshot?.value_area?.val ?? null;

  const out: InvalidationModel = { bias: (bias as any) ?? null, watchouts: [] };

  if (bias === 'bullish') {
    if (pdh != null) out.primaryTarget       = { label: 'PDH',  price: pdh };
    if (vah != null) out.secondaryTarget     = { label: 'VAH~', price: vah };
    if (pdc != null) out.primaryInvalidation = { label: 'PDC',  price: pdc };
    if (pdl != null) out.secondaryInvalidation = { label: 'PDL', price: pdl };
  } else if (bias === 'bearish') {
    if (pdl != null) out.primaryTarget       = { label: 'PDL',  price: pdl };
    if (val != null) out.secondaryTarget     = { label: 'VAL~', price: val };
    if (pdc != null) out.primaryInvalidation = { label: 'PDC',  price: pdc };
    if (pdh != null) out.secondaryInvalidation = { label: 'PDH', price: pdh };
  } else {
    if (pdh != null) out.primaryInvalidation   = { label: 'PDH', price: pdh };
    if (pdl != null) out.secondaryInvalidation = { label: 'PDL', price: pdl };
  }

  out.expectedLow  = expected?.low  ?? null;
  out.expectedHigh = expected?.high ?? null;

  // Deterministic watchouts
  if (calendar?.early_close === true)             out.watchouts.push('NYSE early-close day — short session');
  if (dataQuality?.completeness && dataQuality.completeness !== 'full')
                                                  out.watchouts.push(`DBE coverage is ${dataQuality.completeness}`);
  if (dataQuality?.fallback_used === true)        out.watchouts.push('Indicator fallback was used — verify DBE values');
  if (snapshot?.regime === 'EXPANSION')           out.watchouts.push('EXPANSION regime — expect wider range & bigger stops');
  if (snapshot?.regime === 'CONTRACTION')         out.watchouts.push('CONTRACTION regime — fade extensions, expect chop');
  if (snapshot?.gap?.category && snapshot.gap.category !== 'N/A' && snapshot.gap.category !== 'None')
                                                  out.watchouts.push(`${snapshot.gap.category} gap at open`);

  return out;
}

/**
 * Sort key levels by proximity to a reference price (default PDC).
 * Returns the N closest.
 */
export function nearestKeyLevels(levels: Array<{ label: string; price: number; type?: string }> | undefined | null, reference: number | null | undefined, n = 10) {
  if (!Array.isArray(levels) || levels.length === 0) return [];
  if (reference == null) return levels.slice(0, n);
  return [...levels]
    .filter(l => typeof l.price === 'number')
    .sort((a, b) => Math.abs(a.price - reference) - Math.abs(b.price - reference))
    .slice(0, n);
}
