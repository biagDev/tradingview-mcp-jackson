/**
 * Artifact → SQLite sync/import layer.
 *
 * Reads every file under ~/.tradingview-mcp/{reports,performance,analytics,
 * datasets,models} and upserts into the DB. Idempotent — latest artifact wins.
 * Never throws on missing files / malformed JSON — logs a counts summary.
 */
import { join } from 'node:path';
import { getDb } from '../db/client';
import {
  REPORTS_DIR, ANALYTICS_DIR, BREAKDOWNS_DIR, GRADES_LOG,
  MODELS_DIR, TASKS_DIR, SHADOW_DIR, ANALYTICS_FILES, MODEL_TASKS, BREAKDOWN_DIMENSIONS,
} from './paths';
import { readJsonSafe, readJsonlSafe, listDirSafe, statMtime } from './fs-utils';

// ─── Helper — upsert wrappers ────────────────────────────────────────────────

function nowISO() { return new Date().toISOString(); }

function asIntBool(v: unknown): number | null {
  if (v === true)  return 1;
  if (v === false) return 0;
  if (v == null)   return null;
  if (typeof v === 'number') return v ? 1 : 0;
  return null;
}

// ─── Reports (premarket + postclose) ─────────────────────────────────────────

interface ReportSyncResult { premarket: number; postclose: number; }

