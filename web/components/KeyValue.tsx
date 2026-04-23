import { ReactNode } from 'react';

export default function KeyValue({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {items.map(i => (
        <div key={i.label} className="flex items-center justify-between border-b border-border/60 py-1.5">
          <dt className="text-muted">{i.label}</dt>
          <dd className="font-mono text-text">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
