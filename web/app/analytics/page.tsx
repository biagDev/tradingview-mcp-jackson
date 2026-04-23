import { getAnalyticsSnapshot, listBreakdowns } from '../../lib/queries';
import Card, { StatCard } from '../../components/Card';
import Badge from '../../components/Badge';
import EmptyState from '../../components/EmptyState';
import { fmtNum, fmtPct, parseJsonField } from '../../lib/format';

export const dynamic = 'force-dynamic';

export default function AnalyticsPage() {
  const summary  = parseJsonField<any>(getAnalyticsSnapshot('summary')?.payload);
  const rolling  = parseJsonField<any>(getAnalyticsSnapshot('rolling')?.payload);
  const coverage = parseJsonField<any>(getAnalyticsSnapshot('coverage')?.payload);
  const drift    = parseJsonField<any>(getAnalyticsSnapshot('drift')?.payload);
  const misses   = parseJsonField<any>(getAnalyticsSnapshot('recent_misses')?.payload);
  const best     = parseJsonField<any>(getAnalyticsSnapshot('best')?.payload);
  const worst    = parseJsonField<any>(getAnalyticsSnapshot('worst')?.payload);
  const breakdowns = listBreakdowns();

  if (!summary) return <EmptyState title="No analytics yet." message="Run the pipeline and sync." hint="cd web && npm run db:sync" />;

  const rateStr = (v: any) => v == null ? '—' : `${Math.round(v * 100)}%`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <div className="mt-1 text-xs text-muted">{summary.total_days_graded ?? 0} graded day{summary.total_days_graded === 1 ? '' : 's'}</div>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Bias hit rate"          value={rateStr(summary.bias_hit_rate)} sub={`n=${summary.total_days_graded}`} />
        <StatCard label="Day-type hit rate"      value={rateStr(summary.day_type_hit_rate)} />
        <StatCard label="Range within tolerance" value={rateStr(summary.range_within_tolerance_rate)} />
        <StatCard label="Avg score"              value={summary.average_score ?? '—'} sub={summary.average_range_error_points != null ? `avg err ${summary.average_range_error_points} pts` : undefined} />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {['last_5_days','last_20_days','last_60_days'].map(key => {
          const w = rolling?.[key];
          if (!w) return null;
          return (
            <Card key={key} title={key.replace(/_/g, ' ')} subtitle={`n=${w.n}`}>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted">bias hit</span><span className="font-mono">{rateStr(w.bias_hit_rate)}</span></div>
                <div className="flex justify-between"><span className="text-muted">day-type hit</span><span className="font-mono">{rateStr(w.day_type_hit_rate)}</span></div>
                <div className="flex justify-between"><span className="text-muted">range in tol</span><span className="font-mono">{rateStr(w.range_within_tolerance_rate)}</span></div>
                <div className="flex justify-between"><span className="text-muted">avg score</span><span className="font-mono">{w.average_score ?? '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted">coverage</span><span className="font-mono">{fmtPct(w.average_coverage_pct)}</span></div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {Object.entries(w.grade_distribution ?? {}).map(([g, n]: any) => <Badge key={g} tone="default">{`${g}·${n}`}</Badge>)}
                </div>
              </div>
            </Card>
          );
        })}
      </section>

      <Card title="Coverage metrics">
        {coverage ? (
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
            <div className="flex justify-between"><span className="text-muted">bias graded</span><span className="font-mono">{fmtPct(coverage.percent_with_bias_graded)}</span></div>
            <div className="flex justify-between"><span className="text-muted">day-type graded</span><span className="font-mono">{fmtPct(coverage.percent_with_day_type_graded)}</span></div>
            <div className="flex justify-between"><span className="text-muted">range graded</span><span className="font-mono">{fmtPct(coverage.percent_with_range_graded)}</span></div>
            <div className="flex justify-between"><span className="text-muted">full grade rate</span><span className="font-mono">{fmtPct(coverage.percent_full_grade)}</span></div>
            <div className="flex justify-between"><span className="text-muted">partial grade rate</span><span className="font-mono">{fmtPct(coverage.percent_partial_grade)}</span></div>
            <div className="flex justify-between"><span className="text-muted">avg dimensions</span><span className="font-mono">{fmtNum(coverage.average_graded_dimensions, 2)}</span></div>
          </div>
        ) : <div className="text-sm text-muted">No coverage report.</div>}
      </Card>

      <Card title="Drift (current vs prior window)">
        {drift?.comparisons ? (
          <div className="space-y-3 text-sm">
            {Object.entries<any>(drift.comparisons).map(([k, v]) => (
              <div key={k} className="rounded border border-border/60 bg-surface2 p-3">
                <div className="mb-1 text-xs font-semibold text-muted">{k}</div>
                {v.sufficient_history === false ? (
                  <div className="text-muted">{v.note}</div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    {['average_score','bias_hit_rate','day_type_hit_rate','range_within_tolerance_rate','average_range_error_points'].map(m => v[m] ? (
                      <div key={m} className="flex justify-between"><span className="text-muted">{m}</span><span className="font-mono">{v[m].current} · Δ {v[m].delta}</span></div>
                    ) : null)}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : <div className="text-sm text-muted">No drift metrics yet.</div>}
      </Card>

      <Card title="Best / worst cohorts">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-2 text-xs text-muted">Best — top 5 by avg score</div>
            {(best?.top_5_global ?? []).length === 0
              ? <div className="text-sm text-muted">Needs ≥3 cohort samples.</div>
              : <ul className="space-y-1 text-sm">{best.top_5_global.map((c: any, i: number) => <li key={i} className="flex justify-between"><span className="font-mono text-xs">{c.by}·{c.key} (n={c.n})</span><span className="text-bullish">{c.average_score}</span></li>)}</ul>}
          </div>
          <div>
            <div className="mb-2 text-xs text-muted">Worst — bottom 5 by avg score</div>
            {(worst?.bottom_5_global ?? []).length === 0
              ? <div className="text-sm text-muted">Needs ≥3 cohort samples.</div>
              : <ul className="space-y-1 text-sm">{worst.bottom_5_global.map((c: any, i: number) => <li key={i} className="flex justify-between"><span className="font-mono text-xs">{c.by}·{c.key} (n={c.n})</span><span className="text-bearish">{c.average_score}</span></li>)}</ul>}
          </div>
        </div>
      </Card>

      <Card title="Recent misses">
        {(misses?.misses ?? []).length === 0
          ? <div className="text-sm text-muted">No misses recorded.</div>
          : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-muted"><tr className="text-left"><th className="pb-2 pr-4">Date</th><th className="pb-2 pr-4">Grade</th><th className="pb-2 pr-4">Score</th><th className="pb-2 pr-4">Bias</th><th className="pb-2 pr-4">Tags</th></tr></thead><tbody>{misses.misses.map((m: any) => <tr key={m.trading_date} className="border-t border-border"><td className="py-2 pr-4 font-mono">{m.trading_date}</td><td className="py-2 pr-4">{m.overall_grade}</td><td className="py-2 pr-4">{m.score_0_to_100}</td><td className="py-2 pr-4">{m.bias_called} → {m.bias_actual}</td><td className="py-2 pr-4 text-[11px]">{(m.failure_tags ?? []).join(', ') || '—'}</td></tr>)}</tbody></table></div>}
      </Card>

      <Card title="Breakdowns available">
        <div className="flex flex-wrap gap-2">
          {breakdowns.map(b => <Badge key={b.dimension} tone="default">{b.dimension}</Badge>)}
        </div>
        <div className="mt-3 text-xs text-muted">Raw breakdown JSON lives at ~/.tradingview-mcp/analytics/breakdowns/&lt;dim&gt;.json.</div>
      </Card>
    </div>
  );
}
