import { memo } from 'react';
import { formatRelativeTime, normalizeTimestamp } from '@/lib/utils/formatters';
import { useRelativeTimeTick } from '@/hooks/utility/timing/relativeTimeTicker';
import { Tooltip } from './Tooltip';

interface RelativeTimeProps {
  /** ISO date string or epoch ms */
  timestamp: string | number | null;
  fallback?: string;
  className?: string;
  /** Show full date/time in a tooltip (default true) */
  showTooltip?: boolean;
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
}: RelativeTimeProps) {
  const isoStr = typeof timestamp === 'number'
    ? new Date(timestamp).toISOString()
    : timestamp
      ? normalizeTimestamp(timestamp)
      : timestamp;

  const ms = isoStr ? Date.parse(isoStr) : NaN;
  useRelativeTimeTick(Number.isNaN(ms) ? null : ms);

  const relative = formatRelativeTime(isoStr, fallback);

  const fullDate = isoStr ? new Date(isoStr).toLocaleString() : fallback;

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
