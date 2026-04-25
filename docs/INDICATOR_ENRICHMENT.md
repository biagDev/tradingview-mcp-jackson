# NQ DBE Indicator — Enrichment Roadmap

The Pine Script `NQ Daily Bias Engine` indicator is the **spine of the entire system**. Every downstream layer (rules engine, grading, analytics, dataset, models, dashboard) reads from what it emits. Improving the indicator produces compounding wins — better features → better reports → better grading → better ML → better dashboards.

This document is a prioritized list of indicator improvements. None of it is Claude-Code work; each item is a Pine Script edit in TradingView.

---

## Tier 1 — High leverage, low effort

### 1. Fill the sparse "hint" labels
Right now these features are 100% null in our dataset and flagged in `quality_report.feature_sparsity_ranking`:
- `rth_open_hint`
- `ib_high_hint`, `ib_low_hint`

**Fix:** emit `label.new` entries at `text="RTH Open 12345.67"`, `text="IB High 12345.67"`, `text="IB Low 12345.67"` once the session has progressed past the relevant moment. The existing parser in `src/core/reports.js` `resolveExpectedRange()` already tries to find these prefixes — once DBE emits them, they'll populate automatically.

**Estimated effort:** 10 lines of Pine Script.

### 2. Emit `Expected High` / `Expected Low` labels directly
Right now our `expected_range` is derived from Value Area (~VAH/VAL) as a fallback. DBE should emit its own authoritative forecast.

Given that our current `expected_range` has MAE 128.68 pts vs a naive mean-predictor's 88.14 pts, DBE has real room to improve here. Suggested approach:
- Compute `expected_high = prior_close + (ATR × k_high)` with `k_high` tuned for the regime (higher in EXPANSION, lower in CONTRACTION)
- Similar for `expected_low`
- Emit as labels with the exact prefix our parser looks for

**Estimated effort:** 20 lines of Pine Script + tuning `k_high`/`k_low` per regime.

### 3. Surface ATR and ATR-5d as dedicated fields, not embedded in text
Current format: `regime_detail = "ATR:441.27 5d:356.85"` — we parse this with regex. Fragile.

**Fix:** emit two new table rows:
- `ATR | 441.27`
- `ATR 5-day | 356.85`

Then `parseATR()` can drop the regex and read them directly.

**Estimated effort:** 4 lines.

---

## Tier 2 — Medium leverage, moderate effort

### 4. Backfill-friendly intermarket sampling
**Root problem:** `request.security("FX:DXY", …)` etc. may not be backdated reliably under TV replay. This is the single biggest fidelity limiter in our backfilled history — 25 of 28 evaluation rows are flagged `degraded_intermarket`.

**Options (from cheapest to cleanest):**

a. **Cache intermarket values at bar close into a persistent array.** Indicators can read history of `request.security()` outputs via `[1]`, `[2]` offsets — store each bar's DXY/10Y/ES/VIX in a shared series, then during replay the historical values come from the stored series instead of `request.security()`.

b. **Accept intermarket as a live-only signal** — drop it from backfill scoring entirely and weight backfilled rows accordingly (already the case via the Stage 7 weighting scheme).

c. **Source historical intermarket data externally** — a tiny companion script that fetches DXY/10Y/ES/VIX daily closes from a reliable historical API and writes a sidecar JSON; `generatePremarketReport` merges when `is_backfill: true`. This adds an external dependency but delivers true historical fidelity.

Recommend option (a) first; it's Pine-only and solves most of the problem.

**Estimated effort:** 30–60 lines of Pine Script per intermarket symbol, + care around `barmerge.gaps_off`.

### 5. Richer session structure
Currently `session_structure.asia.{high,low}` and `london.{high,low}` are often null on backfilled days. The Stage 3 fix (extending backfill replay to 03:00 ET with autoplay) helps, but the indicator itself can be more robust.

**Fix:**
- Define explicit session windows as Pine `session.ismarket` tests against `"ES-US"` or similar
- Store each session's running H/L in `var` variables so they survive bar-gap transitions
- Emit them in the table and as labels

**Estimated effort:** 40 lines.

### 6. Day-type probability calibration
Currently `day_type_probs = {trend: 0, normal: 0, range: 0, inside: 0}` for many post-close reads — this is why `day_type_source` falls back to `inferred_bias_regime` so often.

**Fix:** instead of resetting probabilities at RTH close, freeze them at the 09:30 ET open and keep emitting the frozen values for the rest of the day. Add a separate `day_type_final` field (updated at close) so grading can compare predicted vs actual.

**Estimated effort:** 20 lines + careful session-edge handling.

---

## Tier 3 — Strategic improvements

### 7. Confidence bands on `expected_range`
Instead of a single point estimate, emit low/high bounds:
- `expected_range_p25 / p50 / p75` (or low/mid/high)

This enables calibration analytics ("when DBE says range ∈ [p25,p75], what's the realized-in-band rate?") and gives the dashboard something much richer to render.

**Estimated effort:** 30 lines.

### 8. Explicit bias_total volatility
Track how `bias_total` has moved over the last 5 or 10 RTH sessions:
- `bias_total_volatility_5d`
- Large changes day-to-day suggest regime instability and should feed the confidence band in the narrative.

**Estimated effort:** 15 lines.

### 9. Explicit regime transition flag
When the regime changes (CONTRACTION → EXPANSION or vice versa), emit a one-day flag:
- `regime_transition_today: true|false`

Regime transitions are often the highest-hit-rate days for the rules engine and the system should over-weight them.

**Estimated effort:** 10 lines.

### 10. Session pattern probability (P1/P2/P3/P4)
Currently `session_pattern: "N/A"` most days. DBE should categorize every day using the defined P1–P4 taxonomy (e.g., P3 = Partial Engulf Up = London > Asia High) and emit that pattern even when the classification is weak.

**Estimated effort:** 30 lines.

---

## Measurement

After any Tier 1 / Tier 2 change:

1. Run `tv scheduler run --type premarket` against a live session
2. Inspect `~/.tradingview-mcp/reports/YYYY-MM-DD/premarket_nq.json` to confirm the new fields flowed through
3. Check `~/.tradingview-mcp/datasets/quality_report.json` → `feature_sparsity_ranking` to confirm the field is no longer flagged
4. Run `tv edge retrain` + review `/edge` page to see whether the new signal moves ML hit rates or rules-engine hit rates

The system is designed to surface these measurements automatically — improving the indicator is the single highest-leverage change you can make.
