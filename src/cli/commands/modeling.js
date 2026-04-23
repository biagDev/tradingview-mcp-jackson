/**
 * CLI commands for Stage 5 — SHADOW-MODE MODELING.
 *
 * Usage:
 *   tv model train                               (all tasks)
 *   tv model train --task bias_direction
 *   tv model summary
 *   tv model leaderboard
 *   tv model status [--task bias_direction]
 *   tv model inspect --task bias_direction
 *   tv model shadow-predict [--date YYYY-MM-DD]
 *   tv model latest
 */

import { register } from "../router.js";
import * as core from "../../core/modeling.js";

register("model", {
  description: "SHADOW-MODE model training + inference. Rules engine is still production.",
  subcommands: new Map([

    ["train", {
      description: "Train all tasks (or a single --task). Baselines always computed; champion models skipped when history is too small.",
      options: {
        task: {
          type: "string",
          short: "t",
          description: "Single task: bias_direction | day_type | range_in_tolerance | actual_range_points | good_grade",
        },
      },
      handler: async ({ task }) =>
        task ? core.trainTaskModel({ task }) : core.trainAllModels(),
    }],

    ["summary",     { description: "Training summary across all tasks", options: {}, handler: async () => core.getModelSummary() }],
    ["leaderboard", { description: "Per-task leaderboard",              options: {}, handler: async () => core.getModelLeaderboard() }],
    ["latest",      { description: "Read the latest shadow predictions", options: {}, handler: async () => core.getLatestShadow() }],

    ["status", {
      description: "Training status for all tasks (or a single --task)",
      options: { task: { type: "string", short: "t", description: "Filter to one task" } },
      handler: async ({ task }) => core.getTrainingStatus({ task }),
    }],

    ["inspect", {
      description: "Every artifact for a task",
      options: { task: { type: "string", short: "t", description: "Task name" } },
      handler: async ({ task }) => {
        if (!task) throw new Error("--task is required");
        return core.inspectTask({ task });
      },
    }],

    ["shadow-predict", {
      description: "SHADOW MODE: run every champion/baseline on the latest premarket row; does not touch the rules-engine brief",
      options: { date: { type: "string", short: "d", description: "YYYY-MM-DD override" } },
      handler: async ({ date }) => core.predictLatestShadow({ date }),
    }],

  ]),
});
