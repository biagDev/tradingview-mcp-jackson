# NQ Daily Bias Dashboard (Stage 6)

Local Next.js 14 web dashboard for the full analysis pipeline. Reads all artifacts produced by Stages 1–5 into a local SQLite database and renders them as a live read-only dashboard.

**Local-only.** Nothing is sent anywhere. All data lives in `~/.tradingview-mcp/` on your machine.

---

## What's Inside

| Page | What it shows |
|------|--------------|
| **/** (Today) | Current day's official bias, latest grade, indicator snapshot, intermarket, key levels, ML comparison strip |
| **/premarket** | Full premarket report for any date — bias components, invalidation levels, narrative |
| **/postclose** | Actual session OHLC, grade breakdown, failure tags |
| **/history** | Chronological grade log, filterable by grade, streaks, grade distribution |
| **/analytics** | Rolling windows (5/20/60-day), dimensional breakdowns (weekday, regime, etc.), drift detection |
| **/misses** | Days with the lowest prediction accuracy, annotated with failure tags |
| **/models** | Shadow ML model cards — training status, metrics, feature importance per task |
| **/shadow** | Latest inference predictions for all 5 tasks with confidence breakdowns |
| **/edge** | Rules vs. ML vs. baseline evaluation — agreement matrix, promotion gate status |
| **/system** | Sync status, last run timestamps, data coverage, artifact health |

**Color coding:**
- Green badges → rules engine (production)
- Amber badges → ML predictions (shadow / research only)

---

## Prerequisites

- Node.js 18+
- Main MCP server installed (see root [SETUP.md](../SETUP.md))
- At least a few days of premarket + postclose reports in `~/.tradingview-mcp/reports/`

---

## Quick Start

```bash
cd web
npm install          # install Next.js, Tailwind, better-sqlite3
npm run app:full     # init DB + sync all pipeline artifacts
npm run dev          # start on http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000).

---

## Step-by-Step Setup

### 1. Install dependencies

```bash
cd web
npm install
```

If `better-sqlite3` fails to build, see [Troubleshooting](#troubleshooting).

### 2. Initialize the database

Creates the SQLite schema at `~/.tradingview-mcp/app.db`:

```bash
npm run db:init
```

Safe to run repeatedly — it will not drop existing data.

### 3. Sync pipeline artifacts

Reads all `~/.tradingview-mcp/` artifacts into SQLite. Run after any new reports, grades, or model training:

```bash
npm run db:sync
```

Or init + sync in one shot:

```bash
npm run app:full
```

### 4. Start the dashboard

```bash
npm run dev
```

---

## Keeping Data Fresh

The dashboard reads from SQLite — a snapshot of your `~/.tradingview-mcp/` files. Re-sync whenever you want the UI to reflect new data:

| Trigger | Sync command |
|---------|-------------|
| New premarket/postclose report | `npm run db:sync` |
| After grading a day (`grade_latest`) | `npm run db:sync` |
| After `rebuild_analytics` | `npm run db:sync` |
| After `train_models` | `npm run db:sync` |
| After a backfill run | Automatic at chunk boundaries; run `db:sync` once at the end |

Sync is idempotent — latest artifact wins, duplicates are safely ignored.

---

## Sync from the CLI

You can sync without opening the terminal in the `web/` directory:

```bash
tv db sync     # runs the same sync from anywhere
```

---

## Architecture

```
~/.tradingview-mcp/             ← source of truth (JSON/JSONL files)
  reports/YYYY-MM-DD/
  performance/daily_grades.jsonl
  analytics/*.json
  datasets/*.jsonl
  models/{task}/*.json
        │
        ▼  npm run db:sync  (lib/sync.ts)
~/.tradingview-mcp/app.db       ← SQLite snapshot
  daily_reports
  daily_postclose_reviews
  analytics_snapshots
  analytics_breakdowns
  model_status
  shadow_predictions
  system_status
  sync_runs
        │
        ▼  lib/queries.ts  (typed server-side reads)
        │
        ▼  app/**/page.tsx  (server components, force-dynamic)
http://localhost:3000           ← dashboard
```

All pages use `export const dynamic = 'force-dynamic'` so they reload fresh data from SQLite on every navigation without restarting the dev server.

---

## Production Build

For a production build (faster, no HMR overhead):

```bash
npm run build
npm start           # starts on http://localhost:3000
```

---

## Database Location

```
~/.tradingview-mcp/app.db
```

This file is completely safe to delete — `npm run app:full` rebuilds it from scratch. The source of truth is always the JSON/JSONL files in `~/.tradingview-mcp/`.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| Database | SQLite via `better-sqlite3` |
| Language | TypeScript |
| Charts | Inline SVG sparklines |
| Runtime | Node.js 18+ |

---

## Troubleshooting

**"No premarket report synced yet" on the Today page**

Run `npm run db:sync`. If it says no reports found, you need to generate at least one premarket + postclose report pair first — see [SETUP.md → Setting Up the Full Pipeline](../SETUP.md#setting-up-the-full-pipeline).

**Sync script fails with "no such file or directory"**

You haven't generated reports yet. Complete at least one premarket + postclose cycle first using Claude:

```
Ask Claude: "Run the premarket report for today"
Ask Claude: "Run the postclose report and grade today"
```

Then re-run `npm run db:sync`.

**Dashboard showing stale data after a new report**

Re-run `npm run db:sync` — the dashboard does not watch the filesystem for changes automatically.

**Port 3000 is already in use**

```bash
npm run dev -- -p 3001
# or set the port in next.config.mjs
```

**`better-sqlite3` build fails on npm install**

```bash
# Option 1: rebuild the native binding
npm rebuild better-sqlite3

# Option 2: if that fails, install build tools first
# macOS:
xcode-select --install && npm rebuild better-sqlite3

# Windows:
npm install --global windows-build-tools
npm rebuild better-sqlite3

# Linux:
sudo apt-get install -y build-essential python3
npm rebuild better-sqlite3
```

**TypeScript errors on `npm run build`**

```bash
npm run lint    # check for linting issues
npx tsc --noEmit   # check types without building
```
