import type { ByomPolicy, ProviderUsageStats } from '@/api/byom';
import { PROVIDER_OPTIONS, ENGINE_LABELS } from '../libs/byomHelpers';

interface ByomProviderListProps {
  policy: ByomPolicy;
  usageStats: ProviderUsageStats[];
  toggleProvider: (providerId: string, list: 'allowed' | 'blocked') => void;
}

export function ByomProviderList({ policy, usageStats, toggleProvider }: ByomProviderListProps) {
  return (
    <div className="space-y-4">
      {/* Allowed providers */}
      <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-3">
        <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
          Allowed Providers
        </h2>
        <p className="text-sm text-muted-foreground/60">
          Select which providers your organization approves. Leave empty to allow all.
        </p>
        <div className="grid grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4 gap-2">
          {PROVIDER_OPTIONS.map((prov) => {
            const isAllowed = policy.allowed_providers.includes(prov.id);
            return (
              <button
                key={prov.id}
                onClick={() => toggleProvider(prov.id, 'allowed')}
                className={`p-3 rounded-lg border text-left text-sm transition-all ${
                  isAllowed
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-foreground'
                    : 'border-primary/10 text-muted-foreground hover:border-primary/20'
                }`}
              >
                {prov.label}
                {isAllowed && <span className="ml-2 text-emerald-400">Allowed</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Blocked providers */}
      <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-3">
        <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
          Blocked Providers
        </h2>
        <p className="text-sm text-muted-foreground/60">
          Explicitly block specific providers. Takes precedence over allowed list.
        </p>
        <div className="grid grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4 gap-2">
          {PROVIDER_OPTIONS.map((prov) => {
            const isBlocked = policy.blocked_providers.includes(prov.id);
            return (
              <button
                key={prov.id}
                onClick={() => toggleProvider(prov.id, 'blocked')}
                className={`p-3 rounded-lg border text-left text-sm transition-all ${
                  isBlocked
                    ? 'border-red-500/30 bg-red-500/10 text-foreground'
                    : 'border-primary/10 text-muted-foreground hover:border-primary/20'
                }`}
              >
                {prov.label}
                {isBlocked && <span className="ml-2 text-red-400">Blocked</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Usage stats summary */}
      {usageStats.length > 0 && (
        <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-3">
          <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
            Provider Usage
          </h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {usageStats.map((stat) => (
              <div key={stat.engine_kind} className="p-3 rounded-lg border border-primary/10 bg-secondary/20">
                <div className="text-sm font-medium text-foreground">
                  {ENGINE_LABELS[stat.engine_kind] || stat.engine_kind}
                </div>
                <div className="text-sm text-muted-foreground/70 mt-1 space-y-0.5">
                  <div>{stat.execution_count} executions</div>
                  <div>${stat.total_cost_usd.toFixed(4)} total cost</div>
                  <div>{Math.round(stat.avg_duration_ms / 1000)}s avg duration</div>
                  {stat.failover_count > 0 && (
                    <div className="text-amber-400">{stat.failover_count} failovers</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
