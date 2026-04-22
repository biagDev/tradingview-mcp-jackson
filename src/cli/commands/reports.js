/**
 * CLI commands for Stage 1 — NQ Daily Bias Report Engine.
 *
 * Usage:
 *   tv report premarket [--date YYYY-MM-DD] [--narrative "..."]
 *   tv report postclose [--date YYYY-MM-DD] [--narrative "..."]
 *   tv report get       [--date YYYY-MM-DD] [--type premarket|postclose|combined]
 *   tv report list      [--count N]
 */

import { register } from "../router.js";
import * as core from "../../core/reports.js";

register("report", {
  description: "NQ Daily Bias report engine — generate and retrieve structured daily reports",
  subcommands: new Map([
    [
      "premarket",
      {
        description:
          "Generate and auto-save an NQ premarket report by reading live TradingView data (~09:00 ET)",
        options: {
          date: {
            type: "string",
            description: "Trading date YYYY-MM-DD (default: today ET)",
          },
          narrative: {
            type: "string",
            short: "n",
            description:
              "Prose narrative from Claude to embed in the report. " +
              "If the report already exists and only this flag is supplied, performs a fast narrative-only upsert.",
          },
        },
        handler: async ({ date, narrative }) =>
          core.generatePremarketReport({ date, narrative }),
      },
    ],

    [
      "postclose",
      {
        description:
          "Generate and auto-save an NQ post-close report by reading live TradingView data (~16:05 ET)",
        options: {
          date: {
            type: "string",
            description: "Trading date YYYY-MM-DD (default: today ET)",
          },
          narrative: {
            type: "string",
            short: "n",
            description: "Prose post-session analysis from Claude to embed in the report.",
          },
        },
        handler: async ({ date, narrative }) =>
          core.generatePostCloseReport({ date, narrative }),
      },
    ],

    [
      "get",
      {
        description: "Retrieve saved NQ report(s) for a given trading date",
        options: {
          date: {
            type: "string",
            description: "Trading date YYYY-MM-DD (default: today ET)",
          },
          type: {
            type: "string",
            short: "t",
            description:
              "Report type: premarket | postclose | combined (default: all three)",
          },
        },
        handler: async ({ date, type: report_type }) =>
          core.getReportByDate({ date, report_type }),
      },
    ],

    [
      "list",
      {
        description:
          "List combined_summary entries for the most recent N trading days",
        options: {
          count: {
            type: "string",     // CLI args arrive as strings; core coerces to number
            short: "c",
            description: "Number of recent days (default: 7, max: 90)",
          },
        },
        handler: async ({ count }) =>
          core.getLatestReports({ count: count ? Number(count) : undefined }),
      },
    ],
  ]),
});
