// UsageStrip — the thin row above the project columns that says how much of
// the Claude subscription this fleet has burned.
//
// A monthly plan is metered on rolling windows, not a balance: a 5-hour
// session window and a 7-day window (reported per model family on some
// accounts). Each one is a meter here — utilisation, the reset countdown,
// and a pace verdict against the clock — because "42% with 2h 14m left,
// on pace" is the whole decision an operator makes before dispatching more
// work, and it used to live in a terminal tool beside the app.
//
// Sourced from Anthropic's OAuth usage endpoint through `fleet_claude_usage`
// (see the Rust module for the trust boundary). An account with no Claude
// Code login renders one calm chip that says so and why; it never fakes a
// meter. Loading paints the chrome with static ghost meters under it — the
// row's height is fixed, so nothing below it moves when the numbers land.
//
// Meter colour is the reserved status ramp and only ever means state: the
// fill is the brand tone until 75%, warning to 90%, error above — and every
// non-ok state carries an icon and a label, never colour alone.

import { memo, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Gauge, ShieldOff } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';
import type { ClaudeUsageWindow } from '@/lib/bindings/ClaudeUsageWindow';
import type { Translations } from '@/i18n/generated/types';
import { useClaudeUsage } from './useClaudeUsage';
import {
  formatCountdown, meterTone, orderWindows, pace, planKey, windowProgress,
  type MeterTone, type Pace, type PlanKey,
} from './usageModel';

/** The countdown ticks locally between polls; a minute is its resolution. */
const TICK_MS = 30_000;

const FILL: Record<MeterTone, string> = {
  ok: 'bg-primary',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
};
const TONE_TEXT: Record<MeterTone, string> = {
  ok: 'text-foreground',
  warning: 'text-status-warning',
  error: 'text-status-error',
};

function windowLabel(t: Translations, key: string): { label: string; hint: string } {
  switch (key) {
    case 'five_hour': return { label: t.monitor.usage_window_five_hour, hint: t.monitor.usage_window_five_hour_hint };
    case 'seven_day': return { label: t.monitor.usage_window_seven_day, hint: t.monitor.usage_window_seven_day_hint };
    case 'seven_day_opus': return { label: t.monitor.usage_window_seven_day_opus, hint: t.monitor.usage_window_seven_day_opus_hint };
    case 'seven_day_sonnet': return { label: t.monitor.usage_window_seven_day_sonnet, hint: t.monitor.usage_window_seven_day_sonnet_hint };
    default: return { label: key, hint: key };
  }
}

function planLabel(t: Translations, key: PlanKey): string {
  switch (key) {
    case 'pro': return t.monitor.usage_plan_pro;
    case 'max': return t.monitor.usage_plan_max;
    case 'max_5x': return t.monitor.usage_plan_max_5x;
    case 'max_20x': return t.monitor.usage_plan_max_20x;
    case 'team': return t.monitor.usage_plan_team;
    case 'enterprise': return t.monitor.usage_plan_enterprise;
  }
}

function paceLabel(t: Translations, p: Pace): string {
  switch (p) {
    case 'fast': return t.monitor.usage_pace_fast;
    case 'steady': return t.monitor.usage_pace_steady;
    case 'slow': return t.monitor.usage_pace_slow;
  }
}

