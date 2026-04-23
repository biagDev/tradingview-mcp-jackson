/**
 * Shared TypeScript types for the NQ Daily Bias app.
 * These mirror the JSON shapes produced by src/core/*.js but are intentionally
 * permissive — every field is optional because pipeline artifacts evolve.
 */

export type Bias      = 'bullish' | 'bearish' | 'neutral' | null;
export type DayType   = 'trending' | 'normal' | 'range' | 'inside' | 'pending' | null;
export type Regime    = 'EXPANSION' | 'CONTRACTION' | 'NORMAL' | 'UNKNOWN' | null;
export type Grade     = 'A' | 'B' | 'C' | 'D' | 'F' | 'NG' | '?' | null;

// ─── DB entity shapes (camelCase outward-facing) ─────────────────────────────

export interface DailyReport {
  trading_date:            string;
  symbol:                  string | null;
  status:                  string | null;
  bias:                    Bias;
  confidence:              number | null;
  day_type:                DayType;
  day_type_source:         string | null;
  expected_range_points:   number | null;
  expected_range_low:      number | null;
  expected_range_high:     number | null;
  expected_range_source:   string | null;
  volatility_regime:       Regime;
  narrative_report:        string | null;
  run_time_et:             string | null;
  run_time_utc:            string | null;
  model_version:           string | null;
  indicator_version:       string | null;
  prompt_version:          string | null;
  calendar_source:         string | null;
  early_close:             number | null;  // 0/1
  data_quality_complete:   string | null;
  data_quality_fallback:   number | null;
  key_level_count:         number | null;
  raw_json:                string | null;
  source_path:             string | null;
  synced_at:               string | null;
}

export interface PostcloseReview {
  trading_date:                string;
  symbol:                      string | null;
  status:                      string | null;
  actual_open:                 number | null;
  actual_high:                 number | null;
  actual_low:                  number | null;
  actual_close:                number | null;
  actual_range_points:         number | null;
  actual_day_type:             DayType;
  actual_volatility_regime:    Regime;
  bias_called:                 Bias;
  bias_actual:                 Bias;
  bias_correct:                number | null;
  day_type_called:             DayType;
  day_type_actual:             DayType;
  day_type_correct:            number | null;
  range_within_tolerance:      number | null;
  range_estimate_error_points: number | null;
  range_estimate_error_pct:    number | null;
  overall_grade:               Grade;
  score_0_to_100:              number | null;
  coverage_pct:                number | null;
  partial_grade:               number | null;
  failure_tags_json:           string | null;
  graded_at_utc:               string | null;
  run_time_et:                 string | null;
  run_time_utc:                string | null;
  early_close:                 number | null;
  raw_json:                    string | null;
  source_path:                 string | null;
  synced_at:                   string | null;
}

export interface AnalyticsSnapshot {
  snapshot_type: string;
  payload:       string | null;
  source_path:   string | null;
  last_updated:  string | null;
  synced_at:     string | null;
}

export interface AnalyticsBreakdown {
  dimension:    string;
  payload:      string | null;
  source_path:  string | null;
  last_updated: string | null;
  synced_at:    string | null;
}

export interface ModelStatus {
  task:               string;
  status:             string | null;
  champion_name:      string | null;
  champion_family:    string | null;
  is_baseline:        number | null;
  champion_metric:    string | null;
  validation_metric:  number | null;
  test_metrics_json:  string | null;
  rows_train:         number | null;
  rows_validation:    number | null;
  rows_test:          number | null;
  last_trained_utc:   string | null;
  issues_json:        string | null;
  notes:              string | null;
  source_path:        string | null;
  synced_at:          string | null;
}

export interface ShadowPrediction {
  id?:                number;
  trading_date:       string;
  task:               string;
  prediction:         string | null;
  probabilities_json: string | null;
  is_baseline:        number | null;
  family:             string | null;
  candidate:          string | null;
  timestamp:          string | null;
  champion_metric:    string | null;
  model_version:      string | null;
  indicator_version:  string | null;
  prompt_version:     string | null;
  source_path:        string | null;
  synced_at:          string | null;
}

export interface SystemStatusEntry {
  key:           string;
  value:         string | null;
  last_updated:  string | null;
  details_json:  string | null;
}

export interface SyncRun {
  id?:          number;
  started_at:   string;
  finished_at:  string | null;
  duration_ms:  number | null;
  status:       'ok' | 'partial' | 'error' | string;
  counts_json:  string | null;
  error:        string | null;
}

// ─── Dashboard data-transfer shapes (for server → page) ───────────────────────

export interface DashboardBundle {
  latestReport:       DailyReport | null;
  latestPostclose:    PostcloseReview | null;
  analyticsDashboard: any | null;   // parsed JSON of dashboard_snapshot.json
  modelSummary:       ModelStatus[];
  latestShadow:       { trading_date: string | null; predictions: ShadowPrediction[] } | null;
  system:             SystemStatusEntry[];
}
