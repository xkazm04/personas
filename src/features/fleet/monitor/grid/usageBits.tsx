// usageBits — the small pieces both usage surfaces share: the meter, the
// pace glyph, the window label, the reason copy, and the local clock that
// drives the reset marker. Pure presentation; the numbers come from usageModel.
//
// THE METER CARRIES TWO DIMENSIONS. The fill is utilisation. The vertical
// MARKER is the clock: it sits at the fraction of the window already elapsed,
// and its colour warms as the reset approaches — cool early, warning past
// 60%, hot past 85% — so "how close is the reset" is read off the same bar as
// "how much is spent", with no sentence beside it. The exact countdown rides
// in the row's accessible label.

import { useEffect, useState } from 'react';
import { AlertTriangle, Flame, Gauge, Snowflake } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';
import type { ClaudeUsageWindow } from '@/lib/bindings/ClaudeUsageWindow';
import type { Translations } from '@/i18n/generated/types';
import { formatPercent } from '@/lib/utils/formatters';
import {
  formatCountdown, meterTone, pace, remainingLabel, windowProgress, type MeterTone, type Pace,
} from './usageModel';

/** The marker moves with the clock; 30s is the finest it needs. */
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

const PACE_ICON: Record<Pace, typeof Flame> = { fast: Flame, steady: Gauge, slow: Snowflake };
const PACE_TONE: Record<Pace, string> = {
  fast: 'text-status-warning',
  steady: 'text-foreground opacity-50',
  slow: 'text-status-info',
};

/** Marker warmth thresholds on the elapsed fraction. */
export const MARKER_WARM_AT = 0.6;
export const MARKER_HOT_AT = 0.85;

export type MarkerWarmth = 'cool' | 'warm' | 'hot';

export function markerWarmth(elapsedFrac: number): MarkerWarmth {
  if (elapsedFrac >= MARKER_HOT_AT) return 'hot';
  if (elapsedFrac >= MARKER_WARM_AT) return 'warm';
  return 'cool';
}

const MARKER_FILL: Record<MarkerWarmth, string> = {
  cool: 'bg-status-info',
  warm: 'bg-status-warning',
  hot: 'bg-status-error',
};

export function windowLabel(t: Translations, key: string): string {
  switch (key) {
    case 'five_hour': return t.monitor.usage_window_five_hour;
    case 'seven_day': return t.monitor.usage_window_seven_day;
    case 'seven_day_opus': return t.monitor.usage_window_seven_day_opus;
    case 'seven_day_sonnet': return t.monitor.usage_window_seven_day_sonnet;
    default: return key;
  }
}

export function paceLabel(t: Translations, p: Pace): string {
  switch (p) {
    case 'fast': return t.monitor.usage_pace_fast;
    case 'steady': return t.monitor.usage_pace_steady;
    case 'slow': return t.monitor.usage_pace_slow;
  }
}

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

export function countdownText(
  t: Translations,
  tx: (s: string, v: Record<string, string | number>) => string,
  w: ClaudeUsageWindow,
  now: number,
): string {
  const { remainingMs } = windowProgress(w, now);
  if (remainingMs === null) return t.monitor.usage_resets_unknown;
  const units = {
    day: t.monitor.usage_unit_day,
    hour: t.monitor.usage_unit_hour,
    minute: t.monitor.usage_unit_minute,
    underMinute: t.monitor.usage_under_minute,
  };
  return tx(t.monitor.usage_resets_in, { time: formatCountdown(remainingMs, units) });
}

/** The full accessible sentence for one window: label, percent, reset, pace. */
export function windowAria(
  t: Translations,
  tx: (s: string, v: Record<string, string | number>) => string,
  w: ClaudeUsageWindow,
  now: number,
): string {
  const p = pace(w, now);
  // formatPercent, not `${Math.round(x)}%`: this string is read aloud, and the
  // hand-composed form freezes en's decimal separator and its no-space-before-%
  // convention into all 14 locales (de/fr/cs want `42 %`, ar needs bidi marks).
  return `${windowLabel(t, w.key)} ${formatPercent(w.utilizationPct, { precision: 0 })} · ${countdownText(t, tx, w, now)}${p ? ` · ${paceLabel(t, p)}` : ''}`;
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

/**
 * The bar (utilisation fill + reset marker) and the percent, optionally with
 * the warning/error icon and label. Renders two or three grid cells.
 */
export function MeterBar({
  w, now, t, showTone = true,
}: {
  w: ClaudeUsageWindow;
  now: number;
  t: Translations;
  showTone?: boolean;
}) {
  const tone = meterTone(w.utilizationPct);
  const pct = Math.round(w.utilizationPct);
  const toneLabel = tone === 'error' ? t.monitor.usage_tone_error : t.monitor.usage_tone_warning;
  const { elapsedFrac } = windowProgress(w, now);
  const warmth = elapsedFrac === null ? null : markerWarmth(elapsedFrac);
  return (
    <>
      <span
        aria-hidden
        className="relative h-2 w-full overflow-hidden rounded-full bg-foreground/10"
        data-testid="fleet-usage-meter"
        data-marker={warmth ?? 'none'}
      >
        <span
          className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${FILL[tone]}`}
          style={{ width: `${pct}%` }}
        />
        {elapsedFrac !== null && warmth && (
          <span
            className={`absolute inset-y-0 w-0.5 ring-1 ring-background transition-[left] duration-500 ${MARKER_FILL[warmth]}`}
            style={{ left: `calc(${(elapsedFrac * 100).toFixed(2)}% - 1px)` }}
          />
        )}
      </span>
      <span className="typo-caption tabular-nums text-foreground text-right">{pct}%</span>
      {showTone && tone !== 'ok' && (
        <span className={`inline-flex flex-shrink-0 items-center gap-0.5 typo-caption ${TONE_TEXT[tone]}`}>
          <AlertTriangle className="h-3 w-3" aria-hidden />
          {toneLabel}
        </span>
      )}
    </>
  );
}

/**
 * The meter's leading label: whole hours (5h window) or days (7d window)
 * left until the reset. The window's name is the tooltip; the number is what
 * you read. A window with no scheduled reset shows its plain name.
 */
export function RemainingLabel({ w, now, t }: { w: ClaudeUsageWindow; now: number; t: Translations }) {
  const label = remainingLabel(w, now, { day: t.monitor.usage_unit_day, hour: t.monitor.usage_unit_hour });
  const name = windowLabel(t, w.key);
  return (
    <Tooltip content={windowHint(t, w.key)}>
      <span className="typo-caption tabular-nums text-foreground opacity-70" data-testid="fleet-usage-remaining">
        {label ?? name}
      </span>
    </Tooltip>
  );
}

export function windowHint(t: Translations, key: string): string {
  switch (key) {
    case 'five_hour': return t.monitor.usage_window_five_hour_hint;
    case 'seven_day': return t.monitor.usage_window_seven_day_hint;
    case 'seven_day_opus': return t.monitor.usage_window_seven_day_opus_hint;
    case 'seven_day_sonnet': return t.monitor.usage_window_seven_day_sonnet_hint;
    default: return key;
  }
}

/** The temperature glyph; the name rides along for screen readers. */
export function PaceGlyph({ w, now, t }: { w: ClaudeUsageWindow; now: number; t: Translations }) {
  const p = pace(w, now);
  if (!p) return <span />;
  const Icon = PACE_ICON[p];
  return (
    <span className={`inline-flex items-center justify-center ${PACE_TONE[p]}`} data-pace={p}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">{paceLabel(t, p)}</span>
    </span>
  );
}
