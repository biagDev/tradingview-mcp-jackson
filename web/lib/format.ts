/**
 * Formatting helpers for dates, numbers, and display strings.
 */

export function fmtDate(d?: string | null): string {
  if (!d) return '—';
  return d;
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }) + ' ET';
  } catch { return iso; }
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return Math.round(v).toLocaleString('en-US');
}

export function fmtBool(v: number | boolean | null | undefined): string {
  if (v == null) return '—';
  return (v === 1 || v === true) ? 'yes' : 'no';
}

export function parseJsonField<T = unknown>(s: string | null | undefined): T | null {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

export function prettyCoverage(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(0)}% coverage`;
}

export function relativeAge(iso?: string | null): string {
  if (!iso) return '—';
  try {
    const delta = Date.now() - new Date(iso).getTime();
    const m = Math.floor(delta / 60000);
    if (m < 1)   return 'just now';
    if (m < 60)  return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h} h ago`;
    const d = Math.floor(h / 24);
    return `${d} d ago`;
  } catch { return iso; }
}
