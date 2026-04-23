import { getLatestPostclose, getReportByDate } from '../../lib/queries';
import Card, { StatCard } from '../../components/Card';
import Badge, { BiasBadge, GradeBadge, ProductionBadge } from '../../components/Badge';
import KeyValue from '../../components/KeyValue';
import EmptyState from '../../components/EmptyState';
import { fmtInt, fmtNum, fmtPct, fmtDateTime, parseJsonField } from '../../lib/format';

export const dynamic = 'force-dynamic';

export default function PostclosePage() {
  const pc = getLatestPostclose();
  if (!pc) return <EmptyState title="No post-close review synced." hint="npm run db:sync" />;
  const pm = getReportByDate(pc.trading_date);
  const tags = parseJsonField<string[]>(pc.failure_tags_json) ?? [];

  const biasMatch     = pc.bias_correct === 1;
  const dayTypeMatch  = pc.day_type_correct === 1;
  const rangeInTol    = pc.range_within_tolerance === 1;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Post-close · {pc.trading_date}</h1>
          <div className="mt-1 text-xs text-muted">Graded at {fmtDateTime(pc.graded_at_utc)} · status {pc.status ?? '—'}</div>
        </div>
        <div className="flex gap-2"><GradeBadge grade={pc.overall_grade} /><ProductionBadge /></div>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <StatCard label="Open"  value={fmtNum(pc.actual_open, 2)} />
        <StatCard label="High"  value={fmtNum(pc.actual_high, 2)} />
        <StatCard label="Low"   value={fmtNum(pc.actual_low, 2)} />
        <StatCard label="Close" value={fmtNum(pc.actual_close, 2)} />
        <StatCard label="Range" value={<>{fmtInt(pc.actual_range_points)} <span className="text-xs text-muted">pts</span></>} tone={rangeInTol ? 'bullish' : 'bearish'} sub={rangeInTol ? 'within tolerance' : 'outside tolerance'} />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Actual Bias" value={<BiasBadge bias={pc.bias_actual} />} sub={pc.bias_called ? `called ${pc.bias_called}` : undefined} tone={biasMatch ? 'bullish' : 'bearish'} />
        <StatCard label="Actual Day Type" value={pc.actual_day_type ?? '—'} sub={pc.day_type_called ? `called ${pc.day_type_called}` : undefined} tone={dayTypeMatch ? 'bullish' : pc.day_type_correct === 0 ? 'bearish' : 'default'} />
        <StatCard label="Range Error" value={<>{fmtInt(pc.range_estimate_error_points)} <span className="text-xs text-muted">pts</span></>} sub={pc.range_estimate_error_pct != null ? fmtPct(pc.range_estimate_error_pct) : undefined} />
        <StatCard label="Score" value={<>{pc.score_0_to_100 ?? '—'}<span className="text-xs text-muted"> /100</span></>} sub={`coverage ${Math.round((pc.coverage_pct ?? 0) * 100)}%`} />
      </section>

      <Card title="Grading comparison" subtitle="Rules-engine call vs realized outcome">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted">
              <tr><th className="text-left pb-2">Dimension</th><th className="text-left pb-2">Called</th><th className="text-left pb-2">Actual</th><th className="text-left pb-2">Status</th></tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <td className="py-2 font-medium">Bias</td>
                <td className="py-2"><BiasBadge bias={pc.bias_called} /></td>
                <td className="py-2"><BiasBadge bias={pc.bias_actual} /></td>
                <td className="py-2">{pc.bias_correct === 1 ? <Badge tone="bullish">hit</Badge> : pc.bias_correct === 0 ? <Badge tone="bearish">miss</Badge> : <Badge tone="neutral">ungraded</Badge>}</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-2 font-medium">Day type</td>
                <td className="py-2 font-mono">{pc.day_type_called ?? '—'}</td>
                <td className="py-2 font-mono">{pc.day_type_actual ?? '—'}</td>
                <td className="py-2">{pc.day_type_correct === 1 ? <Badge tone="bullish">hit</Badge> : pc.day_type_correct === 0 ? <Badge tone="bearish">miss</Badge> : <Badge tone="neutral">ungraded</Badge>}</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-2 font-medium">Range in tolerance</td>
                <td className="py-2 font-mono">{pm?.expected_range_points ?? '—'} pts expected</td>
                <td className="py-2 font-mono">{pc.actual_range_points ?? '—'} pts actual</td>
                <td className="py-2">{rangeInTol ? <Badge tone="bullish">within</Badge> : pc.range_within_tolerance === 0 ? <Badge tone="bearish">outside</Badge> : <Badge tone="neutral">ungraded</Badge>}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Failure tags">
        {tags.length === 0
          ? <div className="text-sm text-muted">None — clean run.</div>
          : <div className="flex flex-wrap gap-2">{tags.map(t => <Badge key={t} tone="warning">{t}</Badge>)}</div>}
      </Card>

      <Card title="Metadata">
        <KeyValue items={[
          { label: 'Symbol',          value: pc.symbol ?? '—' },
          { label: 'Graded at (UTC)', value: fmtDateTime(pc.graded_at_utc) },
          { label: 'Run at (UTC)',    value: fmtDateTime(pc.run_time_utc) },
          { label: 'Early close',     value: pc.early_close === 1 ? 'yes' : 'no' },
          { label: 'Partial grade',   value: pc.partial_grade === 1 ? 'yes' : 'no' },
          { label: 'Source file',     value: <code className="break-all text-[11px]">{pc.source_path}</code> },
        ]} />
      </Card>
    </div>
  );
}
