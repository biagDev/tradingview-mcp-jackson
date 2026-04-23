/**
 * Canonical paths for every pipeline artifact directory.
 * Mirrors the constants in src/core/*.js but kept here for type safety.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOME_DIR        = join(homedir(), '.tradingview-mcp');
export const REPORTS_DIR     = join(HOME_DIR, 'reports');
export const PERFORMANCE_DIR = join(HOME_DIR, 'performance');
export const ANALYTICS_DIR   = join(HOME_DIR, 'analytics');
export const BREAKDOWNS_DIR  = join(ANALYTICS_DIR, 'breakdowns');
export const DATASETS_DIR    = join(HOME_DIR, 'datasets');
export const MODELS_DIR      = join(HOME_DIR, 'models');
export const TASKS_DIR       = join(MODELS_DIR, 'tasks');
export const SHADOW_DIR      = join(MODELS_DIR, 'shadow');
export const GRADES_LOG      = join(PERFORMANCE_DIR, 'daily_grades.jsonl');

export const MODEL_TASKS = [
  'bias_direction',
  'day_type',
  'range_in_tolerance',
  'actual_range_points',
  'good_grade',
] as const;

export const BREAKDOWN_DIMENSIONS = [
  'weekday','month','bias_called','bias_actual','day_type_called',
  'day_type_actual','volatility_regime','calendar_source','early_close',
  'model_version','indicator_version','prompt_version',
  'data_quality_completeness','data_quality_fallback_used','partial_grade',
  'expected_range_source','day_type_source','failure_tags',
] as const;

export const ANALYTICS_FILES = {
  summary:        'summary.json',
  rolling:        'rolling_windows.json',
  coverage:       'coverage.json',
  drift:          'drift.json',
  recent_misses:  'recent_misses.json',
  best:           'best_conditions.json',
  worst:          'worst_conditions.json',
  failure_tags:   'failure_tags.json',
  dashboard:      'dashboard_snapshot.json',
} as const;