function reasonLabel(t: Translations, reason: string | null): string {
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

function Meter({ w, now }: { w: ClaudeUsageWindow; now: number }) {
  const { t, tx } = useTranslation();
  const { label, hint } = windowLabel(t, w.key);
  const tone = meterTone(w.utilizationPct);
  const { remainingMs } = windowProgress(w, now);
  const p = pace(w, now);
  const units = {
    day: t.monitor.usage_unit_day,
    hour: t.monitor.usage_unit_hour,
    minute: t.monitor.usage_unit_minute,
    underMinute: t.monitor.usage_under_minute,
  };
  const resets = remainingMs === null
    ? t.monitor.usage_resets_unknown
    : tx(t.monitor.usage_resets_in, { time: formatCountdown(remainingMs, units) });
  const pct = Math.round(w.utilizationPct);
  const toneLabel = tone === 'error' ? t.monitor.usage_tone_error : t.monitor.usage_tone_warning;
  const tip = [hint, p ? `${paceLabel(t, p)} — ${t.monitor.usage_pace_hint}` : null].filter(Boolean).join('\n');

  return (
    <Tooltip content={tip}>
      <span
        className="inline-flex flex-shrink-0 items-center gap-1.5"
        data-testid="fleet-usage-window"
        data-window={w.key}
        data-tone={tone}
        aria-label={`${label} ${pct}% · ${resets}${p ? ` · ${paceLabel(t, p)}` : ''}`}
      >
        <span className="typo-caption text-foreground opacity-70">{label}</span>
        <span aria-hidden className="relative h-1.5 w-16 overflow-hidden rounded-full bg-foreground/10">
          <span
            className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${FILL[tone]}`}
            style={{ width: `${pct}%` }}
          />
        </span>
        <span className="typo-caption tabular-nums text-foreground">{pct}%</span>
        {tone !== 'ok' && (
          <span className={`inline-flex items-center gap-0.5 typo-caption ${TONE_TEXT[tone]}`}>
            <AlertTriangle className="h-3 w-3" aria-hidden />
            {toneLabel}
          </span>
        )}
        <span className="typo-caption text-foreground opacity-60">· {resets}</span>
        {p && <span className="typo-caption text-foreground opacity-60">· {paceLabel(t, p)}</span>}
      </span>
    </Tooltip>
  );
}

/** Two static meter silhouettes, for the first read of the session. */
function GhostMeters() {
  const bar = 'rounded bg-primary/[0.06]';
  return (
    <span aria-hidden className="inline-flex items-center gap-3 animate-fade-in" style={{ animationDelay: '150ms' }}>
      {[0, 1].map((i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span className={`h-[0.7em] w-5 ${bar} typo-caption`} />
          <span className="h-1.5 w-16 rounded-full bg-foreground/10" />
          <span className={`h-[0.7em] w-8 ${bar} typo-caption`} />
        </span>
      ))}
    </span>
  );
}

export const UsageStrip = memo(function UsageStrip({ enabled = true }: { enabled?: boolean }) {
  const { t } = useTranslation();
  const { snapshot, ipcFailed, lastRefreshed } = useClaudeUsage(enabled);
  const visible = useDocumentVisibility();

  // The countdown needs a clock. Ticks only while the window is visible, and
  // re-stamps on re-show so a minute away does not leave a minute-stale read.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [visible]);

  const windows = useMemo(() => (snapshot?.available ? orderWindows(snapshot.windows) : []), [snapshot]);
  const plan = snapshot ? planKey(snapshot.subscriptionType, snapshot.rateLimitTier) : null;
  const asOf = snapshot?.fetchedAtMs ?? lastRefreshed;

  let body: React.ReactNode;
  if (!snapshot && !ipcFailed) {
    body = (
      <>
        <GhostMeters />
        <span className="sr-only" role="status">{t.monitor.usage_loading}</span>
      </>
    );
  } else if (!snapshot || !snapshot.available) {
    const reason = reasonLabel(t, snapshot ? snapshot.reason : 'ipc');
    body = (
      <Tooltip content={reason}>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/20 px-2 py-0.5 typo-caption text-foreground"
          data-testid="fleet-usage-unavailable"
          aria-label={`${t.monitor.usage_unavailable}: ${reason}`}
        >
          <ShieldOff className="h-3 w-3 opacity-70" aria-hidden />
          {t.monitor.usage_unavailable}
        </span>
      </Tooltip>
    );
  } else {
    body = windows.map((w) => <Meter key={w.key} w={w} now={now} />);
  }

  return (
    <div
      role="group"
      aria-label={t.monitor.usage_aria}
      data-testid="fleet-usage-strip"
      className="flex h-8 flex-shrink-0 items-center gap-3 overflow-x-auto border-b border-border bg-foreground/[0.01] px-3"
    >
      <span className="inline-flex flex-shrink-0 items-center gap-1.5 typo-caption uppercase tracking-wider text-foreground opacity-70">
        <Gauge className="h-3 w-3" aria-hidden />
        {t.monitor.usage_title}
      </span>
      {plan && (
        <span
          className="flex-shrink-0 rounded-full border border-border bg-secondary/20 px-2 py-0.5 typo-caption text-foreground"
          data-testid="fleet-usage-plan"
        >
          {planLabel(t, plan)}
        </span>
      )}
      {body}
      {asOf !== null && (
        <span className="ml-auto inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap typo-caption text-foreground opacity-50">
          {t.monitor.usage_as_of} <RelativeTime timestamp={asOf} />
        </span>
      )}
    </div>
  );
});

export default UsageStrip;
