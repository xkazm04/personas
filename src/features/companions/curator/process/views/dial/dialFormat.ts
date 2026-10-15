/** Numbers and clocks for the Dial. Pure; the words around them come from i18n. */
const NUM = new Intl.NumberFormat();

export const fmtInt = (n: number) => NUM.format(Math.round(n));

/** 8s, 7m 57s, 1h 5m, 2d 3h. Units are the app's own short symbols. */
export function fmtDur(seconds: number): string {
  if (!Number.isFinite(seconds)) return '-';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

export const fmtDate = (iso: string, lang?: string) =>
  new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso));

export const fmtDateTime = (iso: string, lang?: string) =>
  new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(new Date(iso));

export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = {
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
};
