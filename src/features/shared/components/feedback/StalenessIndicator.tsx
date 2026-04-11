import { Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

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

/**
 * Small inline indicator showing when a data section was last refreshed.
 * Renders nothing when data is fresh and healthy.
 * Shows an amber "stale" badge when the source has errored or data is old.
 */
export function StalenessIndicator({ fetchedAt, hasError, label }: StalenessIndicatorProps) {
  const { t, tx } = useTranslation();
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

  const formatAge = (ms: number): string => {
    if (ms < 60_000) return t.common.staleness_just_now;
    if (ms < 3_600_000) return tx(t.common.staleness_minutes_ago, { minutes: Math.round(ms / 60_000) });
    if (ms < 86_400_000) return tx(t.common.staleness_hours_ago, { hours: Math.round(ms / 3_600_000) });
    return tx(t.common.staleness_days_ago, { days: Math.round(ms / 86_400_000) });
  };

  const ageText = formatAge(age);
  const failedSuffix = hasError ? ` ${t.common.staleness_refresh_failed}` : '';
  const title = label
    ? tx(t.common.staleness_tooltip_labeled, { label, age: ageText }) + failedSuffix
    : tx(t.common.staleness_tooltip, { age: ageText }) + failedSuffix;

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
