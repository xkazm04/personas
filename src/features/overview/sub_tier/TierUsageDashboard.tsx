import { useEffect, useState, useCallback } from 'react';
import { Gauge, ArrowUpCircle, RefreshCw, Zap, Layers } from 'lucide-react';
import { getTierUsage } from '@/api/tierUsage';
import type { TierUsageSnapshot } from '@/api/tierUsage';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';

function tierLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function usageColor(percent: number): string {
  if (percent >= 80) return 'bg-red-500';
  if (percent >= 50) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function usageTextColor(percent: number): string {
  if (percent >= 80) return 'text-red-400';
  if (percent >= 50) return 'text-amber-400';
  return 'text-emerald-400';
}

function formatLimit(limit: number): string {
  if (limit >= Number.MAX_SAFE_INTEGER / 2) return 'Unlimited';
  return String(limit);
}

function bucketLabel(key: string): string {
  if (key.startsWith('event:')) return `Events: ${key.slice(6)}`;
  if (key.startsWith('webhook:')) return `Webhook: ${key.slice(8).slice(0, 12)}...`;
  return key;
}

function UsageBar({ label, current, limit, percent }: { label: string; current: number; limit: number; percent: number }) {
  const isUnlimited = limit >= Number.MAX_SAFE_INTEGER / 2;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-foreground/80 truncate">{label}</span>
        <span className={`font-medium ${usageTextColor(percent)}`}>
          {current} / {formatLimit(limit)}
        </span>
      </div>
      <div className="h-2 bg-secondary/40 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isUnlimited ? 'bg-emerald-500/30' : usageColor(percent)}`}
          style={{ width: `${isUnlimited ? 2 : Math.max(percent, 1)}%` }}
        />
      </div>
    </div>
  );
}

export default function TierUsageDashboard() {
  const [snapshot, setSnapshot] = useState<TierUsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getTierUsage();
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <ContentBox>
      <ContentHeader
        title="Tier Usage"
        icon={<Gauge className="w-4 h-4" />}
        actions={
          <button
            onClick={refresh}
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        }
      />
      <ContentBody>
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}

        {snapshot && (
          <div className="space-y-6">
            {/* Tier badge */}
            <div className="flex items-center gap-3">
              <div className="px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20">
                <span className="text-sm font-semibold text-primary">
                  {tierLabel(snapshot.tier.tier_name)} Tier
                </span>
              </div>
              {snapshot.approaching_limit && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <ArrowUpCircle className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-sm text-amber-400 font-medium">
                    Approaching limits — upgrade for higher capacity
                  </span>
                </div>
              )}
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-secondary/30 border border-primary/10 space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground/60">
                  <Zap className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium uppercase tracking-wider">Events/min</span>
                </div>
                <p className="text-2xl font-semibold text-foreground/90">
                  {formatLimit(snapshot.tier.event_source_max)}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-secondary/30 border border-primary/10 space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground/60">
                  <Zap className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium uppercase tracking-wider">Webhooks/min</span>
                </div>
                <p className="text-2xl font-semibold text-foreground/90">
                  {formatLimit(snapshot.tier.webhook_trigger_max)}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-secondary/30 border border-primary/10 space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground/60">
                  <Layers className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium uppercase tracking-wider">Queue Depth</span>
                </div>
                <p className="text-2xl font-semibold text-foreground/90">
                  {formatLimit(snapshot.max_queue_depth)}
                </p>
              </div>
            </div>

            {/* Queue status */}
            <div className="p-4 rounded-xl bg-secondary/30 border border-primary/10 space-y-3">
              <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/60">
                Execution Queue
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground/70">Running</p>
                  <p className="text-xl font-semibold text-foreground/90">{snapshot.total_running}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground/70">Queued</p>
                  <p className="text-xl font-semibold text-foreground/90">{snapshot.total_queued}</p>
                </div>
              </div>
            </div>

            {/* Rate limiter buckets */}
            <div className="p-4 rounded-xl bg-secondary/30 border border-primary/10 space-y-3">
              <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/60">
                Active Rate Limits
              </p>
              {snapshot.rate_buckets.length === 0 ? (
                <p className="text-sm text-muted-foreground/50">No active rate-limit buckets</p>
              ) : (
                <div className="space-y-3">
                  {snapshot.rate_buckets
                    .sort((a, b) => b.percent - a.percent)
                    .map((bucket) => (
                      <UsageBar
                        key={bucket.key}
                        label={bucketLabel(bucket.key)}
                        current={bucket.current}
                        limit={bucket.limit}
                        percent={bucket.percent}
                      />
                    ))}
                </div>
              )}
            </div>

            {/* Upgrade CTA */}
            {snapshot.tier.tier_name === 'free' && (
              <div className="p-4 rounded-xl bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground/90">
                    Upgrade to Pro for higher limits
                  </p>
                  <p className="text-sm text-muted-foreground/70 mt-0.5">
                    120 events/min, 20 webhooks/min, and 25 queue depth per persona
                  </p>
                </div>
                <button className="px-4 py-2 rounded-xl bg-primary/15 text-primary border border-primary/25 text-sm font-medium hover:bg-primary/25 transition-colors">
                  <ArrowUpCircle className="w-3.5 h-3.5 inline mr-1.5" />
                  Upgrade
                </button>
              </div>
            )}
          </div>
        )}

        {!snapshot && !error && loading && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 text-muted-foreground/40 animate-spin" />
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
