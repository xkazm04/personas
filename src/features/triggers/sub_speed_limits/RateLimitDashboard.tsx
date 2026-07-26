import { useMemo } from 'react';
import { Shield, Layers, AlertTriangle } from 'lucide-react';
import { MotionizedGlyph } from '@/features/shared/components/display/MotionizedGlyph';
import { RATELIMIT_GLYPH } from '@/features/shared/glyph/glyphs/ratelimitGlyph';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { usePipelineStore } from "@/stores/pipelineStore";
import type { PersonaTrigger } from '@/lib/types/types';
import { extractRateLimit, hasActiveRateLimit } from '@/lib/utils/platform/triggerConstants';
import { useTranslation } from '@/i18n/useTranslation';

interface RateLimitDashboardProps {
  triggers: PersonaTrigger[];
  /** True while the parent's listAllTriggers() fetch is still in flight —
   * distinguishes "genuinely no rate limits configured" from "haven't heard
   * back yet" so the empty state never flashes ahead of real data. */
  triggersLoading?: boolean;
}

function parseConfig(config: string | null): Record<string, unknown> {
  return parseJsonOrDefault<Record<string, unknown>>(config, {});
}

export function RateLimitDashboard({ triggers, triggersLoading = false }: RateLimitDashboardProps) {
  const { t } = useTranslation();
  const rateLimits = usePipelineStore((s) => s.triggerRateLimits);

  const stats = useMemo(() => {
    let totalQueued = 0;
    let throttledCount = 0;
    let rateLimitedCount = 0;
    let totalConcurrent = 0;
    const throttledNames: string[] = [];

    for (const trigger of triggers) {
      const rl = extractRateLimit(parseConfig(trigger.config));
      if (hasActiveRateLimit(rl)) rateLimitedCount++;

      const state = rateLimits[trigger.id];
      if (state) {
        totalQueued += state.queueDepth;
        totalConcurrent += state.concurrentCount;
        if (state.isThrottled) {
          throttledCount++;
          throttledNames.push(trigger.trigger_type);
        }
      }
    }

    return { totalQueued, throttledCount, rateLimitedCount, totalConcurrent, throttledNames };
  }, [triggers, rateLimits]);

  const isEmpty = stats.rateLimitedCount === 0 && stats.throttledCount === 0 && stats.totalQueued === 0 && stats.totalConcurrent === 0;

  // Nothing to show yet + the parent's trigger fetch is still in flight:
  // a calm, delayed ghost of the throttle bar under the same geometry the
  // real bar uses. Never shown once any stat is non-zero (law 1) and never
  // shown once the fetch has settled (law 2) — only this exact overlap.
  if (isEmpty && triggersLoading) {
    return <RateLimitGhost />;
  }

  // Show empty state only once the fetch has settled and nothing was found.
  if (isEmpty) {
    return (
      <div className="mx-6 mt-4 rounded-modal border border-dashed border-primary/15 bg-secondary/10 p-6 flex flex-col items-center gap-3 text-center">
        <MotionizedGlyph data={RATELIMIT_GLYPH.data} viewBox={RATELIMIT_GLYPH.viewBox} spread={1} className="w-28 h-28 -mb-1" />
        <div>
          <p className="typo-body font-medium text-foreground">{t.triggers.no_rate_limits}</p>
          <p className="typo-caption text-foreground mt-1 max-w-xs">
            {t.triggers.no_rate_limits_desc}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-6 mt-4 rounded-modal border border-primary/10 bg-secondary/30 backdrop-blur-sm p-3">
      <div className="flex items-center gap-4 typo-body">
        <div className="flex items-center gap-1.5 text-foreground">
          <Shield className="w-3.5 h-3.5" />
          <span className="font-medium">{t.triggers.rate_limits_heading}</span>
        </div>

        <div className="flex items-center gap-3 flex-1">
          {/* Rate-limited triggers count */}
          <div className="flex items-center gap-1.5 text-foreground">
            <span className="font-mono">{stats.rateLimitedCount}</span>
            <span>{stats.rateLimitedCount === 1 ? t.triggers.trigger_configured : t.triggers.triggers_configured}</span>
          </div>

          {/* Concurrent */}
          {stats.totalConcurrent > 0 && (
            <div className="flex items-center gap-1.5 text-blue-400/80">
              <Layers className="w-3 h-3" />
              <span className="font-mono">{stats.totalConcurrent}</span>
              <span>{t.triggers.running_stat}</span>
            </div>
          )}

          {/* Queue depth */}
          {stats.totalQueued > 0 && (
            <div className="flex items-center gap-1.5 text-amber-400/80">
              <AlertTriangle className="w-3 h-3" />
              <span className="font-mono">{stats.totalQueued}</span>
              <span>{t.triggers.queued_bare}</span>
            </div>
          )}

          {/* Throttled */}
          {stats.throttledCount > 0 && (
            <div className="flex items-center gap-1.5 text-red-400/80">
              <Shield className="w-3 h-3" />
              <span className="font-mono">{stats.throttledCount}</span>
              <span>{t.triggers.throttled_stat}</span>
            </div>
          )}
        </div>

        {/* Throttle progress bar */}
        {stats.rateLimitedCount > 0 && (
          <div className="w-24 h-1.5 bg-primary/8 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                stats.throttledCount > 0 ? 'bg-red-400' : stats.totalQueued > 0 ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
              style={{
                width: `${Math.min(100, stats.rateLimitedCount > 0
                  ? ((stats.throttledCount / stats.rateLimitedCount) * 100)
                  : 0
                )}%`,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RateLimitGhost — calm, delayed ghost of the throttle summary bar, shown ONLY
// while triggers are still loading and no stats exist yet (docs/design/
// overview-loading.md §C). Mirrors the real bar's geometry (rounded-modal
// border, same padding, icon + label + tile slots) so the ghost→content swap
// moves nothing. Enters via animate-fade-in behind a >=120ms animation-delay
// (fill-mode both) so a fast fetch never paints it at all. No animate-pulse.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';

function RateLimitGhost() {
  return (
    <div className="mx-6 mt-4 rounded-modal border border-primary/10 bg-secondary/30 backdrop-blur-sm p-3" aria-hidden="true">
      <div className="flex items-center gap-4 typo-body">
        <div
          className="flex items-center gap-1.5 animate-fade-in"
          style={{ animationDelay: '120ms' }}
        >
          <span className={`h-3.5 w-3.5 rounded-full ${GHOST_BAR}`} />
          <span className={`h-3 w-24 ${GHOST_BAR}`} />
        </div>

        <div className="flex items-center gap-3 flex-1">
          <span className={`h-3 w-16 ${GHOST_BAR} animate-fade-in`} style={{ animationDelay: '155ms' }} />
          <span className={`h-3 w-14 ${GHOST_BAR} animate-fade-in`} style={{ animationDelay: '190ms' }} />
          <span className={`h-3 w-14 ${GHOST_BAR} animate-fade-in`} style={{ animationDelay: '225ms' }} />
        </div>

        <span
          className="w-24 h-1.5 rounded-full bg-primary/[0.06] animate-fade-in"
          style={{ animationDelay: '260ms' }}
        />
      </div>
    </div>
  );
}
