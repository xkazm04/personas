import { useMemo } from 'react';
import { Shield, Layers, AlertTriangle } from 'lucide-react';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { usePipelineStore } from "@/stores/pipelineStore";
import type { PersonaTrigger } from '@/lib/types/types';
import { extractRateLimit, hasActiveRateLimit } from '@/lib/utils/platform/triggerConstants';
import { useTranslation } from '@/i18n/useTranslation';

interface RateLimitDashboardProps {
  triggers: PersonaTrigger[];
}

function parseConfig(config: string | null): Record<string, unknown> {
  return parseJsonOrDefault<Record<string, unknown>>(config, {});
}

export function RateLimitDashboard({ triggers }: RateLimitDashboardProps) {
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

  // Show empty state when no rate limits configured
  if (stats.rateLimitedCount === 0 && stats.throttledCount === 0 && stats.totalQueued === 0) {
    return (
      <div className="mx-6 mt-4 rounded-xl border border-dashed border-primary/15 bg-secondary/10 p-6 flex flex-col items-center gap-3 text-center">
        <div className="w-10 h-10 rounded-xl bg-primary/8 border border-primary/10 flex items-center justify-center">
          <Shield className="w-5 h-5 text-muted-foreground/40" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground/70">{t.triggers.no_rate_limits}</p>
          <p className="text-xs text-muted-foreground/50 mt-1 max-w-xs">
            {t.triggers.no_rate_limits_desc}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-6 mt-4 rounded-xl border border-primary/10 bg-secondary/30 backdrop-blur-sm p-3">
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5 text-muted-foreground/70">
          <Shield className="w-3.5 h-3.5" />
          <span className="font-medium">{t.triggers.rate_limits_heading}</span>
        </div>

        <div className="flex items-center gap-3 flex-1">
          {/* Rate-limited triggers count */}
          <div className="flex items-center gap-1.5 text-muted-foreground/60">
            <span className="font-mono">{stats.rateLimitedCount}</span>
            <span>{stats.rateLimitedCount === 1 ? 'trigger' : 'triggers'} configured</span>
          </div>

          {/* Concurrent */}
          {stats.totalConcurrent > 0 && (
            <div className="flex items-center gap-1.5 text-blue-400/80">
              <Layers className="w-3 h-3" />
              <span className="font-mono">{stats.totalConcurrent}</span>
              <span>running</span>
            </div>
          )}

          {/* Queue depth */}
          {stats.totalQueued > 0 && (
            <div className="flex items-center gap-1.5 text-amber-400/80">
              <AlertTriangle className="w-3 h-3" />
              <span className="font-mono">{stats.totalQueued}</span>
              <span>queued</span>
            </div>
          )}

          {/* Throttled */}
          {stats.throttledCount > 0 && (
            <div className="flex items-center gap-1.5 text-red-400/80">
              <Shield className="w-3 h-3" />
              <span className="font-mono">{stats.throttledCount}</span>
              <span>throttled</span>
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
