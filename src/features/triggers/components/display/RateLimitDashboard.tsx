import { useMemo } from 'react';
import { Shield, Layers, AlertTriangle } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { PersonaTrigger } from '@/lib/types/types';
import { extractRateLimit, hasActiveRateLimit } from '@/lib/utils/platform/triggerConstants';

interface RateLimitDashboardProps {
  triggers: PersonaTrigger[];
}

function parseConfig(config: string | null): Record<string, unknown> {
  if (!config) return {};
  try { return JSON.parse(config); } catch { return {}; }
}

export function RateLimitDashboard({ triggers }: RateLimitDashboardProps) {
  const rateLimits = usePersonaStore((s) => s.triggerRateLimits);

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

  // Don't render if no triggers have rate limits configured
  if (stats.rateLimitedCount === 0 && stats.throttledCount === 0 && stats.totalQueued === 0) {
    return null;
  }

  return (
    <div className="mx-6 mt-4 rounded-xl border border-primary/10 bg-secondary/30 backdrop-blur-sm p-3">
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5 text-muted-foreground/70">
          <Shield className="w-3.5 h-3.5" />
          <span className="font-medium">Rate Limits</span>
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
