/**
 * MCP tool registrations for Stage 5 — SHADOW-MODE MODELING.
 *
 * All tools are local and non-authoritative. The rules-based engine
 * (Stages 1–3) remains the production source of truth. These tools
 * expose hand-rolled logistic regression + ridge regression training,
 * baselines, evaluation, and shadow predictions against the latest
 * saved premarket report.
 */

import { z } from "zod";
import { jsonResult } from "./_format.js";
import * as core from "../core/modeling.js";

export function registerModelingTools(server) {

  server.tool(
    "train_models",
    "Train every task (bias_direction, day_type, range_in_tolerance, " +
      "actual_range_points, good_grade). With insufficient history, baselines " +
      "are trained and champion models are skipped — training_status.json " +
      "artifacts are written either way. Shadow mode only.",
    {},
    async () => {
      try { return jsonResult(core.trainAllModels()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "train_model_task",
    "Train a single task (bias_direction | day_type | range_in_tolerance | " +
      "actual_range_points | good_grade). Writes baseline + (if feasible) " +
      "champion artifacts.",
    {
      task: z.string().describe("Task name"),
    },
    async ({ task } = {}) => {
      try { return jsonResult(core.trainTaskModel({ task })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "get_model_summary",
    "Return the training summary across all tasks (data window, per-task status, " +
      "shadow-mode flag).",
    {},
    async () => {
      try { return jsonResult(core.getModelSummary()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "get_model_leaderboard",
    "Return the per-task leaderboard (champion, metric, validation + test scores).",
    {},
    async () => {
      try { return jsonResult(core.getModelLeaderboard()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "get_model_inspect",
    "Return every artifact for a task: training_status, champion, metrics, " +
      "baseline_metrics, feature_importance, confusion_matrix, model_card.",
    {
      task: z.string().describe("Task name to inspect"),
    },
    async ({ task } = {}) => {
      try { return jsonResult(core.inspectTask({ task })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "get_model_status",
    "Return training_status.json for all tasks (or a specific task).",
    {
      task: z.string().optional().describe("Optional task name to filter to"),
    },
    async ({ task } = {}) => {
      try { return jsonResult(core.getTrainingStatus({ task })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "shadow_predict_latest",
    "SHADOW MODE ONLY. Read the most recent saved premarket report, run every " +
      "task's champion (or baseline when no champion exists), and write the " +
      "predictions to ~/.tradingview-mcp/models/shadow/latest_predictions.json " +
      "and append to prediction_history.jsonl. DOES NOT touch the rules-engine brief.",
    {
      date: z.string().optional().describe("Optional YYYY-MM-DD override; default = latest"),
    },
    async ({ date } = {}) => {
      try { return jsonResult(core.predictLatestShadow({ date })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );
}
