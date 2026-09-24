/**
 * Status pill shown above the roadmap hero when a live-fetch attempt has
 * completed. Tells the user where the content they're reading came from
 * (fresh / cached / bundled snapshot) and lets them manually refresh.
 *
 * Relative time rendering uses `Intl.RelativeTimeFormat` so the "4m ago"
 * / "il y a 4 minutes" phrasing follows the user's current app language
 * without any extra translation keys.
 */
import type { ReactNode } from 'react';
import { Package, RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { StatusDot, type ConnectionState } from '@/features/shared/components/display/StatusDot';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { LiveRoadmapStatus } from './useLiveRoadmap';
import type { ReleasesTranslation } from './i18n/useReleasesTranslation';

const BUCKETS: { limit: number; unit: Intl.RelativeTimeFormatUnit; div: number }[] = [
  { limit: 60, unit: 'second', div: 1 },
  { limit: 60 * 60, unit: 'minute', div: 60 },
  { limit: 60 * 60 * 24, unit: 'hour', div: 60 * 60 },
  { limit: Number.POSITIVE_INFINITY, unit: 'day', div: 60 * 60 * 24 },
];

/**
 * Format `iso` (a "last fetched at" timestamp from the Rust cache layer) as
 * a localized relative time like "4 minutes ago". `iso` is supposed to be in
 * the past, but disk-cache replay across machines, NTP corrections, DST jumps,
 * or laptops just woken from sleep can produce a future timestamp. Negative
 * `diffSec` would render as "in 4 minutes", which makes the freshness pill
 * lie. Clamp to `<= 0` so a future timestamp degrades to "just now" instead.
 */
function formatRelative(iso: string | null, language: string): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const rawDiffSec = Math.round((then - Date.now()) / 1000);
  const diffSec = Math.min(0, rawDiffSec);
  const abs = Math.abs(diffSec);
  const bucket = BUCKETS.find((b) => abs < b.limit) ?? BUCKETS[BUCKETS.length - 1]!;
  const fmt = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  return fmt.format(Math.round(diffSec / bucket.div), bucket.unit);
}

/** Where the content came from, as a connection state with its own shape:
 * fresh is live, a cache answer is paused, a rescue after a failed fetch is
 * offline. The bundled snapshot has no connection at all and draws a package. */
const SOURCE_STATE: Record<'fresh' | 'cached' | 'stale', ConnectionState> = {
  fresh: 'live',
  cached: 'paused',
  stale: 'offline',
};

interface Props {
  status: LiveRoadmapStatus;
  fetchedAt: string | null;
  refreshing: boolean;
  onRefresh?: () => void;
  t: ReleasesTranslation;
  language: string;
}

export function LiveRoadmapStatusPill({
  status,
  fetchedAt,
  refreshing,
  onRefresh,
  t,
  language,
}: Props) {
  const { t: rawT } = useTranslation();
  const refreshLabel = rawT.common.refresh;

  if (status === 'loading') return null;

  let source: ReactNode;

  if (status === 'fresh' || status === 'cached' || status === 'stale') {
    const relative = formatRelative(fetchedAt, language);
    const prefix =
      status === 'stale'
        ? t.live.sourceStale
        : status === 'cached'
          ? t.live.sourceCache
          : t.live.updatedPrefix;
    const label = relative ? `${prefix} · ${relative}` : prefix;
    // StatusDot is role="img" named by `label`, so the visible line inside it is
    // read once, as its name.
    source = (
      <StatusDot kind="connection" state={SOURCE_STATE[status]} label={label} pulse={false}>
        <span className="typo-caption">{label}</span>
      </StatusDot>
    );
  } else {
    // 'unavailable': bundled snapshot, nothing to refresh against.
    source = (
      <span className="flex items-center gap-2">
        <Package aria-hidden className="h-3.5 w-3.5 text-foreground" />
        <span className="typo-caption">{t.live.sourceFallback}</span>
      </span>
    );
  }

  const canRefresh = !!onRefresh && status !== 'unavailable';
  return (
    <div className={`flex items-center gap-2 rounded-full border border-primary/10 bg-primary/5 py-0.5 pl-3 ${canRefresh ? 'pr-1' : 'pr-3'}`}>
      {source}
      {canRefresh && (
        // The shared icon button is 28x28, above the 24x24 floor WCAG 2.2
        // SC 2.5.8 sets for the only control on this surface; it renders the
        // real spinner while a refresh is in flight.
        <Tooltip content={refreshLabel}>
          <Button
            variant="ghost"
            size="icon-sm"
            loading={refreshing}
            onClick={onRefresh}
            aria-label={refreshLabel}
            icon={<RefreshCw className="h-3.5 w-3.5" />}
          />
        </Tooltip>
      )}
    </div>
  );
}
