/**
 * Zero-dependency SVG sparkline. For small inline trend charts.
 */
export default function Sparkline({
  values,
  width = 160,
  height = 40,
  strokeColor = 'currentColor',
  fillColor = 'none',
  showDots = false,
}: {
  values: Array<number | null | undefined>;
  width?: number;
  height?: number;
  strokeColor?: string;
  fillColor?: string;
  showDots?: boolean;
}) {
  const valid = values.map((v, i) => ({ v: typeof v === 'number' && !Number.isNaN(v) ? v : null, i }));
  const numeric = valid.filter(p => p.v != null) as Array<{ v: number; i: number }>;
  if (numeric.length < 2) {
    return <div className="text-[10px] text-muted">— insufficient data —</div>;
  }
  const vs = numeric.map(p => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const range = max - min || 1;
  const padX = 2;
  const padY = 2;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const n = valid.length;

  const coords = valid.map((p, i) => {
    if (p.v == null) return null;
    const x = padX + (i / Math.max(1, n - 1)) * innerW;
    const y = padY + innerH - ((p.v - min) / range) * innerH;
    return { x, y };
  });

  const path = coords
    .filter(Boolean)
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c!.x.toFixed(2)} ${c!.y.toFixed(2)}`)
    .join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={path} fill={fillColor} stroke={strokeColor} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {showDots && coords.map((c, i) => c ? <circle key={i} cx={c.x} cy={c.y} r="1.5" fill={strokeColor} /> : null)}
    </svg>
  );
}
