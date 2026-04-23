import { ReactNode } from 'react';

export default function Card({
  title, subtitle, actions, children, className = '',
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-border bg-surface ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            {title && <div className="text-sm font-semibold text-text">{title}</div>}
            {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StatCard({
  label, value, sub, tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'bullish' | 'bearish' | 'neutral' | 'warning';
}) {
  const toneCls = {
    default: 'text-text',
    bullish: 'text-bullish',
    bearish: 'text-bearish',
    neutral: 'text-neutral',
    warning: 'text-warning',
  }[tone];
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-semibold ${toneCls}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}