export function syncReports(): ReportSyncResult {
  const db = getDb();
  const dates = listDirSafe(REPORTS_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  const pmStmt = db.prepare(`
    INSERT INTO daily_reports (
      trading_date, symbol, status, bias, confidence, day_type, day_type_source,
      expected_range_points, expected_range_low, expected_range_high, expected_range_source,
      volatility_regime, narrative_report, run_time_et, run_time_utc,
      model_version, indicator_version, prompt_version, calendar_source, early_close,
      data_quality_complete, data_quality_fallback, key_level_count,
      raw_json, source_path, synced_at
    ) VALUES (
      @trading_date, @symbol, @status, @bias, @confidence, @day_type, @day_type_source,
      @expected_range_points, @expected_range_low, @expected_range_high, @expected_range_source,
      @volatility_regime, @narrative_report, @run_time_et, @run_time_utc,
      @model_version, @indicator_version, @prompt_version, @calendar_source, @early_close,
      @data_quality_complete, @data_quality_fallback, @key_level_count,
      @raw_json, @source_path, @synced_at
    )
    ON CONFLICT(trading_date) DO UPDATE SET
      symbol = excluded.symbol, status = excluded.status, bias = excluded.bias,
      confidence = excluded.confidence, day_type = excluded.day_type,
      day_type_source = excluded.day_type_source,
      expected_range_points = excluded.expected_range_points,
      expected_range_low = excluded.expected_range_low,
      expected_range_high = excluded.expected_range_high,
      expected_range_source = excluded.expected_range_source,
      volatility_regime = excluded.volatility_regime,
      narrative_report = excluded.narrative_report,
      run_time_et = excluded.run_time_et, run_time_utc = excluded.run_time_utc,
      model_version = excluded.model_version, indicator_version = excluded.indicator_version,
      prompt_version = excluded.prompt_version, calendar_source = excluded.calendar_source,
      early_close = excluded.early_close,
      data_quality_complete = excluded.data_quality_complete,
      data_quality_fallback = excluded.data_quality_fallback,
      key_level_count = excluded.key_level_count,
      raw_json = excluded.raw_json, source_path = excluded.source_path,
      synced_at = excluded.synced_at
  `);

  const pcStmt = db.prepare(`
    INSERT INTO daily_postclose_reviews (
      trading_date, symbol, status, actual_open, actual_high, actual_low, actual_close,
      actual_range_points, actual_day_type, actual_volatility_regime,
      bias_called, bias_actual, bias_correct,
      day_type_called, day_type_actual, day_type_correct,
      range_within_tolerance, range_estimate_error_points, range_estimate_error_pct,
      overall_grade, score_0_to_100, coverage_pct, partial_grade, failure_tags_json,
      graded_at_utc, run_time_et, run_time_utc, early_close,
      raw_json, source_path, synced_at
    ) VALUES (
      @trading_date, @symbol, @status, @actual_open, @actual_high, @actual_low, @actual_close,
      @actual_range_points, @actual_day_type, @actual_volatility_regime,
      @bias_called, @bias_actual, @bias_correct,
      @day_type_called, @day_type_actual, @day_type_correct,
      @range_within_tolerance, @range_estimate_error_points, @range_estimate_error_pct,
      @overall_grade, @score_0_to_100, @coverage_pct, @partial_grade, @failure_tags_json,
      @graded_at_utc, @run_time_et, @run_time_utc, @early_close,
      @raw_json, @source_path, @synced_at
    )
    ON CONFLICT(trading_date) DO UPDATE SET
      symbol = excluded.symbol, status = excluded.status,
      actual_open = excluded.actual_open, actual_high = excluded.actual_high,
      actual_low = excluded.actual_low, actual_close = excluded.actual_close,
      actual_range_points = excluded.actual_range_points,
      actual_day_type = excluded.actual_day_type,
      actual_volatility_regime = excluded.actual_volatility_regime,
      bias_called = excluded.bias_called, bias_actual = excluded.bias_actual,
      bias_correct = excluded.bias_correct,
      day_type_called = excluded.day_type_called, day_type_actual = excluded.day_type_actual,
      day_type_correct = excluded.day_type_correct,
      range_within_tolerance = excluded.range_within_tolerance,
      range_estimate_error_points = excluded.range_estimate_error_points,
      range_estimate_error_pct = excluded.range_estimate_error_pct,
      overall_grade = excluded.overall_grade, score_0_to_100 = excluded.score_0_to_100,
      coverage_pct = excluded.coverage_pct, partial_grade = excluded.partial_grade,
      failure_tags_json = excluded.failure_tags_json,
      graded_at_utc = excluded.graded_at_utc,
      run_time_et = excluded.run_time_et, run_time_utc = excluded.run_time_utc,
      early_close = excluded.early_close,
      raw_json = excluded.raw_json, source_path = excluded.source_path,
      synced_at = excluded.synced_at
  `);

  let pmCount = 0, pcCount = 0;
  for (const date of dates) {
    const pmPath = join(REPORTS_DIR, date, 'premarket_nq.json');
    const pcPath = join(REPORTS_DIR, date, 'postclose_nq.json');

    const pm = readJsonSafe<any>(pmPath);
    if (pm) {
      pmStmt.run({
        trading_date:            date,
        symbol:                  pm.symbol ?? null,
        status:                  pm.status ?? null,
        bias:                    pm.bias ?? null,
        confidence:              pm.confidence ?? null,
        day_type:                pm.day_type ?? null,
        day_type_source:         pm.day_type_source ?? null,
        expected_range_points:   pm.expected_range?.points ?? null,
        expected_range_low:      pm.expected_range?.low ?? null,
        expected_range_high:     pm.expected_range?.high ?? null,
        expected_range_source:   pm.expected_range?.source ?? null,
        volatility_regime:       pm.volatility_regime ?? null,
        narrative_report:        pm.narrative_report ?? null,
        run_time_et:             pm.run_time_et ?? null,
        run_time_utc:            pm.run_time_utc ?? null,
        model_version:           pm.model_version ?? null,
        indicator_version:       pm.indicator_version ?? null,
        prompt_version:          pm.prompt_version ?? null,
        calendar_source:         pm.calendar?.source ?? null,
        early_close:             asIntBool(pm.calendar?.early_close),
        data_quality_complete:   pm.data_quality?.completeness ?? null,
        data_quality_fallback:   asIntBool(pm.data_quality?.fallback_used),
        key_level_count:         Array.isArray(pm.key_levels) ? pm.key_levels.length : null,
        raw_json:                JSON.stringify(pm),
        source_path:             pmPath,
        synced_at:               nowISO(),
      });
      pmCount++;
    }

    const pc = readJsonSafe<any>(pcPath);
    if (pc) {
      pcStmt.run({
        trading_date:                date,
        symbol:                      pc.symbol ?? null,
        status:                      pc.status ?? null,
        actual_open:                 pc.actual_session?.open ?? null,
        actual_high:                 pc.actual_session?.high ?? null,
        actual_low:                  pc.actual_session?.low ?? null,
        actual_close:                pc.actual_session?.close ?? null,
        actual_range_points:         pc.actual_session?.range_points ?? null,
        actual_day_type:             pc.actual_day_type ?? null,
        actual_volatility_regime:    pc.actual_volatility_regime ?? null,
        bias_called:                 pc.grading?.bias_called ?? pc.comparison_to_premarket?.bias_called ?? null,
        bias_actual:                 pc.grading?.bias_actual ?? null,
        bias_correct:                asIntBool(pc.grading?.bias_correct),
        day_type_called:             pc.grading?.day_type_called ?? pc.comparison_to_premarket?.day_type_called ?? null,
        day_type_actual:             pc.grading?.day_type_actual ?? pc.actual_day_type ?? null,
        day_type_correct:            asIntBool(pc.grading?.day_type_correct),
        range_within_tolerance:      asIntBool(pc.grading?.range_within_tolerance),
        range_estimate_error_points: pc.grading?.range_estimate_error_points ?? null,
        range_estimate_error_pct:    pc.grading?.range_estimate_error_pct ?? null,
        overall_grade:               pc.grading?.overall_grade ?? null,
        score_0_to_100:              pc.grading?.score_0_to_100 ?? null,
        coverage_pct:                pc.grading?.coverage_pct ?? null,
        partial_grade:               asIntBool(pc.grading?.partial_grade),
        failure_tags_json:           JSON.stringify(pc.grading?.failure_tags ?? []),
        graded_at_utc:               pc.grading?.graded_at_utc ?? null,
        run_time_et:                 pc.run_time_et ?? null,
        run_time_utc:                pc.run_time_utc ?? null,
        early_close:                 asIntBool(pc.calendar?.early_close),
        raw_json:                    JSON.stringify(pc),
        source_path:                 pcPath,
        synced_at:                   nowISO(),
      });
      pcCount++;
    }
  }
  return { premarket: pmCount, postclose: pcCount };
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export function syncAnalytics(): { snapshots: number; breakdowns: number } {
  const db = getDb();
  const snapStmt = db.prepare(`
    INSERT INTO analytics_snapshots (snapshot_type, payload, source_path, last_updated, synced_at)
    VALUES (@snapshot_type, @payload, @source_path, @last_updated, @synced_at)
    ON CONFLICT(snapshot_type) DO UPDATE SET
      payload = excluded.payload, source_path = excluded.source_path,
      last_updated = excluded.last_updated, synced_at = excluded.synced_at
  `);
  const brkStmt = db.prepare(`
    INSERT INTO analytics_breakdowns (dimension, payload, source_path, last_updated, synced_at)
    VALUES (@dimension, @payload, @source_path, @last_updated, @synced_at)
    ON CONFLICT(dimension) DO UPDATE SET
      payload = excluded.payload, source_path = excluded.source_path,
      last_updated = excluded.last_updated, synced_at = excluded.synced_at
  `);

  let snaps = 0, brks = 0;
  for (const [key, filename] of Object.entries(ANALYTICS_FILES)) {
    const p = join(ANALYTICS_DIR, filename);
    const json = readJsonSafe<any>(p);
    if (!json) continue;
    snapStmt.run({
      snapshot_type: key,
      payload:       JSON.stringify(json),
      source_path:   p,
      last_updated:  json.last_updated ?? statMtime(p),
      synced_at:     nowISO(),
    });
    snaps++;
  }
  for (const dim of BREAKDOWN_DIMENSIONS) {
    const p = join(BREAKDOWNS_DIR, `${dim}.json`);
    const json = readJsonSafe<any>(p);
    if (!json) continue;
    brkStmt.run({
      dimension:    dim,
      payload:      JSON.stringify(json),
      source_path:  p,
      last_updated: json.last_updated ?? statMtime(p),
      synced_at:    nowISO(),
    });
    brks++;
  }
  return { snapshots: snaps, breakdowns: brks };
}

// ─── Model status ────────────────────────────────────────────────────────────

export function syncModels(): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO model_status (
      task, status, champion_name, champion_family, is_baseline,
      champion_metric, validation_metric, test_metrics_json,
      rows_train, rows_validation, rows_test,
      last_trained_utc, issues_json, notes, source_path, synced_at
    ) VALUES (
      @task, @status, @champion_name, @champion_family, @is_baseline,
      @champion_metric, @validation_metric, @test_metrics_json,
      @rows_train, @rows_validation, @rows_test,
      @last_trained_utc, @issues_json, @notes, @source_path, @synced_at
    )
    ON CONFLICT(task) DO UPDATE SET
      status = excluded.status, champion_name = excluded.champion_name,
      champion_family = excluded.champion_family, is_baseline = excluded.is_baseline,
      champion_metric = excluded.champion_metric, validation_metric = excluded.validation_metric,
      test_metrics_json = excluded.test_metrics_json,
      rows_train = excluded.rows_train, rows_validation = excluded.rows_validation,
      rows_test = excluded.rows_test,
      last_trained_utc = excluded.last_trained_utc, issues_json = excluded.issues_json,
      notes = excluded.notes, source_path = excluded.source_path,
      synced_at = excluded.synced_at
  `);

  let n = 0;
  for (const task of MODEL_TASKS) {
    const taskDir   = join(TASKS_DIR, task);
    const status    = readJsonSafe<any>(join(taskDir, 'training_status.json'));
    const champion  = readJsonSafe<any>(join(taskDir, 'champion.json'));
    if (!status && !champion) continue;

    stmt.run({
      task,
      status:             status?.status ?? 'not_trained',
      champion_name:      champion?.candidate_name ?? champion?.baseline_kind ?? null,
      champion_family:    champion?.family ?? champion?.baseline_kind ?? null,
      is_baseline:        asIntBool(champion?.is_baseline),
      champion_metric:    champion?.champion_metric ?? null,
      validation_metric:  champion?.validation_metric_value ?? null,
      test_metrics_json:  champion?.test_metrics ? JSON.stringify(champion.test_metrics) : null,
      rows_train:         status?.rows_train ?? null,
      rows_validation:    status?.rows_validation ?? null,
      rows_test:          status?.rows_test ?? null,
      last_trained_utc:   status?.attempted_at ?? null,
      issues_json:        status?.issues ? JSON.stringify(status.issues) : null,
      notes:              status?.notes ?? null,
      source_path:        taskDir,
      synced_at:          nowISO(),
    });
    n++;
  }
  return n;
}

// ─── Shadow predictions ──────────────────────────────────────────────────────

export function syncShadowPredictions(): number {
  const db = getDb();
  const latestPath = join(SHADOW_DIR, 'latest_predictions.json');
  const histPath   = join(SHADOW_DIR, 'prediction_history.jsonl');

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO shadow_predictions (
      trading_date, task, prediction, probabilities_json, is_baseline, family,
      candidate, timestamp, champion_metric, model_version, indicator_version,
      prompt_version, source_path, synced_at
    ) VALUES (
      @trading_date, @task, @prediction, @probabilities_json, @is_baseline, @family,
      @candidate, @timestamp, @champion_metric, @model_version, @indicator_version,
      @prompt_version, @source_path, @synced_at
    )
  `);

  const ingest = (snapshot: any, sourcePath: string) => {
    let n = 0;
    if (!snapshot || typeof snapshot !== 'object') return 0;
    const tradingDate: string | null = snapshot.trading_date ?? null;
    const preds = snapshot.predictions ?? {};
    for (const [task, p] of Object.entries<any>(preds)) {
      if (!p || typeof p !== 'object') continue;
      stmt.run({
        trading_date:        p.trading_date ?? tradingDate,
        task,
        prediction:          p.prediction != null ? String(p.prediction) : null,
        probabilities_json:  p.probabilities ? JSON.stringify(p.probabilities) : null,
        is_baseline:         asIntBool(p.is_baseline),
        family:              p.family ?? null,
        candidate:           p.candidate ?? null,
        timestamp:           p.timestamp ?? snapshot.last_updated ?? null,
        champion_metric:     p.champion_metric ?? null,
        model_version:       p.model_version?.model ?? null,
        indicator_version:   p.model_version?.indicator_version ?? null,
        prompt_version:      p.model_version?.prompt_version ?? null,
        source_path:         sourcePath,
        synced_at:           nowISO(),
      });
      n++;
    }
    return n;
  };

  let n = 0;
  // Latest snapshot
  const latest = readJsonSafe<any>(latestPath);
  if (latest) n += ingest(latest, latestPath);

  // History (every recorded snapshot)
  for (const snap of readJsonlSafe<any>(histPath)) {
    n += ingest(snap, histPath);
  }
  return n;
}

