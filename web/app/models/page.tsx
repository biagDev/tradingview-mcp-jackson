import { listModels } from '../../lib/queries';
import Card from '../../components/Card';
import Badge, { ShadowBadge } from '../../components/Badge';
import EmptyState from '../../components/EmptyState';
import { fmtDateTime, parseJsonField } from '../../lib/format';

export const dynamic = 'force-dynamic';

export default function ModelsPage() {
  const models = listModels();
  if (models.length === 0) return <EmptyState title="No model status synced yet." hint="npm run db:sync" />;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Models</h1>
          <div className="mt-1 text-xs text-muted">Training status per task. Rules engine remains production — these are shadow-only.</div>
        </div>
        <ShadowBadge />
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {models.map(m => {
          const testM = parseJsonField<any>(m.test_metrics_json);
          const statusTone: any = m.status === 'trained' ? 'bullish' : m.status === 'baseline_only' ? 'warning' : 'neutral';
          return (
            <Card key={m.task} title={m.task} actions={<Badge tone={statusTone}>{m.status ?? 'unknown'}</Badge>}>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Champion</dt><dd className="font-mono">{m.champion_name ?? '—'} {m.is_baseline === 1 && <Badge tone="warning" className="ml-1">baseline</Badge>}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Family</dt><dd className="font-mono">{m.champion_family ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Metric</dt><dd className="font-mono">{m.champion_metric ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Val score</dt><dd className="font-mono">{m.validation_metric ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Data window</dt><dd className="font-mono">train {m.rows_train ?? 0} · val {m.rows_validation ?? 0} · test {m.rows_test ?? 0}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Last trained</dt><dd className="font-mono text-xs">{fmtDateTime(m.last_trained_utc)}</dd></div>
                {testM && (
                  <div className="rounded border border-border/60 bg-surface2 p-2 text-xs">
                    <div className="text-muted mb-1">Test metrics</div>
                    <pre className="whitespace-pre-wrap text-[11px]">{JSON.stringify(testM, null, 2)}</pre>
                  </div>
                )}
                {m.notes && <div className="text-xs text-muted">{m.notes}</div>}
              </dl>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
