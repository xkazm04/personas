import { memo, useMemo } from 'react';
import { formatRelativeTime, normalizeTimestamp } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from './Tooltip';

/**
 * @catalog Fixed absolute timestamp (date / time / datetime) with relative time on hover. Use instead of raw new Date().toLocaleString() for displayed dates.
 */
export type AbsoluteTimeVariant = 'datetime' | 'date' | 'time' | 'compact';

const FORMATS: Record<AbsoluteTimeVariant, Intl.DateTimeFormatOptions> = {
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
  date: { dateStyle: 'medium' },
  time: { timeStyle: 'short' },
  // "compact" — short numeric, good for dense tables (e.g. 5/24/26, 3:00 PM)
  compact: { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' },
};

interface AbsoluteTimeProps {
  /** ISO date string or epoch ms. */
  timestamp: string | number | null | undefined;
  /** Output shape (default 'datetime'). */
  variant?: AbsoluteTimeVariant;
  /** Shown when the timestamp is missing/invalid (default '-'). */
  fallback?: string;
  className?: string;
  /** Show the "2h ago" relative form in a tooltip on hover (default true). */
  showRelativeTooltip?: boolean;
  /**
   * BCP-47 tag to format with, overriding the active UI language. Only for a
   * surface that must pin a locale regardless of who is looking (a fixed-locale
   * export preview); leave unset everywhere else.
   */
  language?: string;
}

/**
 * Canonical primitive for displaying a *fixed* timestamp (a "created on" /
 * "expires at" date the user reads as an exact moment). For "2h ago" style
 * elapsed displays use {@link RelativeTime} instead. Never hand-roll
 * `new Date(x).toLocaleString()` in JSX — this keeps locale, format presets,
 * and the relative-on-hover affordance consistent app-wide.
 */
export const AbsoluteTime = memo(function AbsoluteTime({
  timestamp,
  variant = 'datetime',
  fallback = '-',
  className,
  showRelativeTooltip = true,
  language: languageOverride,
}: AbsoluteTimeProps) {
  // Bind the format to the ACTIVE UI LANGUAGE, not the OS locale. Passing
  // `undefined` to Intl.DateTimeFormat asks the operating system, so a user
  // running the app in Czech read `8/14/2026` beside a `1,50` from `Numeric`
  // and a Czech relative label from `RelativeTime` - both of which already bind
  // this way, as does `formatTimestamp` in `lib/utils/formatters`. This
  // primitive was the last one still following the machine.
  const { language } = useTranslation();
  const locale = languageOverride ?? language;
  const ms = useMemo(() => {
    if (timestamp == null) return NaN;
    // `normalizeTimestamp` is load-bearing, and its absence here was a live
    // correctness bug on every non-UTC machine. SQLite's datetime('now') yields
    // "YYYY-MM-DD HH:MM:SS" — UTC with NO timezone marker — and Date.parse
    // reads a designator-less, space-separated string as LOCAL time. Executed
    // on the operator's own box (Europe/Prague): "2026-08-14 12:34:56" parsed
    // to 10:34:56Z, so every one of this component's 37 call sites rendered two
    // hours off, and a just-written row displayed in the FUTURE.
    //
    // The helper already existed, already handled this, and already documented
    // it ("a row written 'now' can read '2h ago' for a UTC+2 viewer") — and
    // RelativeTime already imported it. Only this component skipped it. Eighth
    // instance this wave of the better answer existing, unused.
    return typeof timestamp === 'number' ? timestamp : Date.parse(normalizeTimestamp(timestamp));
  }, [timestamp]);

  if (Number.isNaN(ms)) return <span className={className}>{fallback}</span>;

  const label = new Intl.DateTimeFormat(locale, FORMATS[variant]).format(ms);
  const span = <span className={className}>{label}</span>;

  if (!showRelativeTooltip) return span;
  return <Tooltip content={formatRelativeTime(new Date(ms).toISOString(), fallback)}>{span}</Tooltip>;
});
