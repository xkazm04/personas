import { Clock } from 'lucide-react';
import { useEffect, useState } from 'react';

interface StalenessIndicatorProps {
  /** Epoch ms when this data source was last successfully fetched. */
  fetchedAt: number | undefined;
  /** Whether this source currently has a pipeline error (data may be stale). */
  hasError: boolean;
  /** Label for which data section this covers. */
  label?: string;
}

/** Threshold (ms) after which data is considered "stale" even without an error. */
const STALE_THRESHOLD_MS = 5 * 60_000; // 5 minutes

function formatAge(ms: number): string {
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

/**
 * Small inline indicator showing when a data section was last refreshed.
 * Renders nothing when data is fresh and healthy.
 * Shows an amber "stale" badge when the source has errored or data is old.
 */
export function StalenessIndicator({ fetchedAt, hasError, label }: StalenessIndicatorProps) {
  const [now, setNow] = useState(Date.now);

  // Re-render every 30s so the age label stays current
  useEffect(() => {
    if (!fetchedAt) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [fetchedAt]);

  if (!fetchedAt) return null;

  const age = now - fetchedAt;
  const isStale = hasError || age > STALE_THRESHOLD_MS;

  if (!isStale) return null;

  const ageText = formatAge(age);
  const title = label
    ? `${label} data last updated ${ageText}${hasError ? ' (refresh failed)' : ''}`
    : `Data last updated ${ageText}${hasError ? ' (refresh failed)' : ''}`;

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-500/10 text-amber-400/80 border border-amber-500/20"
      title={title}
    >
      <Clock className="w-3 h-3" />
      {ageText}
    </span>
  );
}
