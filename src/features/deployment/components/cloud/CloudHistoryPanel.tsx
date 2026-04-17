import { useTranslation } from '@/i18n/useTranslation';
import { useCallback, useRef, useState, useEffect } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { CloudExecutionRow } from './CloudExecutionRow';
import { useAgentStore } from "@/stores/agentStore";
import { usePersonaNameMap } from "@/hooks/usePersonaNameMap";
import { cloudListExecutions, cloudExecutionStats, cloudGetExecutionOutput } from '@/api/system/cloud';
import type { CloudExecution, CloudExecutionStats } from '@/api/system/cloud';
import { DEPLOYMENT_TOKENS } from '../deploymentTokens';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import { statusIcon as _statusIcon, formatDuration, formatCost, timeAgo as _timeAgo } from './CloudHistoryHelpers';
import { StatCard } from './StatCard';
import { DailyBreakdownChart } from './DailyBreakdownChart';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CloudHistoryPanel() {
  const { t } = useTranslation();
  const dt = t.deployment;
  const personas = useAgentStore((s) => s.personas);
  const personaName = usePersonaNameMap();
  const [executions, setExecutions] = useState<CloudExecution[]>([]);
  const [stats, setStats] = useState<CloudExecutionStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [outputMap, setOutputMap] = useState<Record<string, { lines: string[]; loading: boolean; error?: string }>>({});
  const [filterPersona, setFilterPersona] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [period, setPeriod] = useState<number>(7);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [execs, st] = await Promise.all([
        cloudListExecutions(filterPersona || undefined, filterStatus || undefined, 50),
        cloudExecutionStats(filterPersona || undefined, period),
      ]);
      setExecutions(execs);
      setStats(st);
    } catch {
      // Errors handled silently -- panel shows empty state
    } finally {
      setIsLoading(false);
    }
  }, [filterPersona, filterStatus, period]);

  const fetchingRef = useRef(new Set<string>());
  const outputCacheRef = useRef(new Map<string, { lines: string[]; ts: number }>());
  const OUTPUT_CACHE_TTL = 5 * 60 * 1000;
  const OUTPUT_CACHE_MAX = 50;

  /** Evict expired entries, then trim oldest if over cap (LRU via Map insertion order). */
  const evictCache = useCallback(() => {
    const cache = outputCacheRef.current;
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now - entry.ts >= OUTPUT_CACHE_TTL) cache.delete(key);
    }
    while (cache.size > OUTPUT_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
      else break;
    }
  }, []);

  const fetchOutput = useCallback(async (execId: string) => {
    // Return cached output if still fresh (re-insert to mark as recently used)
    const cached = outputCacheRef.current.get(execId);
    if (cached && Date.now() - cached.ts < OUTPUT_CACHE_TTL) {
      outputCacheRef.current.delete(execId);
      outputCacheRef.current.set(execId, cached);
      setOutputMap((prev) => ({ ...prev, [execId]: { lines: cached.lines, loading: false } }));
      return;
    }
    if (fetchingRef.current.has(execId)) return;
    fetchingRef.current.add(execId);
    setOutputMap((prev) => ({ ...prev, [execId]: { lines: [], loading: true } }));
    try {
      const lines = await cloudGetExecutionOutput(execId);
      outputCacheRef.current.set(execId, { lines, ts: Date.now() });
      evictCache();
      setOutputMap((prev) => ({ ...prev, [execId]: { lines, loading: false } }));
    } catch (e) {
      setOutputMap((prev) => ({
        ...prev,
        [execId]: { lines: [], loading: false, error: e instanceof Error ? e.message : 'Failed to fetch output' },
      }));
    } finally {
      fetchingRef.current.delete(execId);
    }
  }, [evictCache]);

  // Debounce filter-driven refetches to avoid API spam when iterating filters
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const debouncedFetchData = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchData, 300);
  }, [fetchData]);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // Re-fetch when filters change (debounced)
  const prevFiltersRef = useRef({ filterPersona, filterStatus, period });
  useEffect(() => {
    const prev = prevFiltersRef.current;
    if (prev.filterPersona !== filterPersona || prev.filterStatus !== filterStatus || prev.period !== period) {
      prevFiltersRef.current = { filterPersona, filterStatus, period };
      debouncedFetchData();
    }
  }, [filterPersona, filterStatus, period, debouncedFetchData]);

  // Auto-poll history data while this panel is mounted and tab is visible
  const { lastRefreshed: historyLastPolled } = usePolling(fetchData, {
    ...POLLING_CONFIG.cloudHistory,
    enabled: true,
  });

  return (
    <div className={DEPLOYMENT_TOKENS.panelSpacing}>
      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-4 3xl:grid-cols-8 gap-3">
          <StatCard label="Total Runs" value={String(stats.total_executions)} />
          <StatCard
            label="Success Rate"
            value={stats.success_rate != null ? `${(stats.success_rate * 100).toFixed(0)}%` : '-'}
            color={stats.success_rate != null && stats.success_rate >= 0.9 ? 'emerald' : stats.success_rate != null && stats.success_rate >= 0.7 ? 'amber' : 'red'}
          />
          <StatCard label="Total Cost" value={formatCost(stats.total_cost_usd)} />
          <StatCard label="Avg Duration" value={formatDuration(stats.avg_duration_ms ?? null)} />
        </div>
      )}

      {/* Daily breakdown chart */}
      {stats && stats.daily_breakdown.length > 0 && (
        <DailyBreakdownChart data={stats.daily_breakdown} />
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <select
          value={filterPersona}
          onChange={(e) => setFilterPersona(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-modal bg-secondary/40 border border-primary/15 text-foreground focus-visible:outline-none focus-visible:border-indigo-500/40 transition-colors"
        >
          <option value="">{dt.history.all_personas}</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-modal bg-secondary/40 border border-primary/15 text-foreground focus-visible:outline-none focus-visible:border-indigo-500/40 transition-colors"
        >
          <option value="">{dt.history.all_statuses}</option>
          <option value="completed">{dt.history.completed}</option>
          <option value="failed">{dt.history.failed}</option>
          <option value="cancelled">{dt.history.cancelled}</option>
        </select>

        <select
          value={period}
          onChange={(e) => setPeriod(Number(e.target.value))}
          className="px-3 py-1.5 text-sm rounded-modal bg-secondary/40 border border-primary/15 text-foreground focus-visible:outline-none focus-visible:border-indigo-500/40 transition-colors"
        >
          <option value={7}>{dt.history.last_7_days}</option>
          <option value={30}>{dt.history.last_30_days}</option>
          <option value={90}>{dt.history.last_90_days}</option>
        </select>

        {historyLastPolled != null && (
          <div className="flex items-center gap-2 text-xs text-foreground ml-auto mr-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Live
          </div>
        )}
        <button
          onClick={fetchData}
          disabled={isLoading}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-modal bg-secondary/40 border border-primary/15 text-foreground hover:text-foreground/95 hover:border-primary/25 disabled:opacity-40 transition-colors cursor-pointer ${historyLastPolled == null ? 'ml-auto' : ''}`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Top errors */}
      {stats && stats.top_errors.length > 0 && (
        <div className="space-y-2">
          <SectionHeading className="text-xs">Top Errors</SectionHeading>
          {stats.top_errors.map((err, i) => (
            <div key={i} className="flex items-center gap-2 text-xs p-2 rounded-card bg-red-500/5 border border-red-500/10">
              <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
              <span className="text-foreground truncate flex-1">{err.message}</span>
              <span className="text-red-400 font-medium shrink-0">{err.count}x</span>
            </div>
          ))}
        </div>
      )}

      {/* Execution table */}
      {executions.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-foreground">
            {isLoading ? 'Loading execution history...' : 'No executions found for the selected filters.'}
          </p>
          {!isLoading && (filterPersona || filterStatus) && (
            <button
              type="button"
              onClick={() => { setFilterPersona(''); setFilterStatus(''); }}
              className="mt-2 text-xs text-primary hover:text-primary/80 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <SectionHeading className="text-xs mb-2">Execution History ({executions.length})</SectionHeading>
          {executions.map((exec) => (
            <CloudExecutionRow
              key={exec.id}
              exec={exec}
              personaName={personaName(exec.persona_id)}
              isExpanded={expandedId === exec.id}
              onToggle={() => setExpandedId(expandedId === exec.id ? null : exec.id)}
              output={outputMap[exec.id]}
              onFetchOutput={() => fetchOutput(exec.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}