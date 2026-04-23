/**
 * CLI for Stage 4 — Dataset / Feature Store.
 *
 * Usage:
 *   tv dataset rebuild   [--train-pct 0.70] [--val-pct 0.15]
 *   tv dataset summary
 *   tv dataset schema
 *   tv dataset features
 *   tv dataset labels
 *   tv dataset quality
 *   tv dataset leakage
 *   tv dataset splits
 *   tv dataset sample    [--count 5]
 */

import { register } from "../router.js";
import * as core from "../../core/dataset.js";

register("dataset", {
  description: "Deterministic dataset / feature store prep (no ML)",
  subcommands: new Map([

    ["rebuild", {
      description: "Rebuild every dataset artifact from local saved reports + grades",
      options: {
        "train-pct": { type: "string", description: "Train split fraction (default 0.70)" },
        "val-pct":   { type: "string", description: "Validation split fraction (default 0.15)" },
      },
      handler: async (opts) => core.rebuildDataset({
        trainPct: opts["train-pct"] ? Number(opts["train-pct"]) : undefined,
        valPct:   opts["val-pct"]   ? Number(opts["val-pct"])   : undefined,
      }),
    }],

    ["summary",   { description: "Compact dataset summary", options: {}, handler: async () => core.getDatasetSummary() }],
    ["schema",    { description: "Canonical row schema",    options: {}, handler: async () => core.getDatasetSchemaObj() }],
    ["features",  { description: "Feature dictionary",      options: {}, handler: async () => core.getFeatureDictionaryObj() }],
    ["labels",    { description: "Label dictionary",        options: {}, handler: async () => core.getLabelDictionaryObj() }],
    ["quality",   { description: "Dataset quality report",  options: {}, handler: async () => core.getDatasetQuality() }],
    ["leakage",   { description: "Per-field leakage audit", options: {}, handler: async () => core.getDatasetLeakageAudit() }],
    ["splits",    { description: "Chronological split summary", options: {}, handler: async () => core.getDatasetSplitSummary() }],

    ["sample", {
      description: "A few trimmed canonical rows for quick inspection",
      options: { count: { type: "string", short: "c", description: "Rows to include (default 5, max 50)" } },
      handler: async ({ count }) =>
        core.getDatasetSample({ count: count ? Number(count) : undefined }),
    }],

  ]),
});
