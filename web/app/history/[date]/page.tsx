import { getReportByDate, getPostcloseByDate, listShadowForDate } from '../../../lib/queries';
import Card, { StatCard } from '../../../components/Card';
import Badge, { BiasBadge, GradeBadge, ShadowBadge, ProductionBadge } from '../../../components/Badge';
import KeyValue from '../../../components/KeyValue';
import EmptyState from '../../../components/EmptyState';
import { fmtInt, fmtNum, fmtDateTime, parseJsonField } from '../../../lib/format';

export const dynamic = 'force-dynamic';

export default function DailyDetailPage({ params }: { params: { date: string } }) {
  const date = params.date;
  const pm = getReportByDate(date);
  const pc = getPostcloseByDate(date);
  const shadow = listShadowForDate(date);

  if (!pm && !pc) return <EmptyState title={`No records for ${date}`} hint="Check that the date exists under ~/.tradingview-mcp/reports/ then run sync." />;

  const tags = parseJsonField<string[]>(pc?.failure_tags_json ?? null) ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Day detail · {date}</h1>
          <div className="mt-1 text-xs text-muted">
            {pm ? `premarket ${fmtDateTime(pm.run_time_utc)}` : 'no premarket'} ·{' '}
            {pc ? `postclose ${fmtDateTime(pc.run_time_utc ?? pc.graded_at_utc)}` : 'no postclose'}
          </div>
        </div>
        <div className="flex gap-2">
          <ProductionBadge />
          <GradeBadge grade={pc?.overall_grade} />
        </div>
      </header>

      {/* Premarket summary */}
      {pm ? (
        <Card title="Premarket call">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Bias" value={<BiasBadge bias={pm.bias} />} sub={`confidence ${pm.confidence ?? '—'}`} />
            <StatCard label="Day Type" value={pm.day_type ?? '—'} />
            <StatCard label="Expected Range" value={<>{fmtInt(pm.expected_range_points)} <span className="text-xs text-muted">pts</span></>} sub={pm.expected_range_source ?? undefined} />
            <StatCard label="Regime" value={pm.volatility_regime ?? '—'} />
          </div>
          {pm.narrative_report && (
            <div className="mt-4 rounded border border-border/60 bg-surface2 p-3 text-sm">
              <pre className="whitespace-pre-wrap">{pm.narrative_report}</pre>
            </div>
          )}
        </Card>
      ) : <Card title="Premarket call"><div className="text-sm text-muted">No premarket saved.</div></Card>}

      {/* Post-close summary */}
      {pc ? (
        <Card title="Post-close actual">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <StatCard label="Open"  value={fmtNum(pc.actual_open, 2)} />
            <StatCard label="High"  value={fmtNum(pc.actual_high, 2)} />
            <StatCard label="Low"   value={fmtNum(pc.actual_low, 2)} />
            <StatCard label="Close" value={fmtNum(pc.actual_close, 2)} />
            <StatCard label="Range" value={<>{fmtInt(pc.actual_range_points)} <span className="text-xs text-muted">pts</span></>} tone={pc.range_within_tolerance === 1 ? 'bullish' : pc.range_within_tolerance === 0 ? 'bearish' : 'default'} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard label="Bias outcome" value={pc.bias_correct === 1 ? 'HIT' : pc.bias_correct === 0 ? 'MISS' : '—'} tone={pc.bias_correct === 1 ? 'bullish' : pc.bias_correct === 0 ? 'bearish' : 'default'} sub={`${pc.bias_called ?? '—'} → ${pc.bias_actual ?? '—'}`} />
            <StatCard label="Day-type outcome" value={pc.day_type_correct === 1 ? 'HIT' : pc.day_type_correct === 0 ? 'MISS' : '—'} tone={pc.day_type_correct === 1 ? 'bullish' : pc.day_type_correct === 0 ? 'bearish' : 'default'} sub={`${pc.day_type_called ?? '—'} → ${pc.day_type_actual ?? '—'}`} />
            <StatCard label="Score" value={<>{pc.score_0_to_100 ?? '—'}<span className="text-xs text-muted"> /100</span></>} sub={`coverage ${Math.round((pc.coverage_pct ?? 0)*100)}%${pc.partial_grade === 1 ? ' · partial' : ''}`} />
          </div>
          {tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {tags.map(t => <Badge key={t} tone="warning">{t}</Badge>)}
            </div>
          )}
        </Card>
      ) : <Card title="Post-close actual"><div className="text-sm text-muted">No post-close saved.</div></Card>}

      {/* Shadow predictions for this date */}
      <Card title="Shadow predictions (audit only)" actions={<ShadowBadge />}>
        {shadow.length === 0 ? (
          <div className="text-sm text-muted">No shadow predictions recorded for this date.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-muted">
              <tr className="text-left">
                <th className="pb-2 pr-4">Task</th>
                <th className="pb-2 pr-4">Prediction</th>
                <th className="pb-2 pr-4">Source</th>
                <th className="pb-2 pr-4">Family</th>
                <th className="pb-2">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {shadow.map(s => (
                <tr key={`${s.task}-${s.timestamp}`} className="border-t border-border">
                  <td className="py-2 pr-4 font-mono">{s.task}</td>
                  <td className="py-2 pr-4 font-mono">{s.prediction ?? '—'}</td>
                  <td className="py-2 pr-4">{s.is_baseline === 1 ? <Badge tone="warning">baseline</Badge> : <Badge tone="accent">champion</Badge>}</td>
                  <td className="py-2 pr-4 text-xs text-muted">{s.family ?? '—'}</td>
                  <td className="py-2 text-[11px] text-muted">{fmtDateTime(s.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {pm && (
        <Card title="Version metadata">
          <KeyValue items={[
            { label: 'Model version',     value: pm.model_version ?? '—' },
            { label: 'Indicator version', value: pm.indicator_version ?? '—' },
            { label: 'Prompt version',    value: pm.prompt_version ?? '—' },
            { label: 'Calendar',          value: `${pm.calendar_source ?? '—'}${pm.early_close ? ' · early close' : ''}` },
            { label: 'Data quality',      value: pm.data_quality_complete ?? '—' },
            { label: 'Key levels',        value: pm.key_level_count ?? '—' },
          ]} />
        </Card>
      )}
    </div>
  );
}
