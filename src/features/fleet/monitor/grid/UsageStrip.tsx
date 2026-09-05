// UsageStrip — the thin band above the project columns that says how much of
// the Claude subscription this fleet has burned.
//
// A monthly plan is metered on rolling windows, not a balance: a 5-hour
// session window and a 7-day window (reported per model family on some
// accounts). Each one is a ROW here — label, meter, percent, reset countdown,
// pace — stacked in one aligned grid so the two windows read as a column of
// the same instrument rather than a sentence of chips. "42% with 2h 14m left,
// running hot" is the whole decision an operator makes before dispatching
// more work, and it used to live in a terminal tool beside the app.
//
// PACE is a temperature: a flame when utilisation is ahead of the clock, a
// snowflake when it is behind, a gauge when they agree. The icon carries an
// accessible name; nothing here is a hover-only tooltip — the row is the
// whole story, so it says everything in plain view.
//
// Sourced from Anthropic's OAuth usage endpoint through `fleet_claude_usage`
// (see the Rust module for the trust boundary). An account with no Claude
// Code login renders one calm chip that says so and why; it never fakes a
// meter. Loading paints the chrome with static ghost rows under it — the
// band's height is fixed by its row count, so nothing below moves when the
// numbers land.
//
// Meter colour is the reserved status ramp and only ever means state: the
// fill is the brand tone until 75%, warning to 90%, error above — and every
// non-ok state carries an icon and a label, never colour alone.

import { memo, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Flame, Gauge, ShieldOff, Snowflake } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';
import type { ClaudeUsageWindow } from '@/lib/bindings/ClaudeUsageWindow';
import type { Translations } from '@/i18n/generated/types';
import { useClaudeUsage } from './useClaudeUsage';
import {
  formatCountdown, meterTone, orderWindows, pace, windowProgress,
  type MeterTone, type Pace,
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

/** The pace glyphs: hot / steady / cold. */
const PACE_ICON: Record<Pace, typeof Flame> = {
  fast: Flame,
  steady: Gauge,
  slow: Snowflake,
};
const PACE_TONE: Record<Pace, string> = {
  fast: 'text-status-warning',
  steady: 'text-foreground opacity-50',
  slow: 'text-status-info',
};

/** One aligned grid for every row: label · meter · percent · reset · pace. */
const ROW_GRID = 'grid grid-cols-[2.5rem_7rem_2.5rem_minmax(0,1fr)_1rem] items-center gap-x-2';

function windowLabel(t: Translations, key: string): string {
  switch (key) {
    case 'five_hour': return t.monitor.usage_window_five_hour;
    case 'seven_day': return t.monitor.usage_window_seven_day;
    case 'seven_day_opus': return t.monitor.usage_window_seven_day_opus;
    case 'seven_day_sonnet': return t.monitor.usage_window_seven_day_sonnet;
    default: return key;
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

function MeterRow({ w, now }: { w: ClaudeUsageWindow; now: number }) {
  const { t, tx } = useTranslation();
  const label = windowLabel(t, w.key);
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
  const PaceIcon = p ? PACE_ICON[p] : null;

  return (
    <div
      className={`${ROW_GRID} h-4`}
      data-testid="fleet-usage-window"
      data-window={w.key}
      data-tone={tone}
      data-pace={p ?? 'none'}
      aria-label={`${label} ${pct}% · ${resets}${p ? ` · ${paceLabel(t, p)}` : ''}`}
    >
      <span className="typo-caption text-foreground opacity-70 tabular-nums">{label}</span>
      <span aria-hidden className="relative h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
        <span
          className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${FILL[tone]}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="typo-caption tabular-nums text-foreground text-right">{pct}%</span>
      <span className="flex min-w-0 items-center gap-1.5 typo-caption text-foreground opacity-60">
        <span className="truncate">{resets}</span>
        {tone !== 'ok' && (
          <span className={`inline-flex flex-shrink-0 items-center gap-0.5 opacity-100 ${TONE_TEXT[tone]}`}>
            <AlertTriangle className="h-3 w-3" aria-hidden />
            {toneLabel}
          </span>
        )}
      </span>
      {/* The temperature. Icon-only in the row; the name rides in the row's
          aria-label above and here for screen readers. */}
      {p && PaceIcon ? (
        <span className={`inline-flex items-center justify-center ${PACE_TONE[p]}`}>
          <PaceIcon className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">{paceLabel(t, p)}</span>
        </span>
      ) : <span />}
    </div>
  );
}

/** Two static row silhouettes, for the first read of the session. */
function GhostRows() {
  const bar = 'rounded bg-primary/[0.06]';
  return (
    <div aria-hidden className="flex flex-col gap-1 animate-fade-in" style={{ animationDelay: '150ms' }}>
      {[0, 1].map((i) => (
        <div key={i} className={`${ROW_GRID} h-4`}>
          <span className={`h-[0.7em] w-5 ${bar} typo-caption`} />
          <span className="h-1.5 w-full rounded-full bg-foreground/10" />
          <span className={`h-[0.7em] w-full ${bar} typo-caption`} />
          <span className={`h-[0.7em] w-24 ${bar} typo-caption`} />
          <span />
        </div>
      ))}
    </div>
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
  const asOf = snapshot?.fetchedAtMs ?? lastRefreshed;

  let body: React.ReactNode;
  if (!snapshot && !ipcFailed) {
    body = (
      <>
        <GhostRows />
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
    body = (
      <div className="flex min-w-0 flex-col gap-1">
        {windows.map((w) => <MeterRow key={w.key} w={w} now={now} />)}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={t.monitor.usage_aria}
      data-testid="fleet-usage-strip"
      className="flex flex-shrink-0 items-center gap-3 border-b border-border bg-foreground/[0.01] px-3 py-1.5"
    >
      <span className="inline-flex flex-shrink-0 items-center gap-1.5 self-start pt-px typo-caption uppercase tracking-wider text-foreground opacity-70">
        <Gauge className="h-3 w-3" aria-hidden />
        {t.monitor.usage_title}
      </span>
      {body}
      {asOf !== null && (
        <span className="ml-auto inline-flex flex-shrink-0 items-center gap-1 self-start whitespace-nowrap typo-caption text-foreground opacity-50">
          {t.monitor.usage_as_of} <RelativeTime timestamp={asOf} />
        </span>
      )}
    </div>
  );
});

export default UsageStrip;
