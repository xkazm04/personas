/**
 * formatRelativeTime — shared relative-time label for Simple-mode surfaces.
 *
 * Originally file-local to ConsoleVariant (Phase 08); extracted here in
 * Phase 09 so the Inbox master list + detail header can render the same
 * labels without duplication.
 *
 * Buckets:
 *   - no timestamp / unparseable  → "—"
 *   - < 1 minute                  → "just now"
 *   - < 1 hour                    → "{m}m ago"
 *   - < 24 hours                  → "{h}h ago"
 *   - otherwise                   → "{d}d ago"
 *
 * Reads the pre-existing `console_relative_*` keys from the `simple_mode`
 * translation bundle — we intentionally do NOT duplicate these into an
 * inbox-scoped namespace. The labels are the same; only the callsite
 * changed, which is not a reason to fork i18n keys.
 *
 * `nowMs` is injectable for deterministic unit tests; callers pass nothing
 * in production and default to `Date.now()`.
 */
import type { Translations } from '@/i18n/generated/types';

/** Narrow to just the simple_mode map — keeps the signature focused. */
type SimpleModeT = Translations['simple_mode'];

/** Single-brace interpolation matching `tx()`'s semantics (see useTranslation.ts). */
function interpolate(template: string, vars: Record<string, number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/**
 * Format an ISO-8601 timestamp (or null) as a short relative label.
 *
 * @param t     The `simple_mode` translation map (from `useTranslation().t.simple_mode`).
 * @param iso   ISO-8601 timestamp; null/undefined renders as a stable em-dash placeholder.
 * @param nowMs Epoch ms override for tests; defaults to `Date.now()`.
 */
export function formatRelativeTime(
  t: SimpleModeT,
  iso: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '—';
  const delta = nowMs - ts;
  const min = Math.floor(delta / 60_000);
  if (min < 1) return t.console_relative_just_now;
  if (min < 60) return interpolate(t.console_relative_m_ago, { m: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return interpolate(t.console_relative_h_ago, { h: hr });
  const d = Math.floor(hr / 24);
  return interpolate(t.console_relative_d_ago, { d });
}
