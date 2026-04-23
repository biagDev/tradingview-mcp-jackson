/**
 * Today dashboard.
 * Shows the OFFICIAL rules-engine bias + latest grade + shadow summary.
 * Rules engine is clearly labeled as production; ML is clearly shadow-only.
 */
import Link from 'next/link';
import {
  getLatestReport, getLatestPostclose, getAnalyticsSnapshot,
  listModels, getLatestShadowByTask, listSystemStatus,
} from '../lib/queries';
import Card, { StatCard } from '../components/Card';
import Badge, { ProductionBadge, ShadowBadge, BiasBadge, GradeBadge } from '../components/Badge';
import EmptyState from '../components/EmptyState';
import { fmtInt, fmtDateTime, fmtNum, parseJsonField, relativeAge } from '../lib/format';

export const dynamic = 'force-dynamic';

export default function TodayPage() {
  const pm       = getLatestReport();
  const pc       = getLatestPostclose();
  const dashJson = getAnalyticsSnapshot('dashboard');
  const dash     = parseJsonField<any>(dashJson?.payload);
  const models   = listModels();
  const shadow   = getLatestShadowByTask();
  const system   = listSystemStatus();
  const lastSync = system.find(s => s.key === 'last_sync')?.last_updated ?? null;

  if (!pm) {
    return (
      <div className="space-y-6">
        <header><h1 className="text-2xl font-semibold">Today</h1></header>
        <EmptyState
          title="No premarket report synced yet"
          message="Run the sync script to import the latest pipeline artifacts."
          hint="cd web && npm run db:sync"
        />
      </div>
    );
  }

  const headline = dash?.headline ?? {};
  const biasShadow = shadow.find(s => s.task === 'bias_direction');
  const rangeShadow = shadow.find(s => s.task === 'actual_range_points');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Today · {pm.trading_date}</h1>
          <div className="mt-1 text-xs text-muted">
            Last synced {relativeAge(lastSync)} · indicator {pm.indicator_version ?? '—'} · prompt {pm.prompt_version ?? '—'}
          </div>
        </div>
        <div className="flex gap-2"><ProductionBadge /><ShadowBadge /></div>
      </header>

      {/* Headline production bias */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Official Bias (Rules)" value={<BiasBadge bias={pm.bias} />} sub={`confidence ${pm.confidence ?? '—'}`} />
        <StatCard label="Day Type" value={pm.day_type ?? '—'} sub={pm.day_type_source ? `source: ${pm.day_type_source}` : undefined} />
        <StatCard label="Expected Range" value={<>{fmtInt(pm.expected_range_points)} <span className="text-xs text-muted">pts</span></>} sub={pm.expected_range_source ? `source: ${pm.expected_range_source}` : undefined} />
        <StatCard label="Volatility Regime" value={pm.volatility_regime ?? '—'} />
      </section>

      {/* Latest grade + streak */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Latest Grade" value={<GradeBadge grade={pc?.overall_grade} />} sub={pc ? `score ${pc.score_0_to_100}/100` : 'no post-close yet'} />
        <StatCard label="Bias Hit Rate" value={headline.bias_hit_rate != null ? `${Math.round(headline.bias_hit_rate * 100)}%` : '—'} sub={`n=${headline.total_days_graded ?? 0}`} />
        <StatCard label="Current Streak" value={headline.current_streak ?? 0} sub={`longest win ${headline.longest_win_streak ?? 0}, loss ${headline.longest_loss_streak ?? 0}`} />
        <StatCard label="Avg Score" value={headline.average_score ?? '—'} sub={headline.range_within_tolerance_rate != null ? `range-in-tol ${Math.round(headline.range_within_tolerance_rate*100)}%` : undefined} />
      </section>

      {/* Narrative + shadow summary side-by-side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Premarket narrative" subtitle="Rules-engine output" actions={<Link href="/premarket" className="text-xs text-accent hover:underline">Open full report →</Link>}>
          {pm.narrative_report
            ? <pre className="whitespace-pre-wrap text-sm leading-relaxed text-text">{pm.narrative_report}</pre>
            : <div className="text-sm text-muted">No narrative embedded. Run `run_premarket_report` with `narrative` populated by Claude.</div>
          }
        </Card>

        <Card title="Shadow ML summary" subtitle="Auditable — NOT production" actions={<Link href="/shadow" className="text-xs text-accent hover:underline">Open shadow detail →</Link>}>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">bias_direction</span>
              <span className="font-mono">
                {biasShadow?.prediction ?? '—'} {biasShadow?.is_baseline ? <Badge tone="warning" className="ml-1">baseline</Badge> : biasShadow ? <Badge tone="accent" className="ml-1">champion</Badge> : null}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">actual_range_points</span>
              <span className="font-mono">
                {rangeShadow?.prediction != null ? fmtNum(Number(rangeShadow.prediction), 0) : '—'} pts {rangeShadow?.is_baseline ? <Badge tone="warning" className="ml-1">baseline</Badge> : null}
              </span>
            </div>
            <div className="pt-2 text-xs text-muted">
              These predictions do NOT drive the production brief. They are logged for audit and comparison only.
            </div>
          </div>
        </Card>
      </div>

      {/* Post-close last grade */}
      {pc && (
        <Card title={`Latest post-close review · ${pc.trading_date}`} actions={<Link href="/postclose" className="text-xs text-accent hover:underline">Open post-close →</Link>}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <StatCard label="Open"  value={fmtNum(pc.actual_open, 2)} />
            <StatCard label="High"  value={fmtNum(pc.actual_high, 2)} />
            <StatCard label="Low"   value={fmtNum(pc.actual_low, 2)} />
            <StatCard label="Close" value={fmtNum(pc.actual_close, 2)} />
            <StatCard label="Range" value={<>{fmtInt(pc.actual_range_points)} <span className="text-xs text-muted">pts</span></>} sub={pc.range_within_tolerance === 1 ? 'within tolerance' : pc.range_within_tolerance === 0 ? 'outside tolerance' : undefined} tone={pc.range_within_tolerance === 1 ? 'bullish' : pc.range_within_tolerance === 0 ? 'bearish' : 'default'} />
          </div>
        </Card>
      )}

      <div className="text-xs text-muted">
        Last activity: premarket {fmtDateTime(pm.run_time_utc)} · sync {fmtDateTime(lastSync)}
      </div>
    </div>
  );
}
