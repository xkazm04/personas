/**
 * formatRelativeTime — shared relative-time label for inbox renderers.
 *
 * Buckets:
 *   - nullish / non-string input  → "—"
 *   - unparseable string          → raw string (so users see the bad value
 *                                   instead of "NaNm ago")
 *   - future-dated (clock skew)   → "just now"
 *   - < 1 minute                  → "just now"
 *   - < 1 hour                    → "{m}m ago"
 *   - < 24 hours                  → "{h}h ago"
 *   - otherwise                   → "{d}d ago"
 *
 * `t` is optional. When provided, labels come from the active locale via
 * `t.cockpit.inbox.relative_*`. When omitted, falls back to English literals
 * — keeps the helper usable from pure utilities without plumbing a
 * translation bundle through.
 *
 * `now` is injectable for deterministic unit tests.
 */
import type { Translations } from '@/i18n/generated/types';

function interpolate(template: string, vars: Record<string, number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

export function formatRelativeTime(
  iso: string | null | undefined,
  t?: Translations,
  now: number = Date.now(),
): string {
  if (!iso) return '—';
  if (typeof iso !== 'string') return '—';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const delta = now - ts;
  const r = t?.cockpit?.inbox;

  if (delta < 60_000) {
    return r?.relative_just_now ?? 'just now';
  }
  const min = Math.floor(delta / 60_000);
  if (min < 60) {
    const tmpl = min === 1 ? r?.relative_minutes_one : r?.relative_minutes_other;
    return tmpl ? interpolate(tmpl, { m: min }) : `${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    const tmpl = hr === 1 ? r?.relative_hours_one : r?.relative_hours_other;
    return tmpl ? interpolate(tmpl, { h: hr }) : `${hr}h ago`;
  }
  const d = Math.floor(hr / 24);
  const tmpl = d === 1 ? r?.relative_days_one : r?.relative_days_other;
  return tmpl ? interpolate(tmpl, { d }) : `${d}d ago`;
}
