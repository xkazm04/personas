import { useMemo, useState, useCallback } from 'react';
import type { ByomPolicy, ProviderUsageStats, ProviderUsageTimeseries, ProviderConnectionResult } from '@/api/system/byom';
import { testProviderConnection } from '@/api/system/byom';
import { PROVIDER_OPTIONS, ENGINE_LABELS } from '../libs/byomHelpers';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { ProviderSparkline } from './ProviderSparkline';
import { useTranslation } from '@/i18n/useTranslation';

interface ByomProviderListProps {
  policy: ByomPolicy;
  usageStats: ProviderUsageStats[];
  usageTimeseries: ProviderUsageTimeseries[];
  toggleProvider: (providerId: string, list: 'allowed' | 'blocked') => void;
}

/** Group timeseries rows by engine_kind, extracting per-metric arrays. */
function useTimeseriesByEngine(timeseries: ProviderUsageTimeseries[]) {
  return useMemo(() => {
    const map = new Map<string, {
      executions: number[];
      cost: number[];
      duration: number[];
    }>();
    for (const row of timeseries) {
      let bucket = map.get(row.engine_kind);
      if (!bucket) {
        bucket = { executions: [], cost: [], duration: [] };
        map.set(row.engine_kind, bucket);
      }
      bucket.executions.push(row.execution_count);
      bucket.cost.push(row.total_cost_usd);
      bucket.duration.push(row.avg_duration_ms);
    }
    return map;
  }, [timeseries]);
}

type TestState = 'idle' | 'testing' | 'pass' | 'fail';

interface ConnectionTestResult {
  state: TestState;
  result?: ProviderConnectionResult;
}

export function ByomProviderList({ policy, usageStats, usageTimeseries, toggleProvider }: ByomProviderListProps) {
  const trendsByEngine = useTimeseriesByEngine(usageTimeseries);
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({});
  const { t } = useTranslation();
  const s = t.settings.byom;

  const handleTestConnection = useCallback(async (providerId: string) => {
    setTestResults((prev) => ({ ...prev, [providerId]: { state: 'testing' } }));
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection test timed out (5s)')), 5000),
      );
      const result = await Promise.race([testProviderConnection(providerId), timeout]);
      setTestResults((prev) => ({
        ...prev,
        [providerId]: { state: result.reachable ? 'pass' : 'fail', result },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [providerId]: {
          state: 'fail',
          result: { provider_id: providerId, reachable: false, latency_ms: null, version: null, error: err instanceof Error ? err.message : 'IPC call failed' },
        },
      }));
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* Allowed providers */}
      <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-3">
        <SectionHeading title={s.allowed_providers} />
        <p className="text-sm text-muted-foreground/60">
          {s.allowed_providers_hint}
        </p>
        <div className="grid grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4 gap-2">
          {PROVIDER_OPTIONS.map((prov) => {
            const isAllowed = policy.allowed_providers.includes(prov.id);
            const test = testResults[prov.id];
            return (
              <div key={prov.id} className="flex flex-col gap-1.5">
                <button
                  onClick={() => toggleProvider(prov.id, 'allowed')}
                  className={`p-3 rounded-lg border text-left text-sm transition-all ${
                    isAllowed
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-foreground'
                      : 'border-primary/10 text-muted-foreground hover:border-primary/20'
                  }`}
                >
                  {prov.label}
                  {isAllowed && <span className="ml-2 text-emerald-400">{s.allowed}</span>}
                </button>
                <TestConnectionButton
                  providerId={prov.id}
                  testState={test}
                  onTest={handleTestConnection}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Blocked providers */}
      <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-3">
        <SectionHeading title={s.blocked_providers} />
        <p className="text-sm text-muted-foreground/60">
          {s.blocked_providers_hint}
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
                {isBlocked && <span className="ml-2 text-red-400">{s.blocked}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Usage stats with sparkline trends */}
      {usageStats.length > 0 && (
        <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-3">
          <div className="flex items-baseline gap-2">
            <SectionHeading title={s.provider_usage} />
            <span className="text-xs text-muted-foreground/40">{s.usage_trends}</span>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {usageStats.map((stat) => {
              const trends = trendsByEngine.get(stat.engine_kind);
              return (
                <div key={stat.engine_kind} className="p-3 rounded-lg border border-primary/10 bg-secondary/20">
                  <div className="text-sm font-medium text-foreground mb-2">
                    {ENGINE_LABELS[stat.engine_kind] || stat.engine_kind}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground/50">{s.executions}</div>
                      <div className="text-sm font-medium text-foreground">{stat.execution_count}</div>
                      <ProviderSparkline
                        data={trends?.executions ?? []}
                        color="#10b981"
                        label="daily"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground/50">{s.cost}</div>
                      <div className="text-sm font-medium text-foreground">${stat.total_cost_usd.toFixed(4)}</div>
                      <ProviderSparkline
                        data={trends?.cost ?? []}
                        color="#8b5cf6"
                        label="daily"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground/50">{s.avg_duration}</div>
                      <div className="text-sm font-medium text-foreground">{Math.round(stat.avg_duration_ms / 1000)}s</div>
                      <ProviderSparkline
                        data={trends?.duration ?? []}
                        color="#f59e0b"
                        label="daily"
                      />
                    </div>
                  </div>
                  {stat.failover_count > 0 && (
                    <div className="text-xs text-amber-400 mt-2">{stat.failover_count} failovers</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Test Connection Button
// =============================================================================

function TestConnectionButton({
  providerId,
  testState,
  onTest,
}: {
  providerId: string;
  testState?: ConnectionTestResult;
  onTest: (id: string) => void;
}) {
  const state = testState?.state ?? 'idle';
  const result = testState?.result;

  return (
    <div className="flex items-center gap-2">
      <button
        disabled={state === 'testing'}
        onClick={(e) => {
          e.stopPropagation();
          onTest(providerId);
        }}
        className="text-xs px-2.5 py-1 rounded-md border border-primary/15 text-muted-foreground
          hover:border-primary/30 hover:text-foreground transition-all disabled:opacity-50 disabled:cursor-wait"
      >
        {state === 'testing' ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Testing...
          </span>
        ) : (
          'Test Connection'
        )}
      </button>

      {state === 'pass' && (
        <span className="text-xs text-emerald-400 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0a8 8 0 110 16A8 8 0 018 0zm3.78 4.97a.75.75 0 00-1.06 0L7 8.69 5.28 6.97a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l4.25-4.25a.75.75 0 000-1.06z" />
          </svg>
          {result?.version ?? 'Reachable'}
          {result?.latency_ms != null && (
            <span className="text-muted-foreground/50 ml-1">{result.latency_ms}ms</span>
          )}
        </span>
      )}

      {state === 'fail' && (
        <span className="text-xs text-red-400 flex items-center gap-1" title={result?.error ?? undefined}>
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0a8 8 0 110 16A8 8 0 018 0zm3.03 4.97a.75.75 0 00-1.06 0L8 6.94 6.03 4.97a.75.75 0 10-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 001.06 1.06L8 9.06l1.97 1.97a.75.75 0 001.06-1.06L9.06 8l1.97-1.97a.75.75 0 000-1.06z" />
          </svg>
          {result?.error ?? 'Unreachable'}
        </span>
      )}
    </div>
  );
}
