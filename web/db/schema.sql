-- Stage 6A schema.
-- All tables are "app-facing" views of the source artifacts; source
-- artifacts under ~/.tradingview-mcp/* remain authoritative.
-- Every table has `synced_at` for traceability.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Premarket reports (one per trading date) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_reports (
  trading_date            TEXT    PRIMARY KEY,
  symbol                  TEXT,
  status                  TEXT,
  bias                    TEXT,
  confidence              INTEGER,
  day_type                TEXT,
  day_type_source         TEXT,
  expected_range_points   INTEGER,
  expected_range_low      REAL,
  expected_range_high     REAL,
  expected_range_source   TEXT,
  volatility_regime       TEXT,
  narrative_report        TEXT,
  run_time_et             TEXT,
  run_time_utc            TEXT,
  model_version           TEXT,
  indicator_version       TEXT,
  prompt_version          TEXT,
  calendar_source         TEXT,
  early_close             INTEGER,  -- 0/1
  data_quality_complete   TEXT,
  data_quality_fallback   INTEGER,
  key_level_count         INTEGER,
  raw_json                TEXT,     -- full report snapshot
  source_path             TEXT,
  synced_at               TEXT
);

-- ── Post-close reviews with grading embedded ─────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_postclose_reviews (
  trading_date                TEXT    PRIMARY KEY,
  symbol                      TEXT,
  status                      TEXT,
  actual_open                 REAL,
  actual_high                 REAL,
  actual_low                  REAL,
  actual_close                REAL,
  actual_range_points         INTEGER,
  actual_day_type             TEXT,
  actual_volatility_regime    TEXT,
  bias_called                 TEXT,
  bias_actual                 TEXT,
  bias_correct                INTEGER,
  day_type_called             TEXT,
  day_type_actual             TEXT,
  day_type_correct            INTEGER,
  range_within_tolerance      INTEGER,
  range_estimate_error_points INTEGER,
  range_estimate_error_pct    REAL,
  overall_grade               TEXT,
  score_0_to_100              INTEGER,
  coverage_pct                REAL,
  partial_grade               INTEGER,
  failure_tags_json           TEXT,  -- JSON array
  graded_at_utc               TEXT,
  run_time_et                 TEXT,
  run_time_utc                TEXT,
  early_close                 INTEGER,
  raw_json                    TEXT,
  source_path                 TEXT,
  synced_at                   TEXT
);

-- ── Analytics snapshots (one row per snapshot file) ──────────────────────────
CREATE TABLE IF NOT EXISTS analytics_snapshots (
  snapshot_type  TEXT PRIMARY KEY,  -- 'summary' | 'rolling' | 'coverage' | 'drift' | 'recent_misses' | 'dashboard' | 'best' | 'worst' | 'failure_tags'
  payload        TEXT,              -- JSON
  source_path    TEXT,
  last_updated   TEXT,
  synced_at      TEXT
);

-- ── Per-dimension breakdowns ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_breakdowns (
  dimension     TEXT PRIMARY KEY,   -- 'weekday' | 'volatility_regime' | etc.
  payload       TEXT,               -- JSON
  source_path   TEXT,
  last_updated  TEXT,
  synced_at     TEXT
);

-- ── Model training status (one per task) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS model_status (
  task                TEXT PRIMARY KEY,
  status              TEXT,        -- 'trained' | 'baseline_only' | 'insufficient_history' | 'not_trained' | 'error'
  champion_name       TEXT,
  champion_family     TEXT,
  is_baseline         INTEGER,
  champion_metric     TEXT,
  validation_metric   REAL,
  test_metrics_json   TEXT,
  rows_train          INTEGER,
  rows_validation     INTEGER,
  rows_test           INTEGER,
  last_trained_utc    TEXT,
  issues_json         TEXT,
  notes               TEXT,
  source_path         TEXT,
  synced_at           TEXT
);

-- ── Shadow predictions (append; UNIQUE per date+task+timestamp) ─────────────
CREATE TABLE IF NOT EXISTS shadow_predictions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  trading_date        TEXT,
  task                TEXT,
  prediction          TEXT,
  probabilities_json  TEXT,
  is_baseline         INTEGER,
  family              TEXT,
  candidate           TEXT,
  timestamp           TEXT,
  champion_metric     TEXT,
  model_version       TEXT,
  indicator_version   TEXT,
  prompt_version      TEXT,
  source_path         TEXT,
  synced_at           TEXT,
  UNIQUE(trading_date, task, timestamp)
);

-- ── System status (one row per key) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_status (
  key           TEXT PRIMARY KEY,   -- 'last_premarket' | 'last_postclose' | 'last_analytics' | 'last_dataset' | 'last_model_train' | 'last_shadow_predict' | 'last_sync'
  value         TEXT,
  last_updated  TEXT,
  details_json  TEXT
);

-- ── Sync run log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at     TEXT,
  finished_at    TEXT,
  duration_ms    INTEGER,
  status         TEXT,               -- 'ok' | 'partial' | 'error'
  counts_json    TEXT,
  error          TEXT
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_shadow_date         ON shadow_predictions(trading_date);
CREATE INDEX IF NOT EXISTS idx_shadow_task         ON shadow_predictions(task);
CREATE INDEX IF NOT EXISTS idx_reports_status      ON daily_reports(status);
CREATE INDEX IF NOT EXISTS idx_postclose_grade     ON daily_postclose_reviews(overall_grade);
