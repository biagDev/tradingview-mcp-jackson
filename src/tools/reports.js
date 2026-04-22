/**
 * MCP tool registrations for Stage 1 — NQ Daily Bias Report Engine.
 *
 * Exposes four tools:
 *   run_premarket_report  — generate + auto-save a premarket report
 *   run_postclose_report  — generate + auto-save a post-close report
 *   get_report_by_date    — retrieve saved report(s) for a given date
 *   list_recent_reports   — list combined_summary entries for the last N days
 */

import { z } from "zod";
import { jsonResult } from "./_format.js";
import * as core from "../core/reports.js";

export function registerReportTools(server) {
  // ─── run_premarket_report ─────────────────────────────────────────────────
  server.tool(
    "run_premarket_report",
    "Generate an NQ premarket report by reading live TradingView data, then auto-save it to ~/.tradingview-mcp/reports/YYYY-MM-DD/premarket_nq.json. " +
      "Reads the NQ Daily Bias Engine indicator (Pine tables, labels, lines, boxes) plus quote and OHLCV. " +
      "Returns the full structured report object. " +
      "Optionally supply a narrative string (Claude's prose analysis) to embed in the report.",
    {
      date: z
        .string()
        .optional()
        .describe("Trading date YYYY-MM-DD. Defaults to today in ET."),
      narrative: z
        .string()
        .optional()
        .describe(
          "Optional prose narrative from Claude to embed in the report. " +
            "If the report already exists, supplying only this field performs a fast narrative-only upsert without re-reading TradingView.",
        ),
    },
    async ({ date, narrative } = {}) => {
      try {
        return jsonResult(await core.generatePremarketReport({ date, narrative }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  // ─── run_postclose_report ─────────────────────────────────────────────────
  server.tool(
    "run_postclose_report",
    "Generate an NQ post-close report by reading live TradingView data after RTH ends (16:00 ET), then auto-save it to ~/.tradingview-mcp/reports/YYYY-MM-DD/postclose_nq.json. " +
      "Reads the same day's premarket report for comparison, then pulls final OHLCV, quote, and DBE state. " +
      "Computes actual session OHLC, day type, key-level hit checks, and bias accuracy grading (placeholder in Stage 1). " +
      "Returns the full structured post-close report object.",
    {
      date: z
        .string()
        .optional()
        .describe("Trading date YYYY-MM-DD. Defaults to today in ET."),
      narrative: z
        .string()
        .optional()
        .describe(
          "Optional prose post-session analysis from Claude to embed in the report.",
        ),
    },
    async ({ date, narrative } = {}) => {
      try {
        return jsonResult(await core.generatePostCloseReport({ date, narrative }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  // ─── get_report_by_date ───────────────────────────────────────────────────
  server.tool(
    "get_report_by_date",
    "Retrieve saved NQ report(s) for a given trading date from ~/.tradingview-mcp/reports/. " +
      "Returns premarket, postclose, and combined_summary objects for the requested date. " +
      "If report_type is specified, returns only that report.",
    {
      date: z
        .string()
        .optional()
        .describe("Trading date YYYY-MM-DD. Defaults to today in ET."),
      report_type: z
        .enum(["premarket", "postclose", "combined"])
        .optional()
        .describe(
          "Specific report type to retrieve. Omit to get all three for the date.",
        ),
    },
    async ({ date, report_type } = {}) => {
      try {
        return jsonResult(core.getReportByDate({ date, report_type }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  // ─── list_recent_reports ──────────────────────────────────────────────────
  server.tool(
    "list_recent_reports",
    "List combined_summary.json entries for the most recent N trading days from ~/.tradingview-mcp/reports/. " +
      "Useful for reviewing recent bias accuracy, day types, and session stats at a glance.",
    {
      count: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe("Number of recent days to return. Defaults to 7, max 90."),
    },
    async ({ count } = {}) => {
      try {
        return jsonResult(core.getLatestReports({ count }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );
}
