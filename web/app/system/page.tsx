import { listSystemStatus, listSyncRuns } from '../../lib/queries';
import Card from '../../components/Card';
import Badge from '../../components/Badge';
import EmptyState from '../../components/EmptyState';
import { fmtDateTime, relativeAge, parseJsonField } from '../../lib/format';

export const dynamic = 'force-dynamic';

const KEY_LABEL: Record<string, string> = {
  last_premarket:       'Last premarket run',
  last_postclose:       'Last post-close run',
  last_analytics:       'Last analytics rebuild',
  last_dataset:         'Last dataset rebuild',
  last_model_train:     'Last model training',
  last_shadow_predict:  'Last shadow prediction',
  last_sync:            'Last DB sync',
};

export default function SystemPage() {
  const system = listSystemStatus();
  const runs = listSyncRuns({ limit: 10 });

  if (system.length === 0) return <EmptyState title="No system status yet." hint="npm run db:sync" />;

  const ageToneFor = (last: string | null | undefined) => {
    if (!last) return 'neutral';
    const age = Date.now() - new Date(last).getTime();
    const h = age / 3_600_000;
    if (h <= 24) return 'bullish';
    if (h <= 72) return 'warning';
    return 'bearish';
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">System</h1>
        <div className="mt-1 text-xs text-muted">Freshness of each pipeline stage, derived from file mtimes and artifact timestamps.</div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Object.keys(KEY_LABEL).map(k => {
          const row = system.find(s => s.key === k);
          const details = parseJsonField<any>(row?.details_json);
          const tone: any = ageToneFor(row?.last_updated);
          return (
            <Card key={k} title={KEY_LABEL[k]} actions={<Badge tone={tone}>{relativeAge(row?.last_updated)}</Badge>}>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Value</dt><dd className="font-mono text-xs break-all">{row?.value ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Last updated</dt><dd className="font-mono text-xs">{fmtDateTime(row?.last_updated)}</dd></div>
                {details && (
                  <div className="rounded border border-border/60 bg-surface2 p-2 text-[11px]">
                    <pre className="whitespace-pre-wrap">{JSON.stringify(details, null, 2)}</pre>
                  </div>
                )}
              </dl>
            </Card>
          );
        })}
      </div>

      <Card title="Recent sync runs">
        {runs.length === 0 ? <div className="text-sm text-muted">No sync runs recorded.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted">
                <tr className="text-left">
                  <th className="pb-2 pr-4">Started</th>
                  <th className="pb-2 pr-4">Duration</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Counts</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-2 pr-4 font-mono text-xs">{fmtDateTime(r.started_at)}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{r.duration_ms ?? '—'} ms</td>
                    <td className="py-2 pr-4">{r.status === 'ok' ? <Badge tone="bullish">ok</Badge> : <Badge tone="bearish">{r.status}</Badge>}</td>
                    <td className="py-2 font-mono text-[11px]">{r.counts_json}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="rounded border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
        <div className="mb-1 font-semibold">Tip</div>
        <div className="text-muted">Run <code className="font-mono">cd web &amp;&amp; npm run db:sync</code> to re-import the latest pipeline artifacts, or POST to <code className="font-mono">/api/sync</code>.</div>
      </div>
    </div>
  );
}
