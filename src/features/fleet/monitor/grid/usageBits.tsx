// usageBits — the small pieces the usage strip's rows share: the tone and pace
// vocabularies, the window's name and spoken sentence, the reason copy, and the
// local clock that re-derives pace and countdowns. Pure presentation; the numbers
// come from `usageModel`, joined per provider by `usage/useResourceModel`.
//
// TONE IS PAINTED TWICE, ON PURPOSE. A window's tone (ok / warning / error at
// 75 / 90) colours its PERCENT (`TONE_TEXT`), and — for the weekly window only —
// the fill of the row's bottom border (`FILL`). There is no other bar: the
// 5-hour window is a number and a pace glyph, nothing more.

import { useEffect, useState } from 'react';
import { Flame, Gauge, Snowflake } from 'lucide-react';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';
import type { CliUsageReason } from '@/lib/bindings/CliUsageReason';
import type { Translations } from '@/i18n/generated/types';
import { formatPercent } from '@/lib/utils/formatters';
import { formatCountdown, type MeterTone, type Pace } from './usageModel';
import type { ProviderId, WindowModel } from './usage/useResourceModel';

/** Pace and countdowns move with the clock; 30s is the finest they need. */
const TICK_MS = 30_000;

export const FILL: Record<MeterTone, string> = {
  ok: 'bg-primary',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
};
export const TONE_TEXT: Record<MeterTone, string> = {
  ok: 'text-foreground',
  warning: 'text-status-warning',
  error: 'text-status-error',
};

export const PACE_ICON: Record<Pace, typeof Flame> = { fast: Flame, steady: Gauge, slow: Snowflake };
export const PACE_TONE: Record<Pace, string> = {
  fast: 'text-status-warning',
  steady: 'text-foreground opacity-50',
  slow: 'text-status-info',
};

export function paceLabel(t: Translations, p: Pace): string {
  switch (p) {
    case 'fast': return t.monitor.usage_pace_fast;
    case 'steady': return t.monitor.usage_pace_steady;
    case 'slow': return t.monitor.usage_pace_slow;
  }
}

export function providerName(t: Translations, id: ProviderId): string {
  switch (id) {
    case 'claude': return t.monitor.usage_provider_claude;
    case 'codex': return t.monitor.usage_provider_codex;
    case 'grok': return t.monitor.usage_provider_grok;
  }
}

/** Why a Claude plan could not be read, in the `fleet_claude_usage` vocabulary. */
export function reasonLabel(t: Translations, reason: string | null): string {
  switch (reason) {
    case 'no_credentials': return t.monitor.usage_reason_no_credentials;
    case 'token_expired': return t.monitor.usage_reason_token_expired;
    case 'unauthorized': return t.monitor.usage_reason_unauthorized;
    case 'rate_limited': return t.monitor.usage_reason_rate_limited;
    case 'network': return t.monitor.usage_reason_network;
    case 'parse': return t.monitor.usage_reason_parse;
    case 'ipc': return t.monitor.usage_reason_ipc;
    default: return t.monitor.usage_reason_http_error;
  }
}

/** Why a read-only CLI has nothing to meter — the words that stand in the name slot. */
export function cliReasonLabel(t: Translations, reason: CliUsageReason): string {
  switch (reason) {
    case 'not_installed': return t.monitor.usage_cli_not_installed;
    case 'no_quota_source': return t.monitor.usage_cli_no_quota_source;
    case 'no_sessions': return t.monitor.usage_cli_no_sessions;
    case 'unreadable': return t.monitor.usage_cli_unreadable;
  }
}

export function cliReasonHint(t: Translations, reason: CliUsageReason): string {
  switch (reason) {
    case 'not_installed': return t.monitor.usage_cli_not_installed_hint;
    case 'no_quota_source': return t.monitor.usage_cli_no_quota_source_hint;
    case 'no_sessions': return t.monitor.usage_cli_no_sessions_hint;
    case 'unreadable': return t.monitor.usage_cli_unreadable_hint;
  }
}

const DAY_MINUTES = 24 * 60;

/** "5h" / "7d" — a window's short name, from its real length (a CLI's window is keyed `primary`, not `five_hour`). */
export function windowTitle(t: Translations, w: WindowModel): string {
  if (w.windowMinutes >= DAY_MINUTES) return `${Math.round(w.windowMinutes / DAY_MINUTES)}${t.monitor.usage_unit_day}`;
  return `${Math.max(1, Math.round(w.windowMinutes / 60))}${t.monitor.usage_unit_hour}`;
}

/**
 * The full sentence for one window: name, percent, reset countdown, pace, and
 * "Estimated" when the figure is a projection. It is the cluster's accessible
 * name AND its tooltip — the cluster itself shows only an icon, a number and a glyph.
 *
 * formatPercent, not `${Math.round(x)}%`: this string is read aloud, and the
 * hand-composed form freezes en's conventions into all 14 locales (de/fr/cs want
 * `42 %`, ar needs bidi marks).
 */
export function windowSentence(
  t: Translations, tx: (s: string, v: Record<string, string | number>) => string, w: WindowModel,
): string {
  const parts = [
    `${windowTitle(t, w)} ${formatPercent(w.usedPct, { precision: 0 })}`,
    w.remainingMs === null
      ? t.monitor.usage_resets_unknown
      : tx(t.monitor.usage_resets_in, {
        time: formatCountdown(w.remainingMs, {
          day: t.monitor.usage_unit_day,
          hour: t.monitor.usage_unit_hour,
          minute: t.monitor.usage_unit_minute,
          underMinute: t.monitor.usage_under_minute,
        }),
      }),
  ];
  if (w.pace) parts.push(paceLabel(t, w.pace));
  if (w.projected) parts.push(t.monitor.usage_projected_short);
  return parts.join(' · ');
}

/** Ticks only while the window is visible, re-stamped on re-show. */
export function useUsageClock(): number {
  const visible = useDocumentVisibility();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [visible]);
  return now;
}
