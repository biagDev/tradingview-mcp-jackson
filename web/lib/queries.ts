/**
 * Typed read functions used by server components.
 * Every function is synchronous (better-sqlite3) and returns app-shaped data.
 */
import { getDb } from '../db/client';
import type {
  DailyReport, PostcloseReview, AnalyticsSnapshot, AnalyticsBreakdown,
  ModelStatus, ShadowPrediction, SystemStatusEntry, SyncRun,
} from './types';

export function getLatestReport(): DailyReport | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM daily_reports ORDER BY trading_date DESC LIMIT 1`).get();
  return (row as DailyReport) ?? null;
}

export function getReportByDate(date: string): DailyReport | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM daily_reports WHERE trading_date = ?`).get(date);
  return (row as DailyReport) ?? null;
}

export function listReports({ limit = 200 }: { limit?: number } = {}): DailyReport[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM daily_reports ORDER BY trading_date DESC LIMIT ?`).all(limit);
  return rows as DailyReport[];
}

export function getLatestPostclose(): PostcloseReview | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM daily_postclose_reviews ORDER BY trading_date DESC LIMIT 1`).get();
  return (row as PostcloseReview) ?? null;
}

export function getPostcloseByDate(date: string): PostcloseReview | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM daily_postclose_reviews WHERE trading_date = ?`).get(date);
  return (row as PostcloseReview) ?? null;
}

export function listPostcloses({ limit = 200 }: { limit?: number } = {}): PostcloseReview[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM daily_postclose_reviews ORDER BY trading_date DESC LIMIT ?`).all(limit) as PostcloseReview[];
}

export function listRecentMisses({ limit = 10 }: { limit?: number } = {}): PostcloseReview[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM daily_postclose_reviews
    WHERE bias_correct = 0
       OR day_type_correct = 0
       OR range_within_tolerance = 0
       OR overall_grade IN ('D','F','NG')
       OR (partial_grade = 1 AND score_0_to_100 < 55)
    ORDER BY trading_date DESC
    LIMIT ?
  `).all(limit) as PostcloseReview[];
}

export function getAnalyticsSnapshot(type: string): AnalyticsSnapshot | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM analytics_snapshots WHERE snapshot_type = ?`).get(type);
  return (row as AnalyticsSnapshot) ?? null;
}

export function listAnalyticsSnapshots(): AnalyticsSnapshot[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM analytics_snapshots`).all() as AnalyticsSnapshot[];
}

export function getBreakdown(dim: string): AnalyticsBreakdown | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM analytics_breakdowns WHERE dimension = ?`).get(dim);
  return (row as AnalyticsBreakdown) ?? null;
}

export function listBreakdowns(): AnalyticsBreakdown[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM analytics_breakdowns`).all() as AnalyticsBreakdown[];
}

export function listModels(): ModelStatus[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM model_status ORDER BY task ASC`).all() as ModelStatus[];
}

export function getModel(task: string): ModelStatus | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM model_status WHERE task = ?`).get(task);
  return (row as ModelStatus) ?? null;
}

export function getLatestShadowByTask(): ShadowPrediction[] {
  const db = getDb();
  return db.prepare(`
    SELECT sp.* FROM shadow_predictions sp
    INNER JOIN (
      SELECT task, MAX(synced_at) AS max_synced FROM shadow_predictions GROUP BY task
    ) latest
      ON sp.task = latest.task AND sp.synced_at = latest.max_synced
    ORDER BY sp.task ASC
  `).all() as ShadowPrediction[];
}

export function listShadowForDate(date: string): ShadowPrediction[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM shadow_predictions WHERE trading_date = ? ORDER BY task ASC`).all(date) as ShadowPrediction[];
}

export function listSystemStatus(): SystemStatusEntry[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM system_status`).all() as SystemStatusEntry[];
}

export function listSyncRuns({ limit = 10 } = {}): SyncRun[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?`).all(limit) as SyncRun[];
}

/**
 * Daily score history for sparklines. Returns [{ trading_date, score, bias_correct }]
 * sorted ascending. Ungraded / null-score days are returned with score=null so
 * the sparkline can skip gaps.
 */
export function getDailyScoreHistory({ limit = 60 }: { limit?: number } = {}):
  Array<{ trading_date: string; score: number | null; bias_correct: number | null; overall_grade: string | null }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT trading_date, score_0_to_100 AS score, bias_correct, overall_grade
    FROM daily_postclose_reviews
    ORDER BY trading_date DESC
    LIMIT ?
  `).all(limit) as any[];
  return rows.reverse();   // oldest → newest for sparkline
}

/** Count of bias hits / misses across recent graded days. */
export function getBiasAgreementStats({ limit = 60 }: { limit?: number } = {}):
  { hits: number; misses: number; ungraded: number; rate: number | null } {
  const rows = getDailyScoreHistory({ limit });
  let hits = 0, misses = 0, ungraded = 0;
  for (const r of rows) {
    if (r.bias_correct === 1) hits++;
    else if (r.bias_correct === 0) misses++;
    else ungraded++;
  }
  const den = hits + misses;
  return { hits, misses, ungraded, rate: den > 0 ? hits / den : null };
}
