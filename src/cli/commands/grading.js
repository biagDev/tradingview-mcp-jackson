/**
 * CLI commands for Stage 2 — Grading & Performance.
 *
 * Usage:
 *   tv grade day      [--date YYYY-MM-DD] [--overwrite]
 *   tv grade latest                            [--overwrite]
 *   tv performance summary
 *   tv performance recent [--count 20]
 */

import { register } from "../router.js";
import * as core from "../../core/grading.js";

// ─── Grade commands ───────────────────────────────────────────────────────────

register("grade", {
  description: "Deterministic grading of premarket vs. post-close predictions for NQ1!",
  subcommands: new Map([

    ["day", {
      description: "Grade the saved premarket + post-close pair for a specific trading date",
      options: {
        date: {
          type: "string",
          description: "Trading date YYYY-MM-DD (default: today ET)",
        },
        overwrite: {
          type: "boolean",
          short: "o",
          description: "Re-grade even if an existing grading block is present",
        },
      },
      handler: async ({ date, overwrite }) =>
        core.gradeTradingDate({ date, overwrite: !!overwrite }),
    }],

    ["latest", {
      description: "Grade the most recently saved post-close report",
      options: {
        overwrite: {
          type: "boolean",
          short: "o",
          description: "Re-grade even if already graded",
        },
      },
      handler: async ({ overwrite }) =>
        core.gradeLatest({ overwrite: !!overwrite }),
    }],

  ]),
});

// ─── Performance commands ─────────────────────────────────────────────────────

register("performance", {
  description: "Rolling performance summary for NQ Daily Bias predictions",
  subcommands: new Map([

    ["summary", {
      description: "Return the rolling hit-rate / grade-distribution summary",
      options: {},
      handler: async () => core.getPerformanceSummary(),
    }],

    ["recent", {
      description: "Return the N most recent daily grade records",
      options: {
        count: {
          type: "string",
          short: "c",
          description: "Number of recent days (default 20, max 365)",
        },
      },
      handler: async ({ count }) =>
        core.getRecentGrades({ count: count ? Number(count) : undefined }),
    }],

  ]),
});
