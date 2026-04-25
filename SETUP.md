# Setup Guide

Complete installation and configuration guide for TradingView MCP Jackson.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Launch TradingView with CDP](#launch-tradingview-with-cdp)
4. [MCP Server Setup](#mcp-server-setup)
5. [Rules Configuration](#rules-configuration)
6. [Environment Variables](#environment-variables)
7. [Install the CLI](#install-the-cli)
8. [Verify Everything Works](#verify-everything-works)
9. [First Morning Brief](#first-morning-brief)
10. [Setting Up the Full Pipeline](#setting-up-the-full-pipeline)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required

| Requirement | Minimum version | How to check |
|-------------|----------------|--------------|
| Node.js | 18.0.0 | `node --version` |
| npm | 8.0.0 | `npm --version` |
| TradingView Desktop | Any current version | — |
| Claude Code | Any current version | `claude --version` |

**TradingView Desktop** is available from [tradingview.com/desktop](https://www.tradingview.com/desktop/). A paid subscription is required for real-time data access. The free plan will not have real-time data.

**Claude Code** is available at [claude.ai/code](https://claude.ai/code). You need an active Anthropic account.

### Operating system

- macOS 12+ (Intel or Apple Silicon)
- Windows 10/11
- Linux (Ubuntu 20.04+ or equivalent)

### Disk space

- Project install: ~50 MB (node_modules included)
- Runtime data: grows over time in `~/.tradingview-mcp/` as you accumulate reports and grades

---

## Installation

### 1. Clone the repository

Choose a permanent location — this path goes into your Claude Code config and should not change after setup.

```bash
git clone https://github.com/biagDev/tradingview-mcp-jackson.git ~/tradingview-mcp-jackson
cd ~/tradingview-mcp-jackson
```

> **Windows users:** Use your preferred path, e.g. `C:\Users\YourName\tradingview-mcp-jackson`. Adjust all paths in subsequent steps accordingly.

### 2. Install dependencies

```bash
npm install
```

This installs:
- `@modelcontextprotocol/sdk` — MCP protocol implementation
- `chrome-remote-interface` — Chrome DevTools Protocol client
- `better-sqlite3` — SQLite bindings for the dashboard and analytics
- `dotenv` — environment variable management

If you see a `better-sqlite3` build error, see [Troubleshooting → better-sqlite3 build fails](#better-sqlite3-build-fails).

### 3. Verify the install

```bash
node src/server.js --version 2>/dev/null || node -e "import('./src/server.js').catch(e => console.log('Server module loaded OK'))"
```

No errors means the install succeeded.

---

## Launch TradingView with CDP

TradingView Desktop is built on Electron (Chromium). You need to start it with the Chrome DevTools Protocol debug port enabled. **TradingView will not accept connections on port 9222 unless it was launched this way.**

### macOS

```bash
./scripts/launch_tv_debug_mac.sh
```

This script finds your TradingView.app installation and launches it with `--remote-debugging-port=9222`.

If the script fails, launch manually:

```bash
open -a "TradingView" --args --remote-debugging-port=9222
```

Or find the exact path:

```bash
find /Applications -name "TradingView" -type d 2>/dev/null | head -5
# Then: /Applications/TradingView.app/Contents/MacOS/TradingView --remote-debugging-port=9222
```

### Windows

```batch
scripts\launch_tv_debug.bat
```

If the script fails, launch manually via Command Prompt:

```batch
"C:\Users\YourName\AppData\Local\TradingView\TradingView.exe" --remote-debugging-port=9222
```

Common install paths:
- `C:\Users\<name>\AppData\Local\TradingView\TradingView.exe`
- `C:\Program Files\TradingView\TradingView.exe`

### Linux

```bash
./scripts/launch_tv_debug_linux.sh
```

If the script fails, launch manually:

```bash
tradingview --remote-debugging-port=9222
# or wherever TradingView is installed:
~/.local/bin/tradingview --remote-debugging-port=9222
```

### Verify CDP is listening

After launching, verify port 9222 is open:

```bash
# macOS / Linux
curl -s http://localhost:9222/json/version | head -5

# Windows (PowerShell)
Invoke-WebRequest http://localhost:9222/json/version
```

You should see a JSON response with Chromium version info. If you get a connection refused error, TradingView was not launched with the debug port.

### Important notes

- Always use the launch script (or manual command with the flag). Do not double-click TradingView from your applications folder — that will open it without CDP.
- TradingView must be **fully loaded with a chart open** before running any MCP tools. Wait for the chart to finish loading before running `tv_health_check`.
- If TradingView was already running without the debug port, close it completely and relaunch with the script.

---

## MCP Server Setup

### Add to Claude Code

Open `~/.claude/.mcp.json` in a text editor. If the file doesn't exist, create it. If it already has other MCP servers, **add the tradingview entry without removing the others**.

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

**Replace `YOUR_USERNAME` with your actual username.** On Mac/Linux: `echo $USER`. On Windows: `echo %USERNAME%`.

#### macOS example

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["/Users/jackson/tradingview-mcp-jackson/src/server.js"]
    }
  }
}
```

#### Windows example

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["C:\\Users\\jackson\\tradingview-mcp-jackson\\src\\server.js"]
    }
  }
}
```

Note the double backslashes on Windows.

#### If you have other MCP servers

Merge the tradingview entry with your existing servers:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/jackson"]
    },
    "tradingview": {
      "command": "node",
      "args": ["/Users/jackson/tradingview-mcp-jackson/src/server.js"]
    }
  }
}
```

### Restart Claude Code

After editing `.mcp.json`, restart Claude Code completely for the new MCP server to be detected.

### Verify the MCP server loaded

In Claude Code, ask:

```
What TradingView MCP tools do you have available?
```

Claude should list tools like `tv_health_check`, `morning_brief`, `chart_get_state`, etc. If it says it doesn't have those tools, check the JSON syntax in `.mcp.json` and restart again.

---

## Rules Configuration

`rules.json` tells the morning brief what to look for. Without it, `morning_brief` will fail.

### Create your rules file

```bash
cp rules.example.json rules.json
```

### Edit rules.json

Open `rules.json` in any text editor. The structure:

```json
{
  "watchlist": ["BTCUSD", "ETHUSD", "SOLUSD"],
  "default_timeframe": "240",

  "bias_criteria": {
    "bullish": [
      "Ribbon direction is up (bullish colour)",
      "Price is above the 20 EMA on the 4H",
      "RSI is below 60 (room to run)"
    ],
    "bearish": [
      "Ribbon direction is down (bearish colour)",
      "Price is below the 20 EMA on the 4H",
      "RSI is above 40 (room to drop)"
    ],
    "neutral": [
      "Ribbon is flat or mixed",
      "Price is chopping around the 20 EMA",
      "RSI is between 45 and 55"
    ]
  },

  "risk_rules": [
    "Only take trades where R:R is at least 1:2",
    "No trading in the first 15 minutes of the NY session open",
    "Maximum 2 open positions at once",
    "If I have 2 losing trades in a row, stop for the day"
  ],

  "notes": "Add any other context here — e.g. macro events this week, key dates, anything that should affect your bias."
}
```

### Customizing your rules

**watchlist** — symbols to scan each morning. Use TradingView symbol format:
- Crypto: `BTCUSD`, `ETHUSD`, `SOLUSD`
- Futures: `ES1!`, `NQ1!`, `YM1!`, `CL1!`, `GC1!`
- Stocks: `AAPL`, `TSLA`, `SPY`
- Forex: `EURUSD`, `GBPUSD`

**default_timeframe** — the timeframe to use when scanning (in minutes). Common values:
- `"60"` = 1 hour
- `"240"` = 4 hours
- `"D"` = daily

**bias_criteria** — write these in plain English. Claude reads these and checks your actual indicator values against them. Be specific about which indicator and what condition matters.

**risk_rules** — these are applied as a checklist before every session. Claude will flag any violations.

**notes** — free-form context. Good for macro events, earnings calendars, or anything situational.

---

## Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

The defaults work for most setups. Only change if you have a non-standard configuration:

```bash
# CDP connection
CDP_HOST=localhost      # Don't change unless TradingView runs on a different machine
CDP_PORT=9222           # Must match --remote-debugging-port value

# Data storage
DATA_DIR=~/.tradingview-mcp   # Where reports, grades, datasets are stored

# Report timezone (default is US Eastern for NYSE/NQ)
REPORT_TIMEZONE=America/New_York

# Screenshot output
SCREENSHOT_DIR=screenshots
```

---

## Install the CLI

The `tv` CLI mirrors all MCP tools for terminal use. Install it globally once:

```bash
npm link
```

Verify it worked:

```bash
tv --version
tv --help
```

If `tv` is not found after `npm link`, check that your npm global bin directory is in your PATH:

```bash
npm config get prefix
# Add <prefix>/bin to your PATH in ~/.zshrc or ~/.bashrc
```

---

## Verify Everything Works

Run through this checklist in order:

### 1. TradingView is running with CDP

```bash
curl -s http://localhost:9222/json/version
# Should return JSON, not "connection refused"
```

### 2. MCP server connects to TradingView

In Claude Code:

```
Use tv_health_check to verify the connection
```

Expected response includes `cdp_connected: true` and the current symbol/timeframe.

### 3. Chart reading works

```
Use chart_get_state to show me what's on my chart
```

You should see your current symbol, timeframe, and list of indicators.

### 4. Morning brief works

```
Run morning_brief and summarize my session bias
```

If `rules.json` is set up correctly, Claude will scan your watchlist and return a structured bias for each symbol.

### 5. CLI works

```bash
tv status
# Should show connection status

tv quote
# Should show current price
```

If all five checks pass, your setup is complete.

---

## First Morning Brief

Once everything is verified:

### From Claude Code

```
Run morning_brief and give me a full session bias for today. 
Apply my rules.json criteria and tell me which symbols look tradeable.
```

### From the terminal

```bash
tv brief
```

### What to expect

Claude will:
1. Switch to each symbol in your watchlist
2. Read indicator values (RSI, EMA, Ribbon, MACD — whatever you have on your chart)
3. Apply your `bias_criteria` rules
4. Return a structured bias for each symbol
5. Check your `risk_rules` and flag any current violations

Save the brief after generation:

```
Save this brief as today's session
```

Or: `tv session save`

---

## Setting Up the Full Pipeline

If you want the full Stage 2–7 system (grading, analytics, ML), here's how to initialize it:

### Step 1 — Run your first premarket report

Every morning before the US market open (9:00 ET), run:

```
Run the premarket report for today
```

This captures your NQ Daily Bias Engine's state. You need the Bias Engine indicator on your chart and visible for this to work.

### Step 2 — Run your first postclose report

After market close (16:00+ ET), run:

```
Run the postclose report for today and grade it
```

This records what actually happened and compares it against the premarket prediction.

### Step 3 — Grade and check performance

```
Grade today's trading date and show me my performance summary
```

After a few days of reports, run:

```
Rebuild analytics and show me my rolling performance
```

### Step 4 — Build your dataset (after 10+ graded days)

```
Rebuild the dataset and show me the feature dictionary
```

### Step 5 — Train the shadow models (after 20+ graded days)

```
Train all shadow models and show me the model leaderboard
```

### Step 6 — Start the local dashboard

Once you have a few graded days, you can view everything in a browser UI:

```bash
cd web
npm install
npm run app:full   # init DB + sync all artifacts
npm run dev        # open http://localhost:3000
```

After each new report or grade, refresh the dashboard data:

```bash
npm run db:sync
```

The dashboard shows official bias (green), shadow ML predictions (amber), rolling analytics, grade history, model cards, and edge evaluation status. See [web/README.md](web/README.md) for the full guide.

### Step 7 — Evaluate ML vs. rules

```
Run the edge evaluation and show me the edge report
```

### Backfilling historical data

If you have historical reports already saved (or want to build dataset faster), use the backfill harness:

```
Run a backfill from 2025-01-01 to today
```

The backfill replays historical dates through the full report + grade pipeline. NYSE trading days are handled automatically.

---

## Troubleshooting

### TradingView launch issues

**`./scripts/launch_tv_debug_mac.sh: No such file`**

The scripts directory may be missing. Launch manually:
```bash
open -a TradingView --args --remote-debugging-port=9222
```

**TradingView opens but `curl localhost:9222` gives connection refused**

TradingView was not launched with the debug flag. Close it completely (check Activity Monitor / Task Manager for background processes) and relaunch via the script.

**Port 9222 is already in use**

Another Chromium process (Chrome, Edge, another Electron app) is already using port 9222. Either close that process or change the port:
```bash
# Launch on a different port
/Applications/TradingView.app/Contents/MacOS/TradingView --remote-debugging-port=9223
```
Then update `CDP_PORT=9223` in your `.env`.

### MCP server issues

**Tools not showing in Claude Code**

1. Check `~/.claude/.mcp.json` is valid JSON: `cat ~/.claude/.mcp.json | python3 -m json.tool`
2. Verify the path to `server.js` is correct and absolute
3. Verify Node.js 18+ is the version Claude Code is using: `node --version`
4. Restart Claude Code completely (quit and reopen, not just reload)

**MCP server shows in Claude Code but tools fail**

Run `tv_health_check`. If it returns `cdp_connected: false`:
- TradingView is not running with the debug port
- Port 9222 is blocked by a firewall
- TradingView is still loading — wait and retry

### better-sqlite3 build fails

This usually means your Node.js version mismatches the pre-built binary. Fix:

```bash
# Option 1: rebuild from source
npm rebuild better-sqlite3

# Option 2: if that fails, install build tools first
# macOS:
xcode-select --install
npm rebuild better-sqlite3

# Windows:
npm install --global windows-build-tools
npm rebuild better-sqlite3

# Linux:
sudo apt-get install -y build-essential python3
npm rebuild better-sqlite3
```

### morning_brief errors

**"No rules.json found"**

```bash
cp rules.example.json rules.json
# Then fill in your watchlist and criteria
```

**"Watchlist is empty"**

Open `rules.json` and add symbols to the `watchlist` array.

**Brief returns no indicator values**

Your chart needs to have the indicators you reference in `rules.json` loaded and **visible** (not hidden). Switch to each symbol in your watchlist and confirm the indicators are showing before running the brief.

### Report and grading issues

**Premarket report shows empty tables/labels**

Your NQ Daily Bias Engine indicator must be:
1. Added to the chart
2. Visible (not hidden/disabled)
3. On the correct symbol and timeframe (NQ, daily or whatever the indicator requires)

**Grading fails — "no premarket report found"**

You must run `run_premarket_report` before `run_postclose_report`. Both reports are required for grading to work.

**`daily_grades.jsonl` is corrupted**

This file is append-only. If a line is malformed, the analytics tools will error. To repair:

```bash
# Inspect the last few lines
tail -5 ~/.tradingview-mcp/performance/daily_grades.jsonl

# Remove the last (potentially corrupt) line if needed
head -n -1 ~/.tradingview-mcp/performance/daily_grades.jsonl > /tmp/grades_fixed.jsonl
mv /tmp/grades_fixed.jsonl ~/.tradingview-mcp/performance/daily_grades.jsonl
```

### Node.js version issues

**`SyntaxError: Cannot use import statement`**

Your Node.js version is below 18. This project uses ES modules (`"type": "module"` in package.json).

```bash
# Check version
node --version

# Install Node.js 18+ via nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
nvm alias default 18
```

---

## Getting Help

- **ARCHITECTURE.md** — technical architecture, data flow, module descriptions
- **RESEARCH.md** — research context and findings
- **GitHub Issues** — open an issue for bugs or questions
- **CONTRIBUTING.md** — how to contribute
