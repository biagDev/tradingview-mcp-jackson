# TradingView MCP Jackson

A production-grade AI trading analysis framework — connects Claude Code to TradingView Desktop via the Model Context Protocol and Chrome DevTools Protocol. 81 tools for chart control, Pine Script development, daily performance tracking, statistical analytics, and shadow ML research.

Built on top of [tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp) by [@tradesdontlie](https://github.com/tradesdontlie). Full credit to them for the CDP foundation. This fork adds a 7-stage analysis pipeline on top: morning briefs, automated reporting, deterministic grading, analytics, feature engineering, shadow ML models, and honest evaluation.

> [!WARNING]
> **Not affiliated with TradingView Inc. or Anthropic.** This tool connects to your locally running TradingView Desktop app via Chrome DevTools Protocol. Review the [Disclaimer](#disclaimer) before use.

> [!IMPORTANT]
> **Requires a valid TradingView subscription.** This tool does not bypass any TradingView paywall. It reads from and controls the TradingView Desktop app already running on your machine.

> [!NOTE]
> **All data processing happens locally.** Nothing is sent anywhere. No TradingView data leaves your machine. All ML models are trained on your local data using pure Node.js — no Python, no cloud APIs.

---

## What This Is

At its core, this tool lets Claude control your TradingView chart. But what makes it useful for serious traders is the **feedback loop** built on top:

1. **Every morning** — Claude scans your watchlist, reads your indicators, applies your rules, and produces a structured session bias
2. **Every evening** — Claude records what actually happened and compares it against the morning's prediction
3. **Over time** — a grading engine scores each day, an analytics layer finds your patterns, and a shadow ML system quietly trains on your history to look for edges

All trading decisions stay with you and your rules. The ML layer is research-only — it observes, evaluates, and learns, but never touches live decisions.

---

## Quick Start

For full setup instructions see [SETUP.md](SETUP.md). For architecture details see [ARCHITECTURE.md](ARCHITECTURE.md).

### 1. Prerequisites

- **TradingView Desktop** (paid subscription required for real-time data)
- **Node.js 18+** — check with `node --version`
- **Claude Code** — [install here](https://claude.ai/code)
- macOS, Windows, or Linux

### 2. Install

```bash
git clone https://github.com/biagDev/tradingview-mcp-jackson.git ~/tradingview-mcp-jackson
cd ~/tradingview-mcp-jackson
npm install
```

### 3. Configure your trading rules

```bash
cp rules.example.json rules.json
```

Open `rules.json` and fill in your watchlist, bias criteria, and risk rules. See [SETUP.md → Rules Configuration](SETUP.md#rules-configuration) for details.

### 4. Launch TradingView with the debug port enabled

**macOS:**
```bash
./scripts/launch_tv_debug_mac.sh
```

**Windows:**
```batch
scripts\launch_tv_debug.bat
```

**Linux:**
```bash
./scripts/launch_tv_debug_linux.sh
```

Or after MCP setup: ask Claude to `"use tv_launch to start TradingView in debug mode"`.

### 5. Add to Claude Code

Add to `~/.claude/.mcp.json` — merge with any existing servers, don't overwrite:

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/tradingview-mcp-jackson/src/server.js"]
    }
  }
}
```

Replace `YOUR_USERNAME` with your actual system username (`echo $USER` on Mac/Linux).

### 6. Verify the connection

Restart Claude Code, then ask:

```
Use tv_health_check to verify TradingView is connected
```

### 7. Run your first morning brief

```
Run morning_brief and give me my session bias for today
```

Or from the terminal:

```bash
npm link   # install the tv CLI globally (one time only)
tv brief
```

---

## The 7-Stage System

This project is built in stages. Each stage adds a layer on top of the previous one. You can stop at any stage — the early stages work independently.

### Stage 1 — Morning Brief + Rules Engine

Claude scans your watchlist, reads your indicators, applies `rules.json`, and produces a structured daily session bias. Session briefs are saved to `~/.tradingview-mcp/sessions/` so you can compare day-over-day.

**Tools:** `morning_brief`, `session_save`, `session_get`

**Output:**
```
BTCUSD  | BIAS: Bearish  | KEY LEVEL: 94,200  | WATCH: RSI crossing 50 on 4H
ETHUSD  | BIAS: Neutral  | KEY LEVEL: 3,180   | WATCH: Ribbon direction on daily
SOLUSD  | BIAS: Bullish  | KEY LEVEL: 178.50  | WATCH: Hold above 20 EMA

Overall: Cautious session. BTC leading bearish, SOL the exception — watch for divergence.
```

### Stage 2 — Automated Reports + Grading

Pre-market (9:00 ET) and post-close (16:15 ET) reports capture your NQ Daily Bias Engine's predictions and the day's actual outcome. A deterministic grading engine compares them:

- **Directional bias** — did your indicator call bullish/bearish/neutral correctly? (40% weight)
- **Day type** — trending, range, normal, inside? (35% weight)
- **Range accuracy** — within ±15% of predicted points? (25% weight)

Each day gets a letter grade (A–F) and a numeric score (0–100). Results append to `~/.tradingview-mcp/performance/daily_grades.jsonl` — an immutable audit log.

**Tools:** `run_premarket_report`, `run_postclose_report`, `grade_trading_date`, `grade_latest`, `get_recent_grades`, `get_performance_summary`

### Stage 3 — Analytics

Once you have graded days, the analytics layer calculates performance across 19+ dimensions:

- Rolling windows: 5-day, 20-day, 60-day hit rates
- Temporal breakdowns: by weekday, by month
- Market regime breakdowns: volatility regime, bias direction called
- Drift detection: is your current performance diverging from your historical average?
- Failure tag co-occurrence: what patterns appear in your misses?
- Best/worst conditions: which setups are you most and least accurate on?

**Tools:** `rebuild_analytics`, `get_analytics_summary`, `get_analytics_snapshot`, `get_rolling_windows`, `get_drift_metrics`, `get_coverage_metrics`, `get_analytics_breakdown`, `get_recent_misses`, `get_best_conditions`, `get_worst_conditions`, `get_failure_tag_metrics`

### Stage 4 — Feature Engineering + Dataset

Every premarket/postclose report pair is converted into a structured ML record. Fields are classified as features (premarket-knowable), labels (post-close truth), metadata, or excluded-for-leakage. An explicit leakage audit ensures no post-close information bleeds into features.

The dataset is split chronologically (70% train / 15% val / 15% test — no shuffling) and rebuilt as JSONL and CSV files in `~/.tradingview-mcp/datasets/`.

**Tools:** `rebuild_dataset`, `get_dataset_summary`, `get_dataset_schema`, `get_dataset_sample`, `get_feature_dictionary`, `get_label_dictionary`, `get_dataset_quality`, `get_dataset_leakage_audit`, `get_dataset_splits`

### Stage 5 — Shadow ML Models

Five prediction tasks train in pure Node.js (no Python, no TensorFlow):

| Task | Type | Baseline comparison |
|------|------|-------------------|
| `bias_direction` | 3-class (bullish/bearish/neutral) | Rules engine: 53.6% |
| `day_type` | 4-class (trending/range/normal/inside) | Majority class baseline |
| `range_in_tolerance` | Binary (±15% accuracy) | Mean baseline |
| `actual_range_points` | Regression | Mean baseline |
| `good_grade` | Binary (A/B vs. C/D/F) | Majority class baseline |

Algorithms: logistic regression with L2 regularization (classification) and ridge regression (regression), both trained via gradient descent. Baseline models provide the comparison floor.

**Status: shadow-only.** ML predictions are never used in live decisions. The rules engine remains the sole production decision-maker.

**Tools:** `train_models`, `train_model_task`, `get_model_summary`, `get_model_leaderboard`, `get_model_inspect`, `get_model_status`, `shadow_predict_latest`

### Stage 6 — Local Dashboard

A Next.js 14 dashboard renders all analytics artifacts (grading history, rolling windows, model cards, dimensional breakdowns) with production (rules engine, green badges) vs. research (ML, amber badges) separation backed by SQLite.

### Stage 7 — Weighted Retraining + Honest Evaluation

Sample weights account for backfill fidelity degradation. A promotion gate checks whether ML is ready to move from shadow to advisory mode (criteria: 55% agreement with rules, 5pp advantage over baseline, minimum live data rows). The gate is defined but never activated — rules engine remains sole authority.

**Tools:** `edge_coldstart`, `edge_retrain`, `edge_evaluate`, `edge_status`, `edge_report`, `edge_agreement_matrix`, `edge_summary`, `edge_promotion_check`, `edge_weighting_scheme`

---

## Daily Workflow

### Morning (before market open)

```bash
tv brief
# or ask Claude: "Run morning_brief and give me today's session bias"
```

### Pre-market (9:00 ET)

```
Ask Claude: "Run the premarket report for today"
```

Captures NQ Daily Bias Engine predictions, key levels, session structure.

### Post-close (after 16:00 ET)

```
Ask Claude: "Run the postclose report and grade today"
```

Records actual OHLC, compares against premarket, assigns letter grade.

### Weekly review

```
Ask Claude: "Rebuild analytics and show me my 20-day rolling performance"
Ask Claude: "What are my worst performing conditions this month?"
Ask Claude: "Retrain the shadow models and show me the edge report"
```

---

## Tool Reference

### Morning Brief

| Tool | What it does |
|------|-------------|
| `morning_brief` | Scan watchlist, read indicators, apply `rules.json`, return structured session bias |
| `session_save` | Save generated brief to `~/.tradingview-mcp/sessions/YYYY-MM-DD.json` |
| `session_get` | Retrieve today's saved brief (or yesterday's if today not yet saved) |

### Reports

| Tool | What it does |
|------|-------------|
| `run_premarket_report` | Capture NQ Bias Engine state at market open (Pine tables, labels, lines, boxes) |
| `run_postclose_report` | Record actual session OHLC + compare against premarket predictions |
| `get_report_by_date` | Retrieve any saved report by date |
| `list_recent_reports` | List reports from the last N trading days |

### Grading

| Tool | What it does |
|------|-------------|
| `grade_trading_date` | Grade a specific date (requires both premarket + postclose reports) |
| `grade_latest` | Grade the most recent ungraded trading day |
| `get_recent_grades` | Show grades for the last N days with scores and failure tags |
| `get_performance_summary` | Overall hit rates, grade distribution, streaks |

### Analytics

| Tool | What it does |
|------|-------------|
| `rebuild_analytics` | Recompute all analytics from the grades JSONL |
| `get_analytics_summary` | Overall metrics: hit rates, averages, grade distribution |
| `get_analytics_snapshot` | Current state + recent trend |
| `get_rolling_windows` | 5/20/60-day performance windows |
| `get_drift_metrics` | Is performance drifting from historical baseline? |
| `get_coverage_metrics` | How many trading days have complete data? |
| `get_analytics_breakdown` | Performance breakdown by weekday, month, regime, etc. |
| `get_recent_misses` | Days where prediction was most wrong |
| `get_best_conditions` | Your most accurate market conditions (min n=3) |
| `get_worst_conditions` | Your least accurate market conditions (min n=3) |
| `get_failure_tag_metrics` | Which failure categories appear most often and together |

### Dataset

| Tool | What it does |
|------|-------------|
| `rebuild_dataset` | Rebuild all dataset files from saved reports |
| `get_dataset_summary` | Row counts, split sizes, date range |
| `get_dataset_schema` | All fields with types and descriptions |
| `get_dataset_sample` | First N rows for inspection |
| `get_feature_dictionary` | All premarket-knowable features with descriptions |
| `get_label_dictionary` | All post-close labels with descriptions |
| `get_dataset_quality` | Null rates, sparsity, coverage distribution |
| `get_dataset_leakage_audit` | Every field classified as feature / label / metadata / excluded |
| `get_dataset_splits` | Train/val/test split sizes and date ranges |

### Shadow ML Models

| Tool | What it does |
|------|-------------|
| `train_models` | Train all 5 prediction tasks |
| `train_model_task` | Train a single task |
| `get_model_summary` | High-level performance across all tasks |
| `get_model_leaderboard` | Champion vs. baseline for each task |
| `get_model_inspect` | Full model card for a specific task |
| `get_model_status` | Training status and last run timestamps |
| `shadow_predict_latest` | Run inference on the most recent report |

### Edge Evaluation

| Tool | What it does |
|------|-------------|
| `edge_coldstart` | Initialize the evaluation framework |
| `edge_retrain` | Retrain with current weighting scheme |
| `edge_evaluate` | Run full evaluation on held-out test set |
| `edge_status` | Promotion gate status for each task |
| `edge_report` | Full evaluation report |
| `edge_agreement_matrix` | Where ML agrees/disagrees with rules engine |
| `edge_summary` | One-line per-task status |
| `edge_promotion_check` | Does any task meet promotion criteria? |
| `edge_weighting_scheme` | Current sample weighting configuration |

### Backfill

| Tool | What it does |
|------|-------------|
| `backfill_run` | Replay historical dates through the full report+grade pipeline |
| `backfill_status` | Current batch progress |
| `backfill_resume` | Resume an interrupted backfill |
| `backfill_abort` | Cancel in-progress backfill |
| `backfill_inspect` | Inspect a specific backfilled date |
| `backfill_list_batches` | All historical batches with completion status |

### Chart Reading

| Tool | When to use |
|------|------------|
| `chart_get_state` | **Always call first** — gets symbol, timeframe, all indicator names + entity IDs |
| `data_get_study_values` | Current RSI, MACD, EMA, BB values from all visible indicators |
| `quote_get` | Latest price snapshot (last, OHLC, volume) |
| `data_get_ohlcv` | Price bars. **Always use `summary: true`** unless you need raw bars |

### Pine Drawing Extraction

Read output from `line.new()`, `label.new()`, `table.new()`, `box.new()` in any visible indicator. **Always pass `study_filter`** to target a specific indicator by name.

| Tool | What it extracts |
|------|-----------------|
| `data_get_pine_lines` | Horizontal price levels (support/resistance, session levels) |
| `data_get_pine_labels` | Text annotations with prices ("PDH 24550", "Bias Long") |
| `data_get_pine_tables` | Table cell contents (session stats, analytics dashboards) |
| `data_get_pine_boxes` | Price zones as `{high, low}` pairs |

### Chart Control

| Tool | What it does |
|------|-------------|
| `chart_set_symbol` | Change ticker (BTCUSD, AAPL, ES1!, NYMEX:CL1!) |
| `chart_set_timeframe` | Change resolution (1, 5, 15, 60, D, W, M) |
| `chart_set_type` | Change chart style (Candles, HeikinAshi, Line, Area, Renko) |
| `chart_manage_indicator` | Add/remove studies. **Use full names**: "Relative Strength Index" not "RSI" |
| `chart_scroll_to_date` | Jump to a specific date (ISO: "2025-01-15") |
| `chart_get_visible_range` / `chart_set_visible_range` | Read/set the visible time window |
| `indicator_set_inputs` | Change indicator parameters (length, source, etc.) |
| `indicator_toggle_visibility` | Show/hide an indicator |
| `symbol_search` | Search for symbols by name or keyword |
| `symbol_info` | Get metadata for a symbol |

### Pine Script Development

| Tool | Step |
|------|------|
| `pine_set_source` | 1. Inject code into editor |
| `pine_smart_compile` | 2. Compile + auto-detect errors |
| `pine_get_errors` | 3. Read compilation errors |
| `pine_get_console` | 4. Read `log.info()` / `log.error()` output |
| `pine_save` | 5. Save to TradingView cloud |
| `pine_new` | Create blank indicator / strategy / library |
| `pine_open` | Load a saved script by name |
| `pine_analyze` | Static analysis (offline — no chart needed) |
| `pine_check` | Server-side syntax validation |
| `pine_list_scripts` | List your saved Pine scripts |

### Replay & Backtesting

| Tool | Step |
|------|------|
| `replay_start` | Enter replay at a date |
| `replay_step` | Advance one bar |
| `replay_autoplay` | Auto-advance (set `speed` in ms) |
| `replay_trade` | Buy / sell / close position |
| `replay_status` | Check position, P&L, current date |
| `replay_stop` | Return to realtime |
| `data_get_strategy_results` | Strategy Tester performance metrics |
| `data_get_trades` | Trade list from Strategy Tester |
| `data_get_equity` | Equity curve data |

### Drawings, Alerts, Watchlist

| Tool | What it does |
|------|-------------|
| `draw_shape` | Draw horizontal_line, trend_line, rectangle, text |
| `draw_list` | List all drawings on chart |
| `draw_get_properties` | Get properties of a specific drawing |
| `draw_remove_one` | Remove a drawing by ID |
| `draw_clear` | Remove all drawings |
| `alert_create` | Create a price alert |
| `alert_list` | List active alerts |
| `alert_delete` | Delete alerts (`delete_all: true`) |
| `watchlist_get` | Get all watchlist symbols with current prices |
| `watchlist_add` | Add a symbol to the watchlist |

### Layout, Panes, Tabs

| Tool | What it does |
|------|-------------|
| `pane_list` | All panes with symbol/resolution |
| `pane_set_layout` | Configure grid: `s`, `2h`, `2v`, `2x2`, `4`, `6`, `8` |
| `pane_focus` | Activate a specific pane |
| `pane_set_symbol` | Set symbol for a specific pane |
| `tab_list` | All open chart tabs |
| `tab_new` | Open a new chart tab |
| `tab_switch` | Switch to a tab by ID |
| `tab_close` | Close a tab |
| `layout_list` | List saved layouts |
| `layout_switch` | Load a saved layout by name |

### UI Automation

| Tool | What it does |
|------|-------------|
| `ui_click` | Click by aria-label, text, data-name, or class |
| `ui_hover` | Hover over an element |
| `ui_keyboard` | Press keys + modifiers (Ctrl+Z, Alt+S, etc.) |
| `ui_type_text` | Type into the focused element |
| `ui_scroll` | Scroll in a direction |
| `ui_find_element` | Search DOM by text, aria-label, or CSS selector |
| `ui_mouse_click` | Click at specific coordinates |
| `ui_fullscreen` | Toggle fullscreen |
| `ui_open_panel` | Open/close panels (pine-editor, strategy-tester, watchlist, alerts) |
| `ui_evaluate` | Run arbitrary JavaScript in the TradingView context |

### Utilities

| Tool | What it does |
|------|-------------|
| `tv_launch` | Auto-detect and launch TradingView with CDP enabled |
| `tv_health_check` | Verify CDP connection and chart state |
| `tv_ui_state` | Capture current panel visibility and button states |
| `tv_discover` | Map available TradingView internal APIs |
| `capture_screenshot` | Save PNG (regions: `full`, `chart`, `strategy_tester`) |
| `batch_run` | Run an action across multiple symbols/timeframes |

---

## CLI Reference

Every MCP tool is also a `tv` CLI command. Output is always JSON — pipe-friendly.

```bash
# Morning brief workflow
tv brief                                    # morning brief
tv session get                              # retrieve today's saved brief

# Reports and grading
tv report premarket                         # run premarket report
tv report postclose                         # run postclose report
tv grade latest                             # grade the most recent day
tv grade show --date 2025-04-24             # show grade for a specific date

# Analytics
tv analytics rebuild                        # rebuild all analytics
tv analytics summary                        # overall performance
tv analytics rolling                        # rolling window performance
tv analytics breakdown --by weekday         # breakdown by dimension

# Chart
tv status                                   # health check
tv quote                                    # current price
tv symbol BTCUSD                            # change symbol
tv timeframe 4H                             # change timeframe
tv ohlcv --summary                          # compact price summary
tv screenshot -r chart                      # capture chart PNG

# Pine Script
tv pine compile                             # compile current script
tv pine errors                              # read compilation errors
tv pine console                             # read log output

# Multi-pane
tv pane layout 2x2                          # 4-chart grid

# Streaming (pipe-friendly)
tv stream quote | jq '.close'               # monitor price ticks

# Help
tv --help                                   # full command list
tv <command> --help                         # command-specific help
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `cdp_connected: false` | TradingView isn't running with the debug port. Use the launch script or `tv_launch`. |
| `ECONNREFUSED` on port 9222 | TradingView isn't running, or the port is in use. Close and relaunch via the script. |
| MCP server not showing in Claude Code | Check `~/.claude/.mcp.json` syntax (must be valid JSON). Restart Claude Code. |
| `tv` command not found | Run `npm link` from the project directory. |
| `morning_brief` — "No rules.json found" | Run `cp rules.example.json rules.json` and fill in your watchlist. |
| Tools return stale data | TradingView may still be loading. Wait a few seconds and retry. |
| Pine editor tools fail | Open the Pine Editor first: `ui_open_panel` with `pine-editor`. |
| Reports missing post-close data | TradingView must be open and on the correct chart during report capture. |
| `better-sqlite3` install error | Ensure Node.js 18+. Run `npm rebuild better-sqlite3`. |
| Backfill shows degraded fidelity | Expected — historical replay uses best-effort data. Missing intermarket quotes are normal. |

For detailed setup help see [SETUP.md](SETUP.md). For architecture questions see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Architecture

```
Claude Code  ←→  MCP Server (stdio)  ←→  CDP (port 9222)  ←→  TradingView Desktop (Electron)
                      |
                 SQLite + JSONL
                 (~/.tradingview-mcp/)
```

- **Transport**: MCP over stdio (Claude Code) + CLI (`tv` command)
- **Chart connection**: Chrome DevTools Protocol on `localhost:9222`
- **Persistence**: Append-only JSONL for grades + session data; SQLite for dashboard
- **ML**: Pure Node.js gradient descent — no Python, no external dependencies
- **Network**: Zero external network calls from this process

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full technical breakdown.

---

## Data Directory

Everything persists to `~/.tradingview-mcp/`:

```
~/.tradingview-mcp/
├── sessions/YYYY-MM-DD.json          ← daily morning briefs
├── reports/YYYY-MM-DD/
│   ├── premarket_nq.json             ← indicator state at market open
│   ├── postclose_nq.json             ← actual session outcome + grade
│   └── combined_summary.json
├── performance/
│   ├── daily_grades.jsonl            ← append-only grade log (source of truth)
│   └── summary.json
├── analytics/                        ← all analytics artifacts
├── datasets/                         ← ML feature dataset + splits
├── models/                           ← trained shadow model artifacts
└── backfill/                         ← batch replay manifests
```

---

## Credits

This fork is built on [tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp) by [@tradesdontlie](https://github.com/tradesdontlie). The CDP foundation and core chart tools are theirs — go star their repo.

---

## Disclaimer

This project is provided **for personal, educational, and research purposes only**.

This tool uses the Chrome DevTools Protocol (CDP), a standard debugging interface built into all Chromium-based applications. It does not reverse-engineer any proprietary TradingView protocol, connect to TradingView's servers, or bypass any access controls. The debug port must be explicitly enabled by the user via a standard Chromium command-line flag.

By using this software you agree that:

1. You are solely responsible for ensuring your use complies with [TradingView's Terms of Use](https://www.tradingview.com/policies/) and all applicable laws.
2. This tool accesses undocumented internal TradingView APIs that may change at any time without notice.
3. This tool must not be used to redistribute, resell, or commercially exploit TradingView's market data.
4. The authors are not liable for account bans, suspensions, financial loss, or any other consequence of using this software.

**Use at your own risk.**

---

## License

MIT — see [LICENSE](LICENSE). Applies to this source code only, not to TradingView's software, data, or trademarks.