// ─── System status ───────────────────────────────────────────────────────────

export function syncSystemStatus(): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO system_status (key, value, last_updated, details_json)
    VALUES (@key, @value, @last_updated, @details_json)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value, last_updated = excluded.last_updated,
      details_json = excluded.details_json
  `);

  const entries: Array<{ key: string; value: string | null; last_updated: string | null; details_json: string | null }> = [];

  // Newest premarket / postclose
  const dates = listDirSafe(REPORTS_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const newestDate = dates[dates.length - 1] ?? null;
  if (newestDate) {
    const pmPath = join(REPORTS_DIR, newestDate, 'premarket_nq.json');
    const pcPath = join(REPORTS_DIR, newestDate, 'postclose_nq.json');
    const pm = readJsonSafe<any>(pmPath);
    const pc = readJsonSafe<any>(pcPath);
    entries.push({
      key: 'last_premarket',
      value: pm?.run_time_utc ?? null,
      last_updated: statMtime(pmPath),
      details_json: pm ? JSON.stringify({ date: newestDate, status: pm.status, bias: pm.bias }) : null,
    });
    entries.push({
      key: 'last_postclose',
      value: pc?.run_time_utc ?? pc?.grading?.graded_at_utc ?? null,
      last_updated: statMtime(pcPath),
      details_json: pc ? JSON.stringify({ date: newestDate, status: pc.status, overall_grade: pc.grading?.overall_grade ?? null }) : null,
    });
  }

  // Analytics / dataset / model freshness
  const analyticsSummaryPath = join(ANALYTICS_DIR, 'summary.json');
  const analyticsSummary = readJsonSafe<any>(analyticsSummaryPath);
  entries.push({
    key: 'last_analytics',
    value: analyticsSummary?.last_updated ?? null,
    last_updated: statMtime(analyticsSummaryPath),
    details_json: analyticsSummary ? JSON.stringify({ total_days_graded: analyticsSummary.total_days_graded }) : null,
  });

  const datasetManifestPath = join(GRADES_LOG, '..', '..', 'datasets', 'dataset_summary.json');
  const datasetSummary = readJsonSafe<any>(datasetManifestPath);
  entries.push({
    key: 'last_dataset',
    value: datasetSummary?.last_updated ?? null,
    last_updated: statMtime(datasetManifestPath),
    details_json: datasetSummary ? JSON.stringify({ counts: datasetSummary.counts, date_range: datasetSummary.date_range }) : null,
  });

  const modelSummaryPath = join(MODELS_DIR, 'training_summary.json');
  const modelSummary = readJsonSafe<any>(modelSummaryPath);
  entries.push({
    key: 'last_model_train',
    value: modelSummary?.last_updated ?? null,
    last_updated: statMtime(modelSummaryPath),
    details_json: modelSummary ? JSON.stringify({ data_window: modelSummary.data_window }) : null,
  });

  const shadowPath = join(SHADOW_DIR, 'latest_predictions.json');
  const shadow = readJsonSafe<any>(shadowPath);
  entries.push({
    key: 'last_shadow_predict',
    value: shadow?.last_updated ?? null,
    last_updated: statMtime(shadowPath),
    details_json: shadow ? JSON.stringify({ trading_date: shadow.trading_date, task_count: Object.keys(shadow.predictions ?? {}).length }) : null,
  });

  entries.push({
    key: 'last_sync',
    value: nowISO(),
    last_updated: nowISO(),
    details_json: null,
  });

  for (const e of entries) stmt.run(e);
  return entries.length;
}

// ─── Sync run log ────────────────────────────────────────────────────────────

function recordSyncRun(started_at: string, finished_at: string, status: string, counts: any, error: string | null) {
  const db = getDb();
  db.prepare(`
    INSERT INTO sync_runs (started_at, finished_at, duration_ms, status, counts_json, error)
    VALUES (@started_at, @finished_at, @duration_ms, @status, @counts_json, @error)
  `).run({
    started_at,
    finished_at,
    duration_ms: new Date(finished_at).getTime() - new Date(started_at).getTime(),
    status,
    counts_json: JSON.stringify(counts),
    error,
  });
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export interface SyncCounts {
  premarket:  number;
  postclose:  number;
  snapshots:  number;
  breakdowns: number;
  models:     number;
  shadow:     number;
  system:     number;
}

export function syncAllArtifacts(): { success: boolean; counts: SyncCounts; error?: string } {
  const started_at = nowISO();
  const counts: SyncCounts = { premarket: 0, postclose: 0, snapshots: 0, breakdowns: 0, models: 0, shadow: 0, system: 0 };
  try {
    const r = syncReports(); counts.premarket = r.premarket; counts.postclose = r.postclose;
    const a = syncAnalytics(); counts.snapshots = a.snapshots; counts.breakdowns = a.breakdowns;
    counts.models = syncModels();
    counts.shadow = syncShadowPredictions();
    counts.system = syncSystemStatus();
    const finished_at = nowISO();
    recordSyncRun(started_at, finished_at, 'ok', counts, null);
    return { success: true, counts };
  } catch (err: any) {
    const finished_at = nowISO();
    recordSyncRun(started_at, finished_at, 'error', counts, err?.message ?? String(err));
    return { success: false, counts, error: err?.message ?? String(err) };
  }
}
