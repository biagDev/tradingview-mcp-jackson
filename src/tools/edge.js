/**
 * MCP tool registrations for Stage 7 — Edge Acceleration.
 *
 * All tools are research / shadow only. The rules engine remains the sole
 * production decision-maker. `edge_promotion_check` REPORTS promotion
 * readiness; it never promotes.
 */

import { z } from "zod";
import { jsonResult } from "./_format.js";
import * as core from "../core/edge.js";

export function registerEdgeTools(server) {

  server.tool(
    "edge_coldstart",
    "Research workflow: backfill N trading days → rebuild dataset → retrain all models with weighted samples → shadow predict → honest ML-vs-rules-vs-baseline evaluation → app DB sync. Rules engine remains production throughout.",
    {
      days:          z.number().int().min(1).max(365).optional().describe("Trading days of history to backfill (default 90)"),
      chunk:         z.number().int().min(1).max(50).optional().describe("Backfill chunk size (default 10)"),
      overwrite:     z.boolean().optional().describe("Regenerate already-present report files"),
      skip_backfill: z.boolean().optional().describe("Run retrain + evaluate only; skip the replay step"),
    },
    async ({ days, chunk, overwrite, skip_backfill } = {}) => {
      try { return jsonResult(await core.coldStart({ days, chunk, overwrite, skip_backfill })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "edge_retrain",
    "Rebuild dataset + retrain all tasks with current sample weights + evaluate.",
    {},
    async () => {
      try { return jsonResult(await core.retrain()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "edge_evaluate",
    "Run the ML-vs-rules-vs-baseline comparison on chronological validation+test rows. Writes evaluation_summary.json, agreement_matrix.json, champion_report.json, and per-dimension breakdowns.",
    {},
    async () => {
      try { return jsonResult(await core.evaluate()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "edge_status",
    "Current edge state: last coldstart summary, last training run, last evaluation, weighting scheme, promotion check.",
    {},
    async () => {
      try { return jsonResult(core.status()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "edge_report",
    "Champion model report per task (bias_direction, actual_range_points) with full validation metrics.",
    {},
    async () => {
      try { return jsonResult(core.getChampionReport()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "edge_agreement_matrix",
    "Agreement matrix between rules engine and ML champion for bias_direction (rules → ML counts).",
    {},
    async () => {
      try { return jsonResult(core.getAgreementMatrix()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "edge_summary",
    "Flat evaluation summary: rules / ML / baseline hit rates + advantages + regime-win count.",
    {},
    async () => {
      try { return jsonResult(core.getEvaluationSummary()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "edge_weighting_scheme",
    "Documented sample-weighting scheme (live / backfill / fidelity / sparsity).",
    {},
    async () => {
      try { return jsonResult(core.getWeightingScheme()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "edge_promotion_check",
    "DEFINITION ONLY — evaluates whether the ML champion would meet promotion criteria. This tool never promotes; the rules engine remains production regardless of result.",
    {},
    async () => {
      try { return jsonResult(core.getPromotionCheck()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );
}
