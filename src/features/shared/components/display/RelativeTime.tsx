import { useState, useEffect, memo } from 'react';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { Tooltip } from './Tooltip';

const TICK_MS = 15_000;

interface RelativeTimeProps {
  /** ISO date string or epoch ms */
  timestamp: string | number | null;
  fallback?: string;
  className?: string;
  /** Show full date/time in a tooltip (default true) */
  showTooltip?: boolean;
}

/**
 * Renders a relative timestamp ("3s ago", "2m ago") that live-updates
 * every 15 seconds so the UI feels alive without excessive re-renders.
 */
export const RelativeTime = memo(function RelativeTime({
  timestamp,
  fallback = '-',
  className,
  showTooltip = true,
}: RelativeTimeProps) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (timestamp == null) return;
    const id = setInterval(() => tick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [timestamp]);

  const isoStr = typeof timestamp === 'number'
    ? new Date(timestamp).toISOString()
    : timestamp;

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
