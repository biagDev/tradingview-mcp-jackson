import { getLatestShadowByTask, listSystemStatus } from '../../lib/queries';
import Card from '../../components/Card';
import Badge, { ShadowBadge } from '../../components/Badge';
import EmptyState from '../../components/EmptyState';
import { fmtDateTime, parseJsonField } from '../../lib/format';

export const dynamic = 'force-dynamic';

export default function ShadowPage() {
  const preds   = getLatestShadowByTask();
  const sysRow  = listSystemStatus().find(s => s.key === 'last_shadow_predict');
  const details = parseJsonField<any>(sysRow?.details_json);

  if (preds.length === 0) return <EmptyState title="No shadow predictions yet." hint="Run `tv model shadow-predict` then sync." />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Shadow ML</h1>
          <div className="mt-1 text-xs text-muted">Trading date: <span className="font-mono">{details?.trading_date ?? preds[0]?.trading_date ?? '—'}</span> · last updated {fmtDateTime(sysRow?.value)}</div>
        </div>
        <ShadowBadge />
      </header>

      <div className="rounded border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-warning">
        Shadow-mode predictions are written for audit only. They DO NOT drive the production daily brief — the rules engine remains authoritative.
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {preds.map(p => {
          const probs = parseJsonField<Record<string, number>>(p.probabilities_json);
          return (
            <Card key={`${p.task}-${p.timestamp}`} title={p.task} actions={p.is_baseline === 1 ? <Badge tone="warning">baseline</Badge> : <Badge tone="accent">champion</Badge>}>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Prediction</dt><dd className="font-mono text-lg">{p.prediction ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Family</dt><dd className="font-mono">{p.family ?? '—'}</dd></div>
                {p.candidate && <div className="flex justify-between"><dt className="text-muted">Candidate</dt><dd className="font-mono">{p.candidate}</dd></div>}
                {probs && Object.keys(probs).length > 0 && (
                  <div className="rounded border border-border/60 bg-surface2 p-2">
                    <div className="text-xs text-muted mb-1">Class probabilities</div>
                    <div className="space-y-1">
                      {Object.entries(probs).map(([c, v]) => (
                        <div key={c} className="flex items-center gap-2 text-xs">
                          <div className="w-28 font-mono">{c}</div>
                          <div className="flex-1 h-2 rounded bg-border"><div className="h-2 rounded bg-accent" style={{ width: `${Math.min(100, (v ?? 0) * 100)}%` }} /></div>
                          <div className="w-12 text-right font-mono">{Math.round((v ?? 0) * 100)}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-between text-xs text-muted"><dt>Champion metric</dt><dd>{p.champion_metric ?? '—'}</dd></div>
                <div className="flex justify-between text-xs text-muted"><dt>Model version</dt><dd>{p.model_version ?? '—'}</dd></div>
                <div className="flex justify-between text-xs text-muted"><dt>Timestamp</dt><dd>{fmtDateTime(p.timestamp)}</dd></div>
              </dl>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
