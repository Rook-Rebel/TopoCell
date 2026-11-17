import { Kind } from '../core/geometry/cell';

export function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 10 ** -(digits + 1) || a >= 1e7)) return v.toExponential(2);
  return v.toFixed(digits);
}

/** მნიშვნელოვანი ციფრებით ფორმატირება. */
export function sig(v: number | null | undefined, n = 3): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a < 1e-3 || a >= 1e6) return v.toExponential(n - 1);
  const d = Math.max(0, n - 1 - Math.floor(Math.log10(a)));
  return v.toFixed(Math.min(d, 8));
}

export function pct(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) < 0.5 * 10 ** -digits) return `${(0).toFixed(digits)} %`;
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)} %`;
}

export const SERIES_VAR: Record<Kind, string> = {
  plates: 'var(--series-plates)',
  rings: 'var(--series-rings)',
  mobius: 'var(--series-mobius)',
  klein: 'var(--series-klein)',
};

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function download(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi === lo) {
    hi = lo + (Math.abs(lo) || 1);
  }
  const span = hi - lo;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.ceil(lo / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export function tickLabel(v: number, step: number): string {
  const d = Math.max(0, Math.min(6, -Math.floor(Math.log10(Math.abs(step) || 1) + 1e-9)));
  const a = Math.abs(v);
  if (a >= 1e5 || (a > 0 && a < 1e-4)) return v.toExponential(1);
  return v.toFixed(d);
}
