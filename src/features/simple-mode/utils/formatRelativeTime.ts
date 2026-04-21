/**
 * formatRelativeTime — shared relative-time label for Simple-mode surfaces.
 *
 * Originally file-local to ConsoleVariant (Phase 08); extracted in Phase 09 so
 * the Inbox master list + detail header can render the same labels without
 * duplication. Phase 15-01 switched it to plural-aware i18n so translation
 * teams for languages that inflect (Czech, Russian, Arabic, …) can translate
 * the `_one` vs `_other` cases independently.
 *
 * Buckets (unchanged since Phase 08):
 *   - no timestamp / unparseable  → "—"
 *   - < 1 minute                  → "just now"
 *   - < 1 hour                    → "{m}m ago"
 *   - < 24 hours                  → "{h}h ago"
 *   - otherwise                   → "{d}d ago"
 *
 * i18n contract
 * -------------
 * The canonical keys live under `simple_mode.inbox.relative_*` with separate
 * `_one` and `_other` variants for the minute/hour/day buckets. English copy
 * is intentionally the same across both — abbreviated units don't pluralize
 * in English — but having the schema in place lets locale files diverge
 * without another migration.
 *
 * The legacy `simple_mode.console_relative_*` keys from Phase 08 are still
 * present in `en.json` for backwards compatibility but are DEPRECATED: new
 * callers should rely on the Translations-arg form below, which reads from
 * the `inbox` subsection. Do not extend the `console_relative_*` set.
 *
 * API
 * ---
 * `t` is optional. When provided (every production caller passes it), labels
 * come from the active locale. When omitted (unit tests, non-React callers,
 * or pre-i18n code paths), the helper falls back to English-only strings —
 * exactly what Phase 09 emitted before this plan. This keeps the helper
 * usable from pure utilities without plumbing a translation bundle through.
 *
 * `now` is injectable for deterministic unit tests; callers pass nothing in
 * production and default to `Date.now()`.
 */
import type { Translations } from '@/i18n/generated/types';

/** Single-brace interpolation matching `tx()`'s semantics (see useTranslation.ts).
 *  Inlined here rather than imported from `@/i18n/useTranslation` to keep this
 *  utility module free of React/store imports (it's a pure fn). The regex +
 *  behavior is intentionally identical to the exported `interpolate()`.
 */
function interpolate(template: string, vars: Record<string, number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/**
 * Format an ISO-8601 timestamp (or null) as a short relative label.
 *
 * @param iso ISO-8601 timestamp; null/undefined/unparseable renders as a
 *            stable em-dash placeholder.
 * @param t   Optional full translation bundle (from `useTranslation().t`).
 *            When provided, labels resolve via `t.simple_mode.inbox.relative_*`
 *            with `_one`/`_other` plural variants. When omitted, falls back
 *            to English literals.
 * @param now Epoch ms override for tests; defaults to `Date.now()`.
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  t?: Translations,
  now: number = Date.now(),
): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '—';
  const delta = now - ts;
  const min = Math.floor(delta / 60_000);
  const r = t?.simple_mode?.inbox;

  if (min < 1) {
    return r?.relative_just_now ?? 'just now';
  }
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
