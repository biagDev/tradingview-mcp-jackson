import Link from 'next/link';
import { listRecentMisses } from '../../lib/queries';
import Card from '../../components/Card';
import Badge, { GradeBadge } from '../../components/Badge';
import EmptyState from '../../components/EmptyState';
import { fmtInt, parseJsonField } from '../../lib/format';

export const dynamic = 'force-dynamic';

export default function MissesPage() {
  const misses = listRecentMisses({ limit: 50 });
  if (misses.length === 0) return <EmptyState title="No misses recorded yet." />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Recent Misses</h1>
        <div className="mt-1 text-xs text-muted">Days where bias, day-type, or range went wrong — or grade fell to D/F/NG, or partial grade below 55.</div>
      </header>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted">
              <tr className="text-left">
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Grade</th>
                <th className="pb-2 pr-4">Score</th>
                <th className="pb-2 pr-4">Bias (called → actual)</th>
                <th className="pb-2 pr-4">Day type</th>
                <th className="pb-2 pr-4">Range</th>
                <th className="pb-2 pr-4">Tags</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {misses.map(m => {
                const tags = parseJsonField<string[]>(m.failure_tags_json) ?? [];
                return (
                  <tr key={m.trading_date} className="border-t border-border">
                    <td className="py-2 pr-4 font-mono">{m.trading_date}</td>
                    <td className="py-2 pr-4"><GradeBadge grade={m.overall_grade} /></td>
                    <td className="py-2 pr-4 font-mono">{m.score_0_to_100}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{m.bias_called} → {m.bias_actual}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{m.day_type_called} → {m.day_type_actual}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{fmtInt(m.actual_range_points)} pts · err {fmtInt(m.range_estimate_error_points)}</td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {tags.slice(0, 3).map(t => <Badge key={t} tone="warning">{t}</Badge>)}
                        {tags.length > 3 && <span className="text-[11px] text-muted">+{tags.length - 3}</span>}
                      </div>
                    </td>
                    <td className="py-2">
                      <Link href={`/history/${m.trading_date}`} className="text-accent hover:underline text-xs">detail →</Link>
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
