import { memo, useMemo } from 'react';
import { formatRelativeTime } from '@/lib/utils/formatters';
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
}: AbsoluteTimeProps) {
  const ms = useMemo(() => {
    if (timestamp == null) return NaN;
    return typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  }, [timestamp]);

  if (Number.isNaN(ms)) return <span className={className}>{fallback}</span>;

  const label = new Intl.DateTimeFormat(undefined, FORMATS[variant]).format(ms);
  const span = <span className={className}>{label}</span>;

  if (!showRelativeTooltip) return span;
  return <Tooltip content={formatRelativeTime(new Date(ms).toISOString(), fallback)}>{span}</Tooltip>;
});
