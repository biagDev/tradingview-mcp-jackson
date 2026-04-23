import { getLatestReport } from '../../lib/queries';
import Card, { StatCard } from '../../components/Card';
import { BiasBadge, ProductionBadge } from '../../components/Badge';
import KeyValue from '../../components/KeyValue';
import EmptyState from '../../components/EmptyState';
import { fmtInt, fmtNum, fmtDateTime, parseJsonField } from '../../lib/format';

export const dynamic = 'force-dynamic';

export default function PremarketPage() {
  const r = getLatestReport();
  if (!r) return <EmptyState title="No premarket report synced." hint="npm run db:sync" />;

  const raw = parseJsonField<any>(r.raw_json) ?? {};
  const snap = raw.indicator_snapshot ?? {};
  const inter = raw.intermarket ?? snap.intermarket ?? {};

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Premarket · {r.trading_date}</h1>
          <div className="mt-1 text-xs text-muted">Run at {fmtDateTime(r.run_time_utc)} · status {r.status ?? '—'}</div>
        </div>
        <ProductionBadge />
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Bias" value={<BiasBadge bias={r.bias} />} sub={`confidence ${r.confidence ?? '—'}`} />
        <StatCard label="Day Type" value={r.day_type ?? '—'} sub={r.day_type_source ?? undefined} />
        <StatCard label="Expected Range" value={<>{fmtInt(r.expected_range_points)} <span className="text-xs text-muted">pts</span></>} sub={r.expected_range_source ?? undefined} />
        <StatCard label="Volatility Regime" value={r.volatility_regime ?? '—'} />
      </section>

      <Card title="Indicator snapshot">
        <KeyValue items={[
          { label: 'EMA 20',  value: fmtNum(snap.ema?.ema20,  2) },
          { label: 'EMA 50',  value: fmtNum(snap.ema?.ema50,  2) },
          { label: 'EMA 200', value: fmtNum(snap.ema?.ema200, 2) },
          { label: 'EMA stack', value: snap.ema?.stack ?? '—' },
          { label: 'RSI(14)', value: fmtNum(snap.rsi, 2) },
          { label: 'MACD hist', value: fmtNum(snap.macd_hist, 2) },
          { label: 'ADX(14)', value: fmtNum(snap.adx, 2) },
          { label: 'PDH / PDC / PDL', value: `${fmtNum(snap.prior_day?.pdh, 2)} / ${fmtNum(snap.prior_day?.pdc, 2)} / ${fmtNum(snap.prior_day?.pdl, 2)}` },
          { label: 'ONH / ONL', value: `${fmtNum(snap.overnight?.onh, 2)} / ${fmtNum(snap.overnight?.onl, 2)}` },
          { label: 'VAH~ / POC~ / VAL~', value: `${fmtNum(snap.value_area?.vah, 2)} / ${fmtNum(snap.value_area?.poc, 2)} / ${fmtNum(snap.value_area?.val, 2)}` },
          { label: 'Bias total', value: snap.bias_total ?? '—' },
          { label: 'Bias label', value: snap.bias_label ?? '—' },
        ]} />
      </Card>

      <Card title="Intermarket">
        <KeyValue items={[
          { label: 'DXY Δ%',     value: inter.dxy_pct   != null ? `${inter.dxy_pct}%`   : '—' },
          { label: '10Y Δ%',     value: inter.ten_year_pct != null ? `${inter.ten_year_pct}%` : '—' },
          { label: 'ES Δ%',      value: inter.es_pct    != null ? `${inter.es_pct}%`    : '—' },
          { label: 'VIX',        value: fmtNum(inter.vix, 2) },
          { label: 'VIX raw',    value: inter.vix_raw   ?? '—' },
        ]} />
      </Card>

      <Card title={`Key levels (${Array.isArray(raw.key_levels) ? raw.key_levels.length : 0})`}>
        {Array.isArray(raw.key_levels) && raw.key_levels.length > 0 ? (
          <div className="max-h-72 overflow-auto text-xs">
            <table className="w-full font-mono">
              <thead className="text-muted"><tr><th className="text-left pr-4 py-1">Label</th><th className="text-left pr-4 py-1">Type</th><th className="text-right">Price</th></tr></thead>
              <tbody>
                {raw.key_levels.map((k: any, i: number) => (
                  <tr key={i} className="border-t border-border/50">
                    <td className="py-1 pr-4">{k.label}</td>
                    <td className="py-1 pr-4 text-muted">{k.type}</td>
                    <td className="py-1 text-right">{fmtNum(k.price, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="text-sm text-muted">No key levels recorded.</div>}
      </Card>

      <Card title="Narrative report">
        {r.narrative_report
          ? <pre className="whitespace-pre-wrap text-sm leading-relaxed">{r.narrative_report}</pre>
          : <div className="text-sm text-muted">No narrative text embedded.</div>}
      </Card>

      <Card title="Metadata / versions">
        <KeyValue items={[
          { label: 'Symbol',            value: r.symbol ?? '—' },
          { label: 'Model version',     value: r.model_version ?? '—' },
          { label: 'Indicator version', value: r.indicator_version ?? '—' },
          { label: 'Prompt version',    value: r.prompt_version ?? '—' },
          { label: 'Calendar',          value: `${r.calendar_source ?? '—'}${r.early_close ? ' · early close' : ''}` },
          { label: 'Data quality',      value: `${r.data_quality_complete ?? '—'}${r.data_quality_fallback ? ' · fallback' : ''}` },
          { label: 'Key levels',        value: r.key_level_count ?? '—' },
          { label: 'Source file',       value: <code className="break-all text-[11px]">{r.source_path}</code> },
        ]} />
      </Card>
    </div>
  );
}
