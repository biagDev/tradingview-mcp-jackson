/**
 * MCP tool registrations for Stage 4 — Dataset / Feature Store.
 * Read-only or rebuild. No ML.
 */

import { z } from "zod";
import { jsonResult } from "./_format.js";
import * as core from "../core/dataset.js";

export function registerDatasetTools(server) {

  server.tool(
    "rebuild_dataset",
    "Rebuild every dataset artifact from saved premarket/postclose reports and daily_grades.jsonl. " +
      "Writes canonical/latest/training-ready JSONL + CSV, chronological train/val/test splits, " +
      "schema, feature + label dictionaries, leakage audit, quality report, and a manifest. " +
      "Returns the summary.",
    {
      train_pct: z.number().min(0.1).max(0.95).optional().describe("Train split fraction (default 0.70)"),
      val_pct:   z.number().min(0.01).max(0.5).optional().describe("Validation split fraction (default 0.15)"),
    },
    async ({ train_pct, val_pct } = {}) => {
      try { return jsonResult(core.rebuildDataset({ trainPct: train_pct, valPct: val_pct })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "get_dataset_summary",
    "Return the compact dataset summary (row counts, date range, feature/label availability, " +
      "version coverage, split ratios).",
    {},
    async () => {
      try { return jsonResult(core.getDatasetSummary()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "get_dataset_schema",
    "Return the canonical row shape: metadata/features/labels/quality/lineage layout, " +
      "field counts, storage paths.",
    {},
    async () => {
      try { return jsonResult(core.getDatasetSchemaObj()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "get_feature_dictionary",
    "Return the feature dictionary: every feature with name, type, source, description, " +
      "allowed values, nullable flag, stage introduced, leakage status, and recommended usage.",
    {},
    async () => {
      try { return jsonResult(core.getFeatureDictionaryObj()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "get_label_dictionary",
    "Return the label dictionary: every label and derived binary target, with types, " +
      "sources, descriptions, and usage guidance.",
    {},
    async () => {
      try { return jsonResult(core.getLabelDictionaryObj()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "get_dataset_quality",
    "Return the dataset quality report: row counts, null rates per feature/label, " +
      "coverage distribution, eligibility counts, exclusion reasons, sparsity ranking, " +
      "version distribution, and date range.",
    {},
    async () => {
      try { return jsonResult(core.getDatasetQuality()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "get_dataset_leakage_audit",
    "Return the per-field leakage audit: every field classified as feature_allowed, " +
      "label_only, metadata_only, excluded_for_leakage, or excluded_for_sparsity.",
    {},
    async () => {
      try { return jsonResult(core.getDatasetLeakageAudit()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "get_dataset_splits",
    "Return the chronological split summary (train/validation/test counts, date ranges, " +
      "feature coverage, class balances).",
    {},
    async () => {
      try { return jsonResult(core.getDatasetSplitSummary()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    "get_dataset_sample",
    "Return a small set of trimmed canonical rows for quick inspection (most recent N).",
    {
      count: z.number().int().min(1).max(50).optional()
        .describe("Number of recent rows (default 5, max 50)"),
    },
    async ({ count } = {}) => {
      try { return jsonResult(core.getDatasetSample({ count })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );
}
