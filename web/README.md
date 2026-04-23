# NQ Daily Bias — Local MVP App (Stage 6A)

A local Next.js dashboard for the NQ Daily Bias pipeline (Stages 1–5).
**Reads only.** The rules-based engine remains the production signal;
ML predictions are shown as **shadow-only**.

## Stack
- Next.js 14 (App Router), TypeScript, Tailwind CSS
- better-sqlite3 (synchronous, zero-config local DB)
- Database lives at `~/.tradingview-mcp/app.db` next to the other pipeline artifacts.

## Install
```bash
cd web
npm install
```

## One-time DB init
```bash
npm run db:init
```
Creates `~/.tradingview-mcp/app.db` with empty tables.

## Sync artifacts into the DB
```bash
npm run db:sync
```
Idempotent: reads every artifact under `~/.tradingview-mcp/{reports,performance,analytics,datasets,models}` and upserts into SQLite. Latest artifact wins.

Run this once after each pipeline run. (Stage 6B can wire it into the 16:05 ET scheduler.)

Shortcut: `npm run app:full` runs init + sync in one shot.

## Run the app
```bash
npm run dev
```
Then open http://localhost:3000.

## Pages
| Route | What it shows |
|---|---|
| `/` | Today dashboard — official bias, latest grade, shadow summary |
| `/premarket` | Latest premarket report |
| `/postclose` | Latest post-close review + grading |
| `/history` | Filterable table of every daily report |
| `/history/[date]` | Single-day detail (premarket + postclose + shadow) |
| `/analytics` | Rolling windows, coverage, drift, breakdowns |
| `/misses` | Recent misses |
| `/models` | Per-task training status + champion |
| `/shadow` | Latest shadow-mode predictions |
| `/system` | Pipeline freshness + artifact health |

## Architecture
```
Artifacts (~/.tradingview-mcp/*)
        │
        ├──▶  lib/sync.ts        (idempotent upsert into SQLite)
        │        │
        │        ▼
        │   ~/.tradingview-mcp/app.db   (tables: daily_reports,
        │        │                       daily_postclose_reviews,
        │        │                       analytics_snapshots,
        │        │                       model_status,
        │        │                       shadow_predictions,
        │        │                       system_status, sync_runs)
        │        │
        │        ▼
        └──▶  lib/queries.ts     (typed reads for server components)
                 │
                 ▼
             app/**/page.tsx     (server-rendered dashboard pages)
```

## Production vs Shadow
The UI clearly labels every card:
- **RULES ENGINE — PRODUCTION** on all daily-bias display
- **ML — SHADOW ONLY** on every shadow prediction

The rules engine is never overridden by ML output.

## Extending
- Stage 6B can add a scheduler hook that POSTs to `/api/sync` after each pipeline run.
- To deploy as a SaaS: add auth, billing, multi-tenant DB, etc. **Do not do this yet** — this is a local MVP.
