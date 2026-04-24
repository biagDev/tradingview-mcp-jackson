/**
 * MCP tool registrations for the historical backfill / replay harness.
 */

import { z } from "zod";
import { jsonResult } from "./_format.js";
import * as core from "../core/backfill.js";

export function registerBackfillTools(server) {

  server.tool(
    "backfill_run",
    "Run a replay-driven historical backfill across [from, to]. For each NYSE trading day: " +
      "enters TV replay at 09:00 ET to generate premarket, then at 16:15 ET to generate postclose, " +
      "then grades the day. Every saved artifact is tagged is_backfill=true with fidelity caveats. " +
      "Analytics / dataset / models rebuild every `chunk` days (default 5) and at batch end. " +
      "Idempotent by default — pass overwrite=true to regenerate existing days.",
    {
      from: z.string().describe("Inclusive start date YYYY-MM-DD"),
      to:   z.string().describe("Inclusive end date YYYY-MM-DD"),
      overwrite: z.boolean().optional().describe("Re-generate even if reports already exist"),
      chunk:     z.number().int().min(1).max(50).optional().describe("Rebuild every N days (default 5)"),
      rebuild_end_only: z.boolean().optional().describe("Skip chunk rebuilds; only rebuild at batch end"),
      train_models:     z.boolean().optional().describe("Include model training during rebuilds (default true)"),
    },
    async ({ from, to, overwrite, chunk, rebuild_end_only, train_models } = {}) => {
      try { return jsonResult(await core.runBatch({ from, to, overwrite, chunk, rebuild_end_only, train_models })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "backfill_status",
    "Show current + last batch status with per-date progress and history.",
    {},
    async () => {
      try { return jsonResult(await core.status()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "backfill_resume",
    "Resume the last interrupted batch. Dates already completed are skipped automatically.",
    { train_models: z.boolean().optional() },
    async ({ train_models } = {}) => {
      try { return jsonResult(await core.resume({ train_models })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "backfill_abort",
    "Cleanly mark the currently active batch as aborted. Next `run` starts a fresh batch.",
    {},
    async () => {
      try { return jsonResult(await core.abort()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "backfill_inspect",
    "Inspect a specific date's saved premarket + post-close artifacts, including is_backfill metadata and fidelity caveats.",
    { date: z.string().describe("Trading date YYYY-MM-DD") },
    async ({ date } = {}) => {
      try { return jsonResult(await core.inspect({ date })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "backfill_list_batches",
    "List every backfill batch that has ever run, newest last.",
    {},
    async () => {
      try { return jsonResult(await core.listBatches()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );
}
