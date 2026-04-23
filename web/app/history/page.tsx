import Link from 'next/link';
import { listReports, listPostcloses } from '../../lib/queries';
import Card from '../../components/Card';
import Badge, { BiasBadge, GradeBadge } from '../../components/Badge';
import EmptyState from '../../components/EmptyState';
import { fmtInt } from '../../lib/format';

export const dynamic = 'force-dynamic';

export default function HistoryPage() {
  const reports = listReports({ limit: 500 });
  if (reports.length === 0) return <EmptyState title="No reports in history yet." hint="npm run db:sync" />;

  const pcs = listPostcloses({ limit: 500 });
  const pcByDate = new Map(pcs.map(p => [p.trading_date, p]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">History</h1>
        <div className="mt-1 text-xs text-muted">{reports.length} report{reports.length === 1 ? '' : 's'}</div>
      </header>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted">
              <tr className="text-left">
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Bias</th>
                <th className="pb-2 pr-4">Day Type</th>
                <th className="pb-2 pr-4">Regime</th>
                <th className="pb-2 pr-4">Exp. Range</th>
                <th className="pb-2 pr-4">Actual Range</th>
                <th className="pb-2 pr-4">Grade</th>
                <th className="pb-2 pr-4">Score</th>
                <th className="pb-2 pr-4">Versions</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {reports.map(r => {
                const pc = pcByDate.get(r.trading_date);
                return (
                  <tr key={r.trading_date} className="border-t border-border">
                    <td className="py-2 pr-4 font-mono">{r.trading_date}</td>
                    <td className="py-2 pr-4"><BiasBadge bias={r.bias} /></td>
                    <td className="py-2 pr-4 font-mono">{r.day_type ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono">{r.volatility_regime ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono">{fmtInt(r.expected_range_points)} pts</td>
                    <td className="py-2 pr-4 font-mono">{pc ? `${fmtInt(pc.actual_range_points)} pts` : '—'}</td>
                    <td className="py-2 pr-4"><GradeBadge grade={pc?.overall_grade} /></td>
                    <td className="py-2 pr-4 font-mono">{pc?.score_0_to_100 ?? '—'}</td>
                    <td className="py-2 pr-4 text-[11px] text-muted">{r.indicator_version ?? '—'} · {r.prompt_version ?? '—'}</td>
                    <td className="py-2">
                      <Link href={`/history/${r.trading_date}`} className="text-accent hover:underline text-xs">detail →</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
