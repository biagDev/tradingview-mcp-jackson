import Link from 'next/link';

const NAV = [
  { href: '/',          label: 'Today' },
  { href: '/premarket', label: 'Premarket' },
  { href: '/postclose', label: 'Post-close' },
  { href: '/history',   label: 'History' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/misses',    label: 'Recent Misses' },
  { href: '/models',    label: 'Models' },
  { href: '/shadow',    label: 'Shadow ML' },
  { href: '/system',    label: 'System' },
];

export default function Sidebar() {
  return (
    <aside className="w-60 shrink-0 border-r border-border bg-surface px-5 py-6">
      <div className="mb-1 text-sm font-semibold tracking-wide text-text">NQ Daily Bias</div>
      <div className="mb-6 text-xs text-muted">Local MVP · v0.1</div>
      <nav className="space-y-1 text-sm">
        {NAV.map(n => (
          <Link
            key={n.href}
            href={n.href}
            className="block rounded px-3 py-2 text-text/80 hover:bg-surface2 hover:text-text transition-colors"
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="mt-8 rounded border border-border bg-surface2 p-3 text-[10px] leading-snug text-muted">
        <div className="mb-1 font-semibold text-text">Production / Shadow</div>
        <div><span className="text-bullish">●</span> Rules engine = official</div>
        <div><span className="text-warning">●</span> ML = shadow only</div>
      </div>
    </aside>
  );
}
