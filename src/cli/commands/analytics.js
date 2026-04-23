/**
 * CLI commands for Stage 3 — Analytics.
 *
 * Usage:
 *   tv analytics rebuild
 *   tv analytics summary
 *   tv analytics windows
 *   tv analytics coverage
 *   tv analytics drift
 *   tv analytics breakdown --by weekday [--window 20]
 *   tv analytics recent-misses [--count 10]
 *   tv analytics best
 *   tv analytics worst
 *   tv analytics tags
 *   tv analytics dashboard
 */

import { register } from "../router.js";
import * as core from "../../core/analytics.js";

register("analytics", {
  description: "Deterministic analytics over the daily grade log (no ML)",
  subcommands: new Map([

    ["rebuild", {
      description: "Rebuild every analytics artifact from daily_grades.jsonl",
      options: {},
      handler: async () => core.rebuildAnalytics(),
    }],

    ["summary", {
      description: "Overall performance summary (hit rates, streaks, grade distribution)",
      options: {},
      handler: async () => core.getAnalyticsSummary(),
    }],

    ["windows", {
      description: "Rolling 5/20/60-day performance windows plus all-time",
      options: {},
      handler: async () => core.getRollingWindows(),
    }],

    ["coverage", {
      description: "Grading coverage metrics (partial vs full, dimensions graded)",
      options: {},
      handler: async () => core.getCoverage(),
    }],

    ["drift", {
      description: "Performance drift: current window vs. prior window for 5d and 20d",
      options: {},
      handler: async () => core.getDrift(),
    }],

    ["dashboard", {
      description: "Compact dashboard snapshot for future UI consumption",
      options: {},
      handler: async () => core.getDashboardSnapshot(),
    }],

    ["breakdown", {
      description: "Performance grouped by a dimension (see --by list in code)",
      options: {
        by: {
          type: "string",
          short: "b",
          description: "Dimension: weekday | month | bias_called | bias_actual | day_type_called | day_type_actual | volatility_regime | calendar_source | early_close | model_version | indicator_version | prompt_version | data_quality_completeness | data_quality_fallback_used | partial_grade | expected_range_source | day_type_source | failure_tags",
        },
        window: {
          type: "string",
          short: "w",
          description: "Optional: restrict to last N records before grouping",
        },
      },
      handler: async ({ by, window }) => {
        if (!by) throw new Error("--by is required");
        return core.getBreakdown({ by, window: window ? Number(window) : undefined });
      },
    }],

    ["recent-misses", {
      description: "Most recent graded days flagged as misses",
      options: {
        count: {
          type: "string",
          short: "c",
          description: "Number of recent misses to return (default 10, max 365)",
        },
      },
      handler: async ({ count }) =>
        core.getRecentMisses({ count: count ? Number(count) : undefined }),
    }],

    ["best", {
      description: "Best-performing cohorts across every breakdown dimension (n ≥ 3)",
      options: {},
      handler: async () => core.getBestConditions(),
    }],

    ["worst", {
      description: "Worst-performing cohorts across every breakdown dimension (n ≥ 3)",
      options: {},
      handler: async () => core.getWorstConditions(),
    }],

    ["tags", {
      description: "Failure tag counts, rates, per-tag score, and co-occurrence",
      options: {},
      handler: async () => core.getFailureTags(),
    }],

  ]),
});
