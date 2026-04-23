/**
 * MCP tool registrations for Stage 3 — Analytics.
 *
 * Every tool is read-only or rebuild — deterministic aggregation over the
 * Stage 2 JSONL grade log. No ML.
 */

import { z } from "zod";
import { jsonResult } from "./_format.js";
import * as core from "../core/analytics.js";

export function registerAnalyticsTools(server) {

  // ─── rebuild_analytics ────────────────────────────────────────────────────
  server.tool(
    "rebuild_analytics",
    "Rebuild every analytics artifact from ~/.tradingview-mcp/performance/daily_grades.jsonl. " +
      "Writes summary, rolling windows, coverage, drift, recent misses, best/worst conditions, " +
      "failure tag metrics, per-dimension breakdowns, and a compact dashboard snapshot to " +
      "~/.tradingview-mcp/analytics/. Returns the dashboard snapshot.",
    {},
    async () => {
      try {
        return jsonResult(core.rebuildAnalytics());
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  // ─── get_analytics_snapshot ───────────────────────────────────────────────
  server.tool(
    "get_analytics_snapshot",
    "Return the compact dashboard snapshot (headline metrics, latest grade, rolling windows, " +
      "top misses, best/worst conditions, drift). Rebuilds on demand if the file is missing.",
    {},
    async () => {
      try {
        return jsonResult(core.getDashboardSnapshot());
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  // ─── get_analytics_summary ────────────────────────────────────────────────
  server.tool(
    "get_analytics_summary",
    "Return the overall performance summary: total days graded, hit rates, average score, " +
      "streaks, and grade distribution.",
    {},
    async () => {
      try {
        return jsonResult(core.getAnalyticsSummary());
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  // ─── get_rolling_windows ──────────────────────────────────────────────────
  server.tool(
    "get_rolling_windows",
    "Return 5/20/60-day rolling performance windows plus all-time metrics.",
    {},
    async () => {
      try {
        return jsonResult(core.getRollingWindows());
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  // ─── get_coverage_metrics ─────────────────────────────────────────────────
  server.tool(
    "get_coverage_metrics",
    "Return grading coverage metrics: % of days with bias/day_type/range graded, " +
      "partial vs. full coverage rates, distribution of graded-dimension combinations.",
    {},
    async () => {
      try {
        return jsonResult(core.getCoverage());
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  // ─── get_drift_metrics ────────────────────────────────────────────────────
  server.tool(
    "get_drift_metrics",
    "Return performance drift: current window vs. prior window for 5-day and 20-day " +
      "cohorts. Indicates whether prediction accuracy is improving or deteriorating.",
    {},
    async () => {
      try {
        return jsonResult(core.getDrift());
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  // ─── get_analytics_breakdown ──────────────────────────────────────────────
  server.tool(
    "get_analytics_breakdown",
    "Return performance grouped by a given dimension (weekday, volatility_regime, " +
      "day_type_called, failure_tags, etc.). Optional rolling window. " +
      "Dimensions: weekday, month, bias_called, bias_actual, day_type_called, " +
      "day_type_actual, volatility_regime, calendar_source, early_close, model_version, " +
      "indicator_version, prompt_version, data_quality_completeness, data_quality_fallback_used, " +
      "partial_grade, expected_range_source, day_type_source, failure_tags.",
    {
      by: z.string().describe("Dimension to group by (see list above)."),
      window: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("Optional: restrict to the last N records before grouping."),
    },
    async ({ by, window } = {}) => {
      try {
        return jsonResult(core.getBreakdown({ by, window }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  // ─── get_recent_misses ────────────────────────────────────────────────────
  server.tool(
    "get_recent_misses",
    "Return the most recent graded days flagged as misses. A miss is any of: " +
      "bias_correct=false, day_type_correct=false, range_within_tolerance=false, " +
      "overall_grade in {D, F, NG}, or partial_grade=true with score < 55.",
    {
      count: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe("Number of recent misses to return (default 10, max 365)."),
    },
    async ({ count } = {}) => {
      try {
        return jsonResult(core.getRecentMisses({ count }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  // ─── get_best_conditions ──────────────────────────────────────────────────
  server.tool(
    "get_best_conditions",
    "Return the best-performing cohorts across every breakdown dimension. Cohorts with " +
      "n < 3 are excluded from ranking. Returns top-5 per dimension and a top-5 global list.",
    {},
    async () => {
      try {
        return jsonResult(core.getBestConditions());
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  // ─── get_worst_conditions ─────────────────────────────────────────────────
  server.tool(
    "get_worst_conditions",
    "Return the worst-performing cohorts across every breakdown dimension. Cohorts with " +
      "n < 3 are excluded from ranking. Returns bottom-5 per dimension and a bottom-5 global list.",
    {},
    async () => {
      try {
        return jsonResult(core.getWorstConditions());
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  // ─── get_failure_tag_metrics ──────────────────────────────────────────────
  server.tool(
    "get_failure_tag_metrics",
    "Return failure tag counts, rates, average-score-by-tag, and tag co-occurrence pairs.",
    {},
    async () => {
      try {
        return jsonResult(core.getFailureTags());
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );
}
