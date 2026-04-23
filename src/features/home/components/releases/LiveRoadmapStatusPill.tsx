/**
 * Status pill shown above the roadmap hero when a live-fetch attempt has
 * completed. Tells the user where the content they're reading came from
 * (fresh / cached / bundled snapshot) and lets them manually refresh.
 *
 * Relative time rendering uses `Intl.RelativeTimeFormat` so the "4m ago"
 * / "il y a 4 minutes" phrasing follows the user's current app language
 * without any extra translation keys.
 */
import { RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { LiveRoadmapStatus } from './useLiveRoadmap';
import type { ReleasesTranslation } from './i18n/useReleasesTranslation';

const BUCKETS: { limit: number; unit: Intl.RelativeTimeFormatUnit; div: number }[] = [
  { limit: 60, unit: 'second', div: 1 },
  { limit: 60 * 60, unit: 'minute', div: 60 },
  { limit: 60 * 60 * 24, unit: 'hour', div: 60 * 60 },
  { limit: Number.POSITIVE_INFINITY, unit: 'day', div: 60 * 60 * 24 },
];

function formatRelative(iso: string | null, language: string): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const bucket = BUCKETS.find((b) => abs < b.limit) ?? BUCKETS[BUCKETS.length - 1]!;
  const fmt = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  return fmt.format(Math.round(diffSec / bucket.div), bucket.unit);
}

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

  let dot = 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]';
  let label: string;

  if (status === 'fresh' || status === 'cached') {
    const relative = formatRelative(fetchedAt, language);
    const prefix = status === 'cached' ? t.live.sourceCache : t.live.updatedPrefix;
    if (status === 'cached') dot = 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.55)]';
    label = relative ? `${prefix} · ${relative}` : prefix;
  } else {
    // 'unavailable' — bundled snapshot, nothing to refresh against.
    dot = 'bg-foreground/40';
    label = t.live.sourceFallback;
  }

  return (
    <div className="flex items-center gap-2 rounded-full border border-primary/8 bg-primary/[0.03] px-3 py-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="font-mono text-xs text-foreground">{label}</span>
      {onRefresh && status !== 'unavailable' && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="ml-1 flex items-center gap-1 rounded-full border border-primary/8 bg-primary/[0.04] px-2 py-0.5 text-xs text-foreground transition-colors hover:border-primary/16 hover:bg-primary/[0.07] disabled:opacity-50"
          aria-label={refreshLabel}
          title={refreshLabel}
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      )}
    </div>
  );
}
