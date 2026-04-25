# Architecture

Technical reference for TradingView MCP Jackson. Covers communication flow, module structure, data persistence, the ML pipeline, and how the 7 stages connect.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Communication Flow](#communication-flow)
3. [Project Structure](#project-structure)
4. [Core Modules](#core-modules)
5. [MCP Tools Layer](#mcp-tools-layer)
6. [CLI Layer](#cli-layer)
7. [Data Persistence](#data-persistence)
8. [The 7-Stage Pipeline](#the-7-stage-pipeline)
9. [ML Pipeline (Stages 4–7)](#ml-pipeline-stages-47)
10. [Key Engineering Decisions](#key-engineering-decisions)

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interface                           │
│              Claude Code (chat)  |  tv CLI (terminal)          │
└────────────────────┬────────────────────────┬───────────────────┘
                     │ MCP over stdio          │ JSON to stdout
                     ▼                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    src/server.js (MCP Server)                   │
│  Registers 81 tools, provides selection guidance to Claude      │
└────────────────────┬────────────────────────────────────────────┘
                     │ imports
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                   src/tools/*.js (Tool Wrappers)                │
│  23 files, each wrapping 1–6 core functions as MCP tools        │
└────────────────────┬────────────────────────────────────────────┘
                     │ imports
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                   src/core/*.js (Business Logic)                │
│  20+ modules: chart, data, pine, reports, grading, analytics,   │
│  dataset, modeling, backfill, edge, replay, alerts, watchlist…  │
└────────────────────┬────────────────────────────────────────────┘
                     │ CDP commands
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              src/connection.js (CDP Client)                     │
│  Persistent connection, liveness checks, retry with backoff     │
└────────────────────┬────────────────────────────────────────────┘
                     │ HTTP/WebSocket on localhost:9222
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│           TradingView Desktop (Electron / Chromium)             │
│  Chart widgets, Pine Script engine, strategy tester, replay     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Communication Flow

### MCP path (Claude Code)

1. User asks Claude something in Claude Code
2. Claude selects the appropriate MCP tool based on tool descriptions + CLAUDE.md decision tree
3. Claude Code calls the tool via MCP over stdio
4. `src/server.js` routes the call to the matching tool wrapper in `src/tools/`
5. The tool wrapper calls the relevant function in `src/core/`
6. The core function calls `src/connection.js` to evaluate JavaScript in TradingView's renderer process via CDP
7. The result flows back up the chain as JSON

### CLI path (`tv` command)

1. User runs `tv <command>` in a terminal
2. `src/cli/index.js` routes to the relevant command in `src/cli/commands/`
3. Commands import directly from `src/core/` (bypassing the MCP layer)
4. Output is JSON to stdout, errors to stderr
5. Exit codes: `0` success, `1` error, `2` connection failure

### CDP communication

The Chrome DevTools Protocol connection runs on `localhost:9222`. When a core function needs to read or change the chart, it calls `evaluate()` or `evaluateAsync()` from `connection.js`, which executes JavaScript directly in TradingView's renderer process.

TradingView exposes an internal API surface (`window.TradingViewApi`, `window.TradingView`) that the core modules use. This API is undocumented and subject to change — TradingView Desktop updates can break tools.

---

## Project Structure

```
tradingview-mcp-jackson/
├── src/
│   ├── server.js                ← MCP server entry point (81 tools)
│   ├── connection.js            ← CDP client + known API paths
│   ├── core/
│   │   ├── index.js             ← public API barrel export
│   │   ├── chart.js             ← symbol, timeframe, indicator management
│   │   ├── data.js              ← OHLCV, quotes, indicator values, Pine drawings
│   │   ├── pine.js              ← Pine Script editor, compile, debug
│   │   ├── reports.js           ← premarket/postclose report generation
│   │   ├── morning.js           ← watchlist scan, session brief
│   │   ├── grading.js           ← deterministic grade assignment
│   │   ├── analytics.js         ← statistical analysis (19+ dimensions)
│   │   ├── dataset.js           ← feature engineering, leakage audit, splits
│   │   ├── modeling.js          ← logistic/ridge regression in pure Node.js
│   │   ├── edge.js              ← ML vs. rules evaluation framework
│   │   ├── backfill.js          ← historical replay harness
│   │   ├── replay.js            ← live backtesting with P&L
│   │   ├── alerts.js            ← alert create/list/delete
│   │   ├── watchlist.js         ← watchlist read/add
│   │   ├── indicators.js        ← indicator inputs, visibility
│   │   ├── drawing.js           ← shape drawing on chart
│   │   ├── capture.js           ← screenshots
│   │   ├── ui.js                ← UI automation (click, type, keyboard)
│   │   ├── health.js            ← connection verification
│   │   └── batch.js             ← multi-symbol batch operations
│   ├── tools/
│   │   ├── chart.js             ← chart_set_symbol, chart_get_state, etc.
│   │   ├── data.js              ← data_get_ohlcv, quote_get, etc.
│   │   ├── pine.js              ← pine_set_source, pine_smart_compile, etc.
│   │   ├── morning.js           ← morning_brief, session_save, session_get
│   │   ├── reports.js           ← run_premarket_report, run_postclose_report, etc.
│   │   ├── grading.js           ← grade_trading_date, grade_latest, etc.
│   │   ├── analytics.js         ← rebuild_analytics, get_analytics_summary, etc.
│   │   ├── dataset.js           ← rebuild_dataset, get_dataset_summary, etc.
│   │   ├── modeling.js          ← train_models, get_model_summary, etc.
│   │   ├── edge.js              ← edge_coldstart, edge_evaluate, etc.
│   │   ├── backfill.js          ← backfill_run, backfill_status, etc.
│   │   └── ...                  ← replay, alerts, drawing, ui, etc.
│   └── cli/
│       ├── index.js             ← entry point, imports all commands
│       ├── router.js            ← argument parsing and routing
│       └── commands/
│           ├── morning.js       ← tv brief, tv session
│           ├── reports.js       ← tv report premarket/postclose
│           ├── grading.js       ← tv grade latest/show
│           ├── analytics.js     ← tv analytics summary/rolling/breakdown
│           └── ...              ← chart, data, pine, replay, etc.
├── rules.example.json           ← template for trading rules
├── rules.json                   ← your rules (gitignored, created from example)
├── .env.example                 ← environment variable template
├── .env                         ← your config (gitignored, created from example)
├── CLAUDE.md                    ← tool decision tree for Claude
├── README.md                    ← project overview and quick start
├── SETUP.md                     ← this setup guide
├── ARCHITECTURE.md              ← technical architecture (this file)
├── RESEARCH.md                  ← research context and findings
├── CONTRIBUTING.md              ← contribution guidelines
├── SECURITY.md                  ← security policy
└── package.json
```

---

## Core Modules

### connection.js

The CDP client singleton. Handles:
- Target discovery (`/json/list` → filter for `tradingview.com/chart`)
- Liveness checks (re-evaluates `1` to confirm the connection is alive before each call)
- Reconnection with exponential backoff (500ms → 30s max, 5 attempts)
- Domain initialization: `Runtime`, `Page`, `DOM`
- Known API path registry (`window.TradingViewApi.*`)

All core modules use `evaluate()` and `evaluateAsync()` from this module. CDP is never called directly from tool wrappers.

### chart.js

Symbol changes, timeframe changes, chart type changes, indicator management (add/remove), visible range, scroll to date. Uses `window.TradingViewApi` chart widget methods.

### data.js

Five distinct data access patterns:
- **OHLCV** — reads the main series bars array directly from the chart model
- **Quote** — reads real-time price/volume from the symbol info bus
- **Study values** — reads current numeric outputs from all visible studies
- **Pine graphics** — reads `line.new()`, `label.new()`, `table.new()`, `box.new()` primitives from each study's graphics collection
- **Strategy data** — reads Strategy Tester performance, trades, equity

### pine.js

Full Pine Script IDE automation:
- Source injection via the Pine editor's CodeMirror instance
- Smart compilation with chart update detection
- Error reading from the error panel
- Console log extraction
- Script save/open/list via TradingView's cloud API

### reports.js

Captures indicator state at two points per trading day:
- **Premarket (9:00 ET)**: reads Pine tables, labels, lines, boxes from the NQ Daily Bias Engine. Records predicted bias, day type, key levels, session structure.
- **Postclose (16:15 ET)**: reads actual OHLC, volume, and any end-of-day indicator state.

Reports are saved as JSON files in `~/.tradingview-mcp/reports/YYYY-MM-DD/`.

DST-safe time handling via `Intl.DateTimeFormat` with `America/New_York` timezone.

### grading.js

Deterministic scoring. Takes a premarket report and a postclose report and produces:
- Directional bias score (0–100, 40% weight)
- Day type score (0–100, 35% weight)
- Range accuracy score (0–100, 25% weight)
- Weighted composite (0–100)
- Letter grade (A/B/C/D/F)
- Failure tags for each dimension missed

Scoring excludes missing dimensions and reweights the remainder. Results append to `daily_grades.jsonl`.

### analytics.js

Reads `daily_grades.jsonl` and computes 20+ output files covering overall metrics, rolling windows, 19 dimensional breakdowns (weekday, month, volatility regime, bias direction, data quality, version tracking), drift detection, coverage, failure tag co-occurrence, and best/worst condition cohorts (minimum n=3).

All outputs are saved as JSON files in `~/.tradingview-mcp/analytics/`.

### dataset.js

Converts report+grade pairs into ML training records:
- Extracts ~67 fields per trading day
- Classifies each field as feature (premarket-knowable), label (post-close truth), metadata, or excluded-for-leakage
- Applies median imputation for missing numeric features
- Produces JSONL, CSV, schema, dictionaries, leakage audit, quality report
- Splits chronologically: 70% train / 15% validation / 15% test

### modeling.js

Pure Node.js ML implementations (zero external dependencies):
- **Logistic regression** with L2 regularization via gradient descent (classification tasks)
- **Ridge regression** with alpha parameter (regression tasks)
- **Baseline models**: majority class (classification), mean (regression)
- Feature engineering: standardization (numeric), one-hot encoding (categorical)
- Champion selection: best validation performance, evaluated once on test set
- Outputs: model artifacts, metrics, feature importance, confusion matrices, model cards

Five prediction tasks: `bias_direction`, `day_type`, `range_in_tolerance`, `actual_range_points`, `good_grade`.

### edge.js

Evaluation framework comparing the rules engine, ML models, and baseline:
- Chronological test set evaluation (no lookahead)
- Per-task metrics: hit rate, F1 (macro), MAE, agreement matrices
- Dimensional breakdowns: performance by regime, data quality, etc.
- Promotion gate: 55% ML-rules agreement + 5pp advantage over baseline + minimum live rows
- Sample weighting: accounts for backfill fidelity degradation

The promotion gate is structurally defined but never activated. Rules engine remains sole decision-maker.

### backfill.js

Historical replay harness:
- NYSE-aware trading day schedule (no weekends, respects US holidays)
- DST-safe ET time handling
- Replays premarket (9:00 ET) + postclose (16:15 ET) per trading day
- Marks degraded fidelity (missing quotes, incomplete sessions)
- Auto-grades each replayed day
- Chunked analytics + model rebuilds every N days (default 5)
- Resumable: interrupted batches can continue without data loss

---

## MCP Tools Layer

`src/tools/` contains 23 files. Each file imports functions from one or more core modules and registers them as MCP tools using the `@modelcontextprotocol/sdk` `server.tool()` API.

Tool registration format:
```javascript
server.tool(
  "tool_name",
  "Tool description shown to Claude",
  { /* Zod input schema */ },
  async (params) => {
    const result = await coreFunction(params);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);
```

`src/server.js` imports all 23 tool files and starts the MCP server over stdio.

### Tool count by category

| Category | Tools |
|----------|-------|
| Chart control | 12 |
| Data reading | 8 |
| Pine Script | 10 |
| Morning brief | 3 |
| Reports | 4 |
| Grading | 4 |
| Analytics | 11 |
| Dataset | 9 |
| Shadow ML | 7 |
| Edge evaluation | 9 |
| Backfill | 6 |
| Replay | 6 |
| Drawings | 5 |
| Alerts | 3 |
| Watchlist | 2 |
| Layout / Panes / Tabs | 10 |
| UI automation | 10 |
| Utilities | 5 |
| Batch | 1 |
| **Total** | **81** |

---

## CLI Layer

`src/cli/index.js` imports 24 command modules from `src/cli/commands/`. The router in `src/router.js` parses `process.argv` and dispatches to the matching command.

Each command:
1. Imports directly from `src/core/` (not from `src/tools/`)
2. Calls the core function with parsed CLI arguments
3. Prints the result as formatted JSON to stdout
4. Exits with code `0` (success), `1` (error), or `2` (CDP connection failure)

The CLI is pipe-friendly by design — every command outputs JSON, making it composable with `jq`.

---

## Data Persistence

Everything persists to `~/.tradingview-mcp/` (configurable via `DATA_DIR` in `.env`).

```
~/.tradingview-mcp/
│
├── sessions/
│   └── YYYY-MM-DD.json              ← one file per trading day (morning brief)
│
├── reports/
│   └── YYYY-MM-DD/
│       ├── premarket_nq.json        ← NQ Bias Engine state at 9:00 ET
│       ├── postclose_nq.json        ← actual session outcome + embedded grade
│       └── combined_summary.json    ← human-readable summary of both
│
├── performance/
│   ├── daily_grades.jsonl           ← APPEND-ONLY truth log (never edited)
│   └── summary.json                 ← rebuilt from JSONL
│
├── analytics/
│   ├── summary.json                 ← overall hit rates, grade distribution
│   ├── snapshot.json                ← current state + recent trend
│   ├── rolling_windows.json         ← 5/20/60-day windows
│   ├── breakdowns_by_weekday.json   ← performance by day of week
│   ├── breakdowns_by_month.json     ← performance by calendar month
│   ├── breakdowns_by_regime.json    ← performance by volatility regime
│   ├── breakdowns_by_bias_called.json
│   ├── coverage_metrics.json        ← data completeness
│   ├── drift_metrics.json           ← current vs. historical divergence
│   ├── failure_tag_metrics.json     ← failure category co-occurrence
│   ├── best_conditions.json         ← highest accuracy cohorts (n≥3)
│   ├── worst_conditions.json        ← lowest accuracy cohorts (n≥3)
│   └── recent_misses.json           ← most recent prediction failures
│
├── datasets/
│   ├── nq_daily_bias_dataset.jsonl      ← all records (canonical)
│   ├── nq_daily_bias_dataset.csv        ← same, CSV format
│   ├── nq_daily_bias_dataset_latest.jsonl ← one record per date (deduped)
│   ├── nq_daily_bias_dataset_training.jsonl ← eligibility-filtered rows
│   ├── train_split.jsonl                ← 70% chronological
│   ├── validation_split.jsonl           ← 15%
│   ├── test_split.jsonl                 ← 15%
│   ├── schema.json                      ← all field definitions
│   ├── feature_dictionary.json          ← premarket features with descriptions
│   ├── label_dictionary.json            ← post-close labels with descriptions
│   ├── leakage_audit.json               ← every field classified
│   ├── quality_report.json              ← null rates, sparsity
│   ├── splits_summary.json              ← split sizes and date ranges
│   └── manifest.json                    ← dataset build metadata
│
├── models/
│   ├── bias_direction/
│   │   ├── training_status.json
│   │   ├── champion.json                ← serialized model weights
│   │   ├── baseline.json
│   │   ├── metrics.json
│   │   ├── feature_importance.json
│   │   ├── confusion_matrix.json
│   │   └── model_card.json
│   ├── day_type/                        ← same structure
│   ├── range_in_tolerance/
│   ├── actual_range_points/
│   ├── good_grade/
│   └── shadow/
│       ├── latest_predictions.json      ← most recent inference run
│       └── prediction_history.jsonl     ← all past inference results
│
└── backfill/
    ├── batch_manifest.json              ← all batch metadata
    └── status.json                      ← current batch progress
```

### Immutability design

`daily_grades.jsonl` is append-only. Every grade ever assigned is preserved. Analytics are always rebuilt from this file — never edited in-place. This means:
- You can always reconstruct any historical analytics snapshot
- Grades cannot be accidentally overwritten
- If an analytics rebuild fails, your grade history is safe

---

## The 7-Stage Pipeline

The stages are additive. Each requires the previous to be running.

```
Stage 1: Morning Brief
    └─ requires: rules.json, TradingView running with indicators loaded

Stage 2: Reports + Grading
    └─ requires: NQ Daily Bias Engine indicator on chart
    └─ produces: daily_grades.jsonl (source of truth)

Stage 3: Analytics
    └─ requires: daily_grades.jsonl (at least 5 entries)
    └─ produces: analytics/*.json (20+ files)

Stage 4: Dataset
    └─ requires: reports/YYYY-MM-DD/ pairs (premarket + postclose)
    └─ produces: datasets/*.jsonl, datasets/*.csv

Stage 5: Shadow ML
    └─ requires: datasets/train_split.jsonl (at least 20 rows)
    └─ produces: models/{task}/*.json
    └─ NOTE: predictions never used in live decisions

Stage 6: Dashboard
    └─ requires: all analytics + model artifacts
    └─ produces: Next.js 14 web UI (backed by SQLite)

Stage 7: Weighted Evaluation
    └─ requires: models trained, edge framework initialized
    └─ produces: edge evaluation report, promotion gate status
```

---

## ML Pipeline (Stages 4–7)

### Feature engineering (Stage 4)

Each record in the dataset is built from a premarket+postclose report pair. Features are all fields that were knowable at premarket time:

- Indicator values: bias call, EMA position, RSI level, MACD histogram
- Gap analysis: overnight gap size, gap direction
- Session structure: Asia/London session range, overnight high/low
- Intermarket: DXY, VIX (when available)
- Temporal: weekday, month, trading day of month

Labels are all post-close-only fields:
- Realized bias direction
- Actual day type (trending/range/normal/inside)
- Session OHLC
- Grade and score
- Binary target: `good_grade` (A/B vs. C/D/F)

The leakage audit (`datasets/leakage_audit.json`) classifies every field explicitly. Any field classified `excluded_for_leakage` is stripped from the training dataset.

### Model training (Stage 5)

```
Dataset
  └─ 70% train split
      └─ logistic/ridge regression (gradient descent, up to 1000 iterations)
          └─ validation split: tune regularization, select champion
              └─ test split: evaluate champion once (final score)
```

The test split is evaluated exactly once. If you run `train_models` multiple times, the test evaluation is always held out — it is not used to pick the champion.

Feature preprocessing:
1. Numeric features: median imputation for nulls, then standardization (subtract mean, divide by std)
2. Categorical features: one-hot encoding
3. Both transforms are fit on train split only, then applied to val and test

### Edge evaluation (Stage 7)

The evaluation framework runs three systems on the same test set:

| System | Description |
|--------|-------------|
| Rules engine | Deterministic bias calls from your indicators |
| ML champion | Best model from Stage 5 |
| Baseline | Majority class (classification) or mean (regression) |

Agreement matrix shows where ML and rules engine agree/disagree and whether those agreements are correct.

Promotion gate (never activated):
- ML must agree with rules engine on ≥55% of test cases
- ML must beat baseline by ≥5 percentage points on the primary metric
- Must have ≥N live (non-backfill) graded days

Even if these criteria are met, promotion is not automatic. It requires explicit human action.

---

## Key Engineering Decisions

### Zero external ML dependencies

All model training runs in pure Node.js. No Python, no TensorFlow, no scikit-learn. This means:
- No environment setup beyond `npm install`
- Fully reproducible: same inputs always produce same outputs
- Auditable: every weight update is visible in `modeling.js`
- Portable: runs on any machine with Node.js 18+

The tradeoff: limited to logistic/ridge regression. No gradient boosting, ensembles, or neural networks without adding dependencies.

### Append-only JSONL for grades

`daily_grades.jsonl` is never edited — only appended. Every grade in history is preserved. This means:
- Full audit trail of prediction accuracy
- Analytics can be rebuilt from scratch at any time
- No risk of accidental data loss from a rebuild

### Chronological dataset splits

The 70/15/15 train/val/test split is done in date order, never shuffled. Shuffling would allow future information to leak into the training set — a common mistake in financial ML that produces overly optimistic metrics.

### Shadow-only ML

ML models are explicitly not allowed to influence live trading decisions. The codebase has no code path from `shadow_predict_latest` to any order entry or signal output. This is a deliberate constraint, not a limitation to be removed.

The rules engine remains the sole decision-maker until a human explicitly evaluates the edge report and decides to promote a model — and even then, promotion is advisory, not autonomous.

### DST-aware time handling

All time operations use `Intl.DateTimeFormat` with `America/New_York` for Eastern Time. This handles daylight saving transitions correctly without requiring a timezone library.

### CDP connection pooling

`connection.js` maintains a single persistent CDP client. Before each call, a lightweight liveness check evaluates `1` in the browser context. If the check fails, the client reconnects with exponential backoff. This avoids the overhead of establishing a new connection per tool call.
