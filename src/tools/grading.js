/**
 * MCP tool registrations for Stage 2 — Grading & Performance.
 *
 * Four tools:
 *   grade_trading_date       — grade a specific date (or latest)
 *   grade_latest             — grade the most recent postclose report
 *   get_performance_summary  — rolling hit-rate / grade summary
 *   get_recent_grades        — last N daily grade records
 */

import { z } from "zod";
import { jsonResult } from "./_format.js";
import * as core from "../core/grading.js";

export function registerGradingTools(server) {
  // ─── grade_trading_date ─────────────────────────────────────────────────
  server.tool(
    "grade_trading_date",
    "Deterministically grade the saved premarket vs. post-close reports for a trading date. " +
      "Writes a `grading` block into postclose_nq.json, appends a JSONL record to " +
      "~/.tradingview-mcp/performance/daily_grades.jsonl, and rebuilds summary.json. " +
      "If already graded and overwrite=false (default), returns the existing grade without re-grading.",
    {
      date: z
        .string()
        .optional()
        .describe("Trading date YYYY-MM-DD. Defaults to today in ET."),
      overwrite: z
        .boolean()
        .optional()
        .describe("Re-grade even if an existing `grading` block is already present (default false)."),
    },
    async ({ date, overwrite } = {}) => {
      try {
        return jsonResult(await core.gradeTradingDate({ date, overwrite }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  // ─── grade_latest ───────────────────────────────────────────────────────
  server.tool(
    "grade_latest",
    "Grade the most recently saved post-close report. Convenience wrapper around grade_trading_date.",
    {
      overwrite: z
        .boolean()
        .optional()
        .describe("Re-grade even if already graded (default false)."),
    },
    async ({ overwrite } = {}) => {
      try {
        return jsonResult(await core.gradeLatest({ overwrite }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  // ─── get_performance_summary ────────────────────────────────────────────
  server.tool(
    "get_performance_summary",
    "Return the rolling performance summary: bias hit rate, day-type hit rate, range tolerance rate, " +
      "average score, grade distribution, current streak, and 5/20/60-day rolling windows. " +
      "Reads ~/.tradingview-mcp/performance/summary.json (rebuilt from the JSONL log on demand).",
    {},
    async () => {
      try {
        return jsonResult(core.getPerformanceSummary());
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  // ─── get_recent_grades ──────────────────────────────────────────────────
  server.tool(
    "get_recent_grades",
    "Return the N most recent daily grade records (latest per date). " +
      "Each record contains the called vs. actual bias, day type, range, overall grade, and failure tags.",
    {
      count: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe("Number of recent days to return (default 20, max 365)."),
    },
    async ({ count } = {}) => {
      try {
        return jsonResult(core.getRecentGrades({ count }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );
}
