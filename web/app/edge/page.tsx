/**
 * /edge — Stage 7 ML Research page.
 *
 * READ-ONLY display of the local edge artifacts produced by
 *   tv edge coldstart | retrain | evaluate
 *
 * ────────────────────────────────────────────────────────────────────────
 * IMPORTANT UX CONTRACT
 *   Every card on this page is RESEARCH / EVALUATION ONLY.
 *   The rules engine remains the sole production source of truth.
 *   No ML output on this page drives the daily brief.
 * ────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Card, { StatCard } from '../../components/Card';
import Badge, { ProductionBadge, ShadowBadge } from '../../components/Badge';
import EmptyState from '../../components/EmptyState';
import { fmtNum, fmtPct } from '../../lib/format';

export const dynamic = 'force-dynamic';

const EDGE_DIR = join(homedir(), '.tradingview-mcp', 'edge');

function readEdgeJson(file: string): any {
  const p = join(EDGE_DIR, file);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function readBreakdown(dim: string): any {
  return readEdgeJson(`breakdowns/${dim}.json`);
}

function formatRate(r: any): string {
  if (r == null) return '—';
  return `${(r * 100).toFixed(1)}%`;
}

function deltaTone(delta: number | null | undefined): 'bullish' | 'bearish' | 'neutral' {
  if (delta == null) return 'neutral';
  if (delta > 0.001)  return 'bullish';
  if (delta < -0.001) return 'bearish';
  return 'neutral';
}

export default function EdgePage() {
  const summary    = readEdgeJson('evaluation_summary.json');
  const agreement  = readEdgeJson('agreement_matrix.json');
  const champion   = readEdgeJson('champion_report.json');
  const weights    = readEdgeJson('weighting_scheme.json');
  const coldstart  = readEdgeJson('coldstart_summary.json');
  const promotion  = readEdgeJson('promotion_check.json');
  const regimeBrk  = readBreakdown('volatility_regime');
  const backfillBrk = readBreakdown('is_backfill');
  const weekdayBrk = readBreakdown('weekday');

  if (!summary && !coldstart) {
    return (
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Edge · ML Research</h1>
            <div className="mt-1 text-xs text-muted">Rules engine stays production — these metrics are research only.</div>
          </div>
          <div className="flex gap-2"><ProductionBadge /><ShadowBadge /></div>
        </header>
        <EmptyState
          title="No edge artifacts yet"
          message="Run a coldstart to backfill history, retrain, and evaluate."
          hint="tv edge coldstart --days 90 --chunk 10"
        />
      </div>
    );
  }

  const bias     = summary?.bias_direction;
  const range    = summary?.actual_range_points;
  const evalRows = summary?.eval_rows_total ?? 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Edge · ML Research</h1>
          <div className="mt-1 text-xs text-muted">
            {evalRows} evaluation rows · last updated {summary?.last_updated ?? '—'}
          </div>
        </div>
        <div className="flex gap-2"><ProductionBadge /><ShadowBadge /></div>
      </header>

      <div className="rounded border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-warning">
        <strong>Research / evaluation only.</strong> Every metric below compares the ML champion to the rules engine and to a baseline.
        The rules engine remains the sole production decision-maker regardless of what these numbers show.
      </div>

      {/* Bias direction headline */}
      {bias && (
        <Card title="bias_direction — rules vs ML vs baseline" subtitle={`n=${bias.n}, ${summary.note ?? ''}`}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard label="Rules engine hit rate"
                      value={formatRate(bias.rules?.hit_rate)}
                      sub={`${bias.rules?.hits}/${bias.rules?.n}`}
                      tone="bullish" />
            <StatCard label="ML champion hit rate"
                      value={formatRate(bias.ml?.hit_rate)}
                      sub={bias.ml?.is_baseline ? `baseline — majority="${bias.ml?.majority_class ?? '?'}"` : `${bias.ml?.hits}/${bias.ml?.n}`}
                      tone={bias.ml?.is_baseline ? 'warning' : 'default'} />
            <StatCard label="Baseline hit rate"
                      value={formatRate(bias.baseline?.hit_rate)}
                      sub={`majority "${bias.baseline?.majority_class ?? '?'}"`}
                      tone="neutral" />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard label="ML − Rules"
                      value={bias.ml_advantage_over_rules != null ? `${bias.ml_advantage_over_rules >= 0 ? '+' : ''}${(bias.ml_advantage_over_rules * 100).toFixed(1)}%` : '—'}
                      tone={deltaTone(bias.ml_advantage_over_rules)} />
            <StatCard label="ML − Baseline"
                      value={bias.ml_advantage_over_baseline != null ? `${bias.ml_advantage_over_baseline >= 0 ? '+' : ''}${(bias.ml_advantage_over_baseline * 100).toFixed(1)}%` : '—'}
                      tone={deltaTone(bias.ml_advantage_over_baseline)} />
            <StatCard label="Rules ↔ ML agreement"
                      value={formatRate(bias.agreement?.rate)}
                      sub={`on ${bias.agreement?.n} comparable predictions`} />
          </div>
        </Card>
      )}

      {/* Actual range (regression) */}
      {range && (
        <Card title="actual_range_points — lower MAE is better" subtitle={`n=${range.n}${range.ml_is_baseline ? ' · ML is a mean-predictor baseline' : ''}`}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard label="Rules expected_range (MAE)" value={range.rules_mae != null ? `${fmtNum(range.rules_mae, 1)} pts` : '—'} tone="bullish" />
            <StatCard label="ML (MAE)"                    value={range.ml_mae    != null ? `${fmtNum(range.ml_mae,    1)} pts` : '—'} tone={range.ml_is_baseline ? 'warning' : 'default'} />
            <StatCard label="Baseline mean (MAE)"         value={range.baseline_mae != null ? `${fmtNum(range.baseline_mae, 1)} pts` : '—'} tone="neutral" />
          </div>
        </Card>
      )}

      {/* Agreement matrix */}
      {agreement?.matrix && (
        <Card title="Rules vs ML agreement matrix (bias_direction)" subtitle={`rate ${formatRate(agreement.agreement_rate)} on ${agreement.agreement_n} samples`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted">
                <tr><th className="p-2 text-left">rules ↓ / ML →</th>
                  {['bullish','bearish','neutral'].map(c => <th key={c} className="p-2 text-right">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {['bullish','bearish','neutral'].map(r => (
                  <tr key={r} className="border-t border-border">
                    <td className="p-2 font-medium">{r}</td>
                    {['bullish','bearish','neutral'].map(c => (
                      <td key={c} className={`p-2 text-right font-mono ${r === c ? 'text-bullish' : 'text-muted'}`}>
                        {agreement.matrix?.[r]?.[c] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Regime breakdown */}
      {regimeBrk?.groups && (
        <Card title="Bias hit rate by volatility regime" subtitle={`eval rows: ${regimeBrk.eval_rows}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted"><tr>
                <th className="p-2 text-left">Regime</th>
                <th className="p-2 text-right">n</th>
                <th className="p-2 text-right">Rules</th>
                <th className="p-2 text-right">ML</th>
                <th className="p-2 text-right">Baseline</th>
                <th className="p-2 text-right">ML − Rules</th>
              </tr></thead>
              <tbody>
                {Object.entries<any>(regimeBrk.groups).map(([regime, g]) => (
                  <tr key={regime} className="border-t border-border">
                    <td className="p-2 font-mono">{regime}</td>
                    <td className="p-2 text-right font-mono">{g.n}</td>
                    <td className="p-2 text-right font-mono">{formatRate(g.rules?.hit_rate)}</td>
                    <td className="p-2 text-right font-mono">{formatRate(g.ml?.hit_rate)}</td>
                    <td className="p-2 text-right font-mono">{formatRate(g.baseline?.hit_rate)}</td>
                    <td className={`p-2 text-right font-mono ${g.ml_advantage_over_rules != null && g.ml_advantage_over_rules > 0 ? 'text-bullish' : g.ml_advantage_over_rules != null && g.ml_advantage_over_rules < 0 ? 'text-bearish' : 'text-muted'}`}>
                      {g.ml_advantage_over_rules != null ? `${g.ml_advantage_over_rules > 0 ? '+' : ''}${(g.ml_advantage_over_rules * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Backfill vs live breakdown */}
      {backfillBrk?.groups && (
        <Card title="Bias hit rate — backfill vs live rows" subtitle="true = replay backfill, false = live scheduler">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted"><tr>
                <th className="p-2 text-left">is_backfill</th>
                <th className="p-2 text-right">n</th>
                <th className="p-2 text-right">Rules</th>
                <th className="p-2 text-right">ML</th>
                <th className="p-2 text-right">Baseline</th>
              </tr></thead>
              <tbody>
                {Object.entries<any>(backfillBrk.groups).map(([k, g]) => (
                  <tr key={k} className="border-t border-border">
                    <td className="p-2 font-mono">{k}</td>
                    <td className="p-2 text-right font-mono">{g.n}</td>
                    <td className="p-2 text-right font-mono">{formatRate(g.rules?.hit_rate)}</td>
                    <td className="p-2 text-right font-mono">{formatRate(g.ml?.hit_rate)}</td>
                    <td className="p-2 text-right font-mono">{formatRate(g.baseline?.hit_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Weekday breakdown */}
      {weekdayBrk?.groups && (
        <Card title="Bias hit rate by weekday">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted"><tr>
                <th className="p-2 text-left">Weekday</th>
                <th className="p-2 text-right">n</th>
                <th className="p-2 text-right">Rules</th>
                <th className="p-2 text-right">ML</th>
              </tr></thead>
              <tbody>
                {Object.entries<any>(weekdayBrk.groups).map(([k, g]) => (
                  <tr key={k} className="border-t border-border">
                    <td className="p-2 font-mono">{k}</td>
                    <td className="p-2 text-right font-mono">{g.n}</td>
                    <td className="p-2 text-right font-mono">{formatRate(g.rules?.hit_rate)}</td>
                    <td className="p-2 text-right font-mono">{formatRate(g.ml?.hit_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Promotion policy */}
      {promotion && (
        <Card title="ML promotion policy" subtitle="DEFINITION ONLY — never activates promotion">
          <div className="mb-3 text-sm text-muted">{promotion.note}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted"><tr>
                <th className="p-2 text-left">Criterion</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-left">Detail</th>
              </tr></thead>
              <tbody>
                {Object.entries<any>(promotion.checks ?? {}).map(([k, v]) => (
                  <tr key={k} className="border-t border-border">
                    <td className="p-2 font-mono">{k}</td>
                    <td className="p-2">{v.pass ? <Badge tone="bullish">pass</Badge> : <Badge tone="bearish">fail</Badge>}</td>
                    <td className="p-2 text-xs text-muted font-mono">{Object.entries(v).filter(([kk]) => kk !== 'pass').map(([kk, vv]) => `${kk}=${vv}`).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 text-xs text-muted">
            Current state: <Badge tone="warning">shadow only</Badge> &nbsp;
            would_promote: <span className="font-mono">{String(promotion.would_promote)}</span>,
            promote_now: <span className="font-mono">{String(promotion.promote_now)}</span>
          </div>
        </Card>
      )}

      {/* Weighting scheme */}
      {weights && (
        <Card title="Sample-weighting scheme" subtitle={`schema v${weights.schema_version}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted"><tr><th className="p-2 text-left">Tier</th><th className="p-2 text-right">Weight</th></tr></thead>
              <tbody>
                {Object.entries<any>(weights.tiers ?? {}).map(([k, v]) => (
                  <tr key={k} className="border-t border-border">
                    <td className="p-2 font-mono">{k}</td>
                    <td className="p-2 text-right font-mono">{v}</td>
                  </tr>
                ))}
                <tr className="border-t border-border"><td className="p-2 text-muted">partial coverage cap</td><td className="p-2 text-right font-mono">{weights.partial_coverage_cap}</td></tr>
                <tr className="border-t border-border"><td className="p-2 text-muted">floor (all degraded)</td><td className="p-2 text-right font-mono">{weights.floor_all_degraded}</td></tr>
                <tr className="border-t border-border"><td className="p-2 text-muted">sparse feature multiplier</td><td className="p-2 text-right font-mono">{weights.sparse_feature_multiplier}</td></tr>
              </tbody>
            </table>
          </div>
          <ul className="mt-3 list-disc pl-5 text-xs text-muted space-y-1">
            {(weights.notes ?? []).map((n: string, i: number) => <li key={i}>{n}</li>)}
          </ul>
        </Card>
      )}

      {/* Coldstart summary (last run) */}
      {coldstart && (
        <Card title="Last coldstart run" subtitle={`${coldstart.from ?? '?'} → ${coldstart.to ?? '?'} (${coldstart.days ?? '?'} days)`}>
          <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
            <div className="flex justify-between"><dt className="text-muted">Started</dt><dd className="font-mono text-xs">{coldstart.started_at}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Finished</dt><dd className="font-mono text-xs">{coldstart.finished_at}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Duration</dt><dd className="font-mono">{coldstart.duration_ms != null ? `${Math.round(coldstart.duration_ms / 1000)}s` : '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Backfill</dt>
              <dd className="font-mono text-xs">
                {coldstart.steps?.backfill?.skipped
                  ? 'skipped'
                  : `done=${coldstart.steps?.backfill?.dates_completed ?? '?'}, failed=${coldstart.steps?.backfill?.dates_failed ?? '?'}`}
              </dd></div>
            <div className="flex justify-between"><dt className="text-muted">Dataset rows</dt>
              <dd className="font-mono text-xs">training_ready={coldstart.steps?.dataset?.counts?.training_ready_rows ?? '?'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Sync</dt>
              <dd className="font-mono text-xs">{coldstart.steps?.sync?.success ? 'ok' : 'failed'}</dd></div>
          </dl>
        </Card>
      )}
    </div>
  );
}
