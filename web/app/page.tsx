/**
 * Today dashboard.
 * Rules-engine bias is PRODUCTION; every ML card is labeled shadow-only.
 * Structured-data-first: rich cards render even when narrative_report is empty
 * (the common case on cron-only runs — narrative is only filled when Claude
 * calls run_premarket_report with a `narrative` arg during a conversation).
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
import { biasComponentEntries, buildInvalidation, nearestKeyLevels } from '../lib/bias-explainer';

export const dynamic = 'force-dynamic';

function signTone(v: number): 'bullish' | 'bearish' | 'neutral' {
  if (v > 0) return 'bullish';
  if (v < 0) return 'bearish';
  return 'neutral';
}

function pctTone(v: number | null | undefined, invert = false): 'bullish' | 'bearish' | 'neutral' {
  if (v == null) return 'neutral';
  const s = v > 0 ? 'bullish' : v < 0 ? 'bearish' : 'neutral';
  if (!invert || s === 'neutral') return s;
  return s === 'bullish' ? 'bearish' : 'bullish';
}

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

  const raw       = parseJsonField<any>(pm.raw_json) ?? {};
  const snapshot  = raw.indicator_snapshot ?? {};
  const intermkt  = raw.intermarket ?? snapshot.intermarket ?? {};
  const keyLevels = Array.isArray(raw.key_levels) ? raw.key_levels : [];

  const headline = dash?.headline ?? {};
  const biasShadow  = shadow.find(s => s.task === 'bias_direction');
  const rangeShadow = shadow.find(s => s.task === 'actual_range_points');

  const bcEntries  = biasComponentEntries(snapshot.bias_components);
  const biasTotal  = snapshot.bias_total ?? null;
  const invalid    = buildInvalidation(pm.bias, snapshot, raw.expected_range, raw.calendar, raw.data_quality);
  const nearest    = nearestKeyLevels(keyLevels, snapshot.prior_day?.pdc, 10);

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Today · {pm.trading_date}</h1>
          <div className="mt-1 text-xs text-muted">
            Last synced {relativeAge(lastSync)} · indicator {pm.indicator_version ?? '—'} · prompt {pm.prompt_version ?? '—'}
          </div>
        </div>
        <div className="flex gap-2"><ProductionBadge /><ShadowBadge /></div>
      </header>

      {/* ── Headline production bias ──────────────────────────── */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Official Bias (Rules)" value={<BiasBadge bias={pm.bias} />} sub={`confidence ${pm.confidence ?? '—'}`} />
        <StatCard label="Day Type" value={pm.day_type ?? '—'} sub={pm.day_type_source ? `source: ${pm.day_type_source}` : undefined} />
        <StatCard label="Expected Range" value={<>{fmtInt(pm.expected_range_points)} <span className="text-xs text-muted">pts</span></>} sub={pm.expected_range_source ? `source: ${pm.expected_range_source}` : undefined} />
        <StatCard label="Volatility Regime" value={pm.volatility_regime ?? '—'} sub={snapshot.regime_detail ?? undefined} />
      </section>

      {/* ── Rolling performance strip ─────────────────────────── */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Latest Grade" value={<GradeBadge grade={pc?.overall_grade} />} sub={pc ? `score ${pc.score_0_to_100}/100` : 'no post-close yet'} />
        <StatCard label="Bias Hit Rate" value={headline.bias_hit_rate != null ? `${Math.round(headline.bias_hit_rate * 100)}%` : '—'} sub={`n=${headline.total_days_graded ?? 0}`} />
        <StatCard label="Current Streak" value={headline.current_streak ?? 0} sub={`longest win ${headline.longest_win_streak ?? 0}, loss ${headline.longest_loss_streak ?? 0}`} />
        <StatCard label="Avg Score" value={headline.average_score ?? '—'} sub={headline.range_within_tolerance_rate != null ? `range-in-tol ${Math.round(headline.range_within_tolerance_rate*100)}%` : undefined} />
      </section>

      {/* ── Narrative + Indicator Summary side-by-side ────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Premarket narrative"
          subtitle="Rules-engine output"
          actions={<Link href="/premarket" className="text-xs text-accent hover:underline">Open full report →</Link>}
        >
          {pm.narrative_report && pm.narrative_report.trim().length > 0 ? (
            <pre className="whitespace-pre-wrap text-sm leading-relaxed text-text">{pm.narrative_report}</pre>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="text-muted">
                No prose narrative attached to this run. Narratives are written when Claude calls
                {' '}<code className="font-mono text-xs">run_premarket_report</code>{' '}
                with a <code className="font-mono text-xs">narrative</code> argument. Scheduler-only runs
                leave this field empty by design.
              </div>
              <div className="text-xs text-muted">
                The structured-data cards below (Why This Bias · Invalidation · Intermarket · Indicator Summary ·
                Key Levels) show the same reasoning as pure rules-engine output.
              </div>
            </div>
          )}
        </Card>

        {/* Indicator Summary */}
        <Card title="Indicator Summary" subtitle="Rules-engine snapshot">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">EMA 20</dt><dd className="font-mono">{fmtNum(snapshot.ema?.ema20, 2)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">EMA 50</dt><dd className="font-mono">{fmtNum(snapshot.ema?.ema50, 2)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">EMA 200</dt><dd className="font-mono">{fmtNum(snapshot.ema?.ema200, 2)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">EMA stack</dt><dd className="font-mono text-xs">{snapshot.ema?.stack ?? '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">RSI(14)</dt><dd className="font-mono">{fmtNum(snapshot.rsi, 2)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">MACD hist</dt><dd className="font-mono">{fmtNum(snapshot.macd_hist, 2)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">ADX(14)</dt><dd className="font-mono">{fmtNum(snapshot.adx, 2)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Regime</dt><dd className="font-mono text-xs">{snapshot.regime ?? '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">ATR detail</dt><dd className="font-mono text-xs">{snapshot.regime_detail ?? '—'}</dd></div>
          </dl>
        </Card>
      </div>

      {/* ── Why This Bias (9 components) ──────────────────────── */}
      <Card
        title="Why this bias"
        subtitle={biasTotal != null ? `bias_total = ${biasTotal >= 0 ? '+' : ''}${biasTotal} · label: ${snapshot.bias_label ?? '—'}` : 'no bias components'}
        actions={<Badge tone={biasTotal != null && biasTotal > 0 ? 'bullish' : biasTotal != null && biasTotal < 0 ? 'bearish' : 'neutral'}>{biasTotal != null ? `${biasTotal >= 0 ? '+' : ''}${biasTotal}` : '—'}</Badge>}
      >
        {bcEntries.length === 0 ? (
          <div className="text-sm text-muted">No bias-component breakdown available in this report.</div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {bcEntries.map(e => (
              <div key={e.key} className="flex items-center justify-between rounded border border-border/60 bg-surface2 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{e.label}</div>
                  <div className="truncate text-[11px] text-muted">{e.detail}</div>
                </div>
                <Badge tone={signTone(e.value)}>{e.value >= 0 ? `+${e.value}` : e.value}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Invalidation / Watchouts ──────────────────────────── */}
      <Card title="Invalidation · Watchouts" subtitle="Rules-engine structural levels">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Targets / stops */}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Targets & invalidation</div>
            {invalid.primaryTarget && (
              <div className="flex items-center justify-between rounded border border-bullish/30 bg-bullish/5 px-3 py-2 text-sm">
                <span>Primary target · {invalid.primaryTarget.label}</span>
                <span className="font-mono text-bullish">{fmtNum(invalid.primaryTarget.price, 2)}</span>
              </div>
            )}
            {invalid.secondaryTarget && (
              <div className="flex items-center justify-between rounded border border-bullish/20 bg-bullish/5 px-3 py-2 text-sm">
                <span className="text-muted">Secondary target · {invalid.secondaryTarget.label}</span>
                <span className="font-mono text-bullish">{fmtNum(invalid.secondaryTarget.price, 2)}</span>
              </div>
            )}
            {invalid.primaryInvalidation && (
              <div className="flex items-center justify-between rounded border border-bearish/30 bg-bearish/5 px-3 py-2 text-sm">
                <span>Primary invalidation · {invalid.primaryInvalidation.label}</span>
                <span className="font-mono text-bearish">{fmtNum(invalid.primaryInvalidation.price, 2)}</span>
              </div>
            )}
            {invalid.secondaryInvalidation && (
              <div className="flex items-center justify-between rounded border border-bearish/20 bg-bearish/5 px-3 py-2 text-sm">
                <span className="text-muted">Secondary invalidation · {invalid.secondaryInvalidation.label}</span>
                <span className="font-mono text-bearish">{fmtNum(invalid.secondaryInvalidation.price, 2)}</span>
              </div>
            )}
            {invalid.expectedLow != null && invalid.expectedHigh != null && (
              <div className="flex items-center justify-between rounded border border-accent/20 bg-accent/5 px-3 py-2 text-sm">
                <span className="text-muted">Expected range band</span>
                <span className="font-mono">{fmtNum(invalid.expectedLow, 2)} — {fmtNum(invalid.expectedHigh, 2)}</span>
              </div>
            )}
          </div>

          {/* Watchouts */}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Watchouts</div>
            {invalid.watchouts.length === 0 ? (
              <div className="rounded border border-border bg-surface2 px-3 py-2 text-sm text-muted">No structural warnings flagged.</div>
            ) : (
              <ul className="space-y-2">
                {invalid.watchouts.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 rounded border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
                    <span className="text-warning">●</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      {/* ── Intermarket Snapshot ──────────────────────────────── */}
      <Card title="Intermarket snapshot" subtitle="Rules-engine cross-asset read">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="DXY"
            value={intermkt.dxy_pct != null ? `${intermkt.dxy_pct}%` : '—'}
            sub="NQ is typically inverse"
            tone={pctTone(intermkt.dxy_pct, true)}
          />
          <StatCard
            label="10Y yield"
            value={intermkt.ten_year_pct != null ? `${intermkt.ten_year_pct}%` : '—'}
            sub="Rising yields = risk-off"
            tone={pctTone(intermkt.ten_year_pct, true)}
          />
          <StatCard
            label="ES Δ"
            value={intermkt.es_pct != null ? `${intermkt.es_pct}%` : '—'}
            sub="Leading index tape"
            tone={pctTone(intermkt.es_pct)}
          />
          <StatCard
            label="VIX"
            value={fmtNum(intermkt.vix, 2)}
            sub={intermkt.vix_raw ?? (intermkt.vix != null ? 'volatility index' : undefined)}
            tone={intermkt.vix != null ? (intermkt.vix > 20 ? 'warning' : 'default') : 'default'}
          />
        </div>
      </Card>

      {/* ── Key Levels (compact) ──────────────────────────────── */}
      <Card
        title="Key levels"
        subtitle={nearest.length > 0 ? `${nearest.length} nearest to PDC (${fmtNum(snapshot.prior_day?.pdc, 2)})` : 'no key levels available'}
        actions={<Link href="/premarket" className="text-xs text-accent hover:underline">See all {keyLevels.length} →</Link>}
      >
        {nearest.length === 0 ? (
          <div className="text-sm text-muted">No key levels recorded in this report.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="text-muted">
                <tr className="text-left">
                  <th className="pb-2 pr-4">Label</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4 text-right">Price</th>
                  <th className="pb-2 text-right">Δ from PDC</th>
                </tr>
              </thead>
              <tbody>
                {nearest.map((k: any, i: number) => {
                  const pdc = snapshot.prior_day?.pdc;
                  const delta = (typeof pdc === 'number' && typeof k.price === 'number') ? k.price - pdc : null;
                  return (
                    <tr key={i} className="border-t border-border/50">
                      <td className="py-1.5 pr-4">{k.label}</td>
                      <td className="py-1.5 pr-4 text-muted">{k.type ?? '—'}</td>
                      <td className="py-1.5 pr-4 text-right">{fmtNum(k.price, 2)}</td>
                      <td className={`py-1.5 text-right ${delta != null ? (delta > 0 ? 'text-bullish' : delta < 0 ? 'text-bearish' : 'text-muted') : 'text-muted'}`}>
                        {delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Shadow ML summary ─────────────────────────────────── */}
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

      {/* ── Post-close last grade ─────────────────────────────── */}
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
