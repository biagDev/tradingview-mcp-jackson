import { ReactNode } from 'react';

const TONES = {
  default:  'bg-surface2 text-text border-border',
  bullish:  'bg-bullish/10 text-bullish border-bullish/30',
  bearish:  'bg-bearish/10 text-bearish border-bearish/30',
  neutral:  'bg-neutral/10 text-muted border-neutral/30',
  warning:  'bg-warning/10 text-warning border-warning/40',
  accent:   'bg-accent/10 text-accent border-accent/40',
  production: 'bg-bullish/10 text-bullish border-bullish/40',
  shadow:     'bg-warning/10 text-warning border-warning/40',
} as const;

export type BadgeTone = keyof typeof TONES;

export default function Badge({
  children, tone = 'default', className = '',
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function ProductionBadge() {
  return <Badge tone="production">Rules Engine · Production</Badge>;
}

export function ShadowBadge() {
  return <Badge tone="shadow">ML · Shadow Only</Badge>;
}

export function BiasBadge({ bias }: { bias: string | null | undefined }) {
  if (!bias) return <Badge tone="neutral">—</Badge>;
  const tone: BadgeTone = bias === 'bullish' ? 'bullish' : bias === 'bearish' ? 'bearish' : 'neutral';
  return <Badge tone={tone}>{bias}</Badge>;
}

export function GradeBadge({ grade }: { grade: string | null | undefined }) {
  if (!grade) return <Badge tone="neutral">—</Badge>;
  const tone: BadgeTone =
    grade === 'A' ? 'bullish'
    : grade === 'B' ? 'accent'
    : grade === 'C' ? 'default'
    : grade === 'D' ? 'warning'
    : grade === 'F' ? 'bearish'
    : 'neutral';
  return <Badge tone={tone}>{`Grade ${grade}`}</Badge>;
}
