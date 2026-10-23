import { memo } from 'react';
import { formatElapsedCompact, formatRelativeTime, normalizeTimestamp } from '@/lib/utils/formatters';
import { useRelativeTimeTick } from '@/hooks/utility/timing/relativeTimeTicker';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from './Tooltip';

interface RelativeTimeProps {
  /** ISO date string or epoch ms */
  timestamp: string | number | null;
  fallback?: string;
  className?: string;
  /** Show full date/time in a tooltip (default true) */
  showTooltip?: boolean;
  /**
   * `relative` (default) — "5 min. ago", with the tense, down to seconds.
   * `elapsed` — "5 min", "<1 min": no tense, a minute as the smallest unit, for
   * dense rows whose context already says "since" (see `formatElapsedCompact`).
   */
  format?: 'relative' | 'elapsed';
}

/**
 * Renders a relative timestamp ("3s ago", "2m ago") that live-updates via the
 * shared, self-scaling ticker (see {@link useRelativeTimeTick}). All labels in
 * the app re-render on one coalesced tick whose cadence tracks the timestamp's
 * age — every second while fresh, slowing to minutes once it's hours old.
 */
export const RelativeTime = memo(function RelativeTime({
  timestamp,
  fallback = '-',
  className,
  showTooltip = true,
  format = 'relative',
}: RelativeTimeProps) {
  // Bind the tooltip's absolute date to the ACTIVE UI language, not the OS
  // locale: `toLocaleString()` with no argument formatted in en-US for a user
  // running the app in Japanese. `useFormattedDate` and `display/Numeric` bind
  // the same way, so the whole surface stays in one language.
  const { language } = useTranslation();

  // One validity decision for the label, the ticker AND the tooltip. A numeric
  // epoch used to go straight into `new Date(n).toISOString()`, which THROWS
  // RangeError for NaN or anything past +/-8.64e15 and took the whole subtree
  // down with it; an unparseable string reached the tooltip as the literal
  // "Invalid Date" while the label beside it correctly showed the fallback.
  const ms = typeof timestamp === 'number'
    ? timestamp
    : timestamp
      ? Date.parse(normalizeTimestamp(timestamp))
      : NaN;
  const valid = Number.isFinite(ms) && !Number.isNaN(new Date(ms).getTime());
  const isoStr = valid ? new Date(ms).toISOString() : null;
  useRelativeTimeTick(valid ? ms : null);

  const relative = format === 'elapsed' ? formatElapsedCompact(isoStr, fallback) : formatRelativeTime(isoStr, fallback);

  const fullDate = isoStr ? new Date(isoStr).toLocaleString(language) : fallback;

  const span = (
    <span className={className}>
      {relative}
    </span>
  );

  if (!showTooltip || !isoStr) return span;

  return (
    <Tooltip content={fullDate}>
      {span}
    </Tooltip>
  );
});
