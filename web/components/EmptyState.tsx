export default function EmptyState({
  title = 'No data yet',
  message,
  hint,
}: {
  title?: string;
  message?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface/50 px-6 py-10 text-center">
      <div className="text-sm font-semibold text-text">{title}</div>
      {message && <div className="mt-1 text-sm text-muted">{message}</div>}
      {hint && <div className="mt-3 text-xs text-muted font-mono">{hint}</div>}
    </div>
  );
}
