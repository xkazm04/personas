import { useCallback, useRef, useState } from 'react';
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
  const fetchOutput = useCallback(async (execId: string) => {
    if (fetchingRef.current.has(execId)) return;
    fetchingRef.current.add(execId);
    setOutputMap((prev) => ({ ...prev, [execId]: { lines: [], loading: true } }));
    try {
      const lines = await cloudGetExecutionOutput(execId);
      setOutputMap((prev) => ({ ...prev, [execId]: { lines, loading: false } }));
    } catch (e) {
      setOutputMap((prev) => ({
        ...prev,
        [execId]: { lines: [], loading: false, error: e instanceof Error ? e.message : 'Failed to fetch output' },
      }));
    } finally {
      fetchingRef.current.delete(execId);
    }
  }, []);

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
          className="px-3 py-1.5 text-sm rounded-xl bg-secondary/40 border border-primary/15 text-foreground/80 focus-visible:outline-none focus-visible:border-indigo-500/40 transition-colors"
        >
          <option value="">All personas</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-xl bg-secondary/40 border border-primary/15 text-foreground/80 focus-visible:outline-none focus-visible:border-indigo-500/40 transition-colors"
        >
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <select
          value={period}
          onChange={(e) => setPeriod(Number(e.target.value))}
          className="px-3 py-1.5 text-sm rounded-xl bg-secondary/40 border border-primary/15 text-foreground/80 focus-visible:outline-none focus-visible:border-indigo-500/40 transition-colors"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>

        {historyLastPolled != null && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60 ml-auto mr-2">
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
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-secondary/40 border border-primary/15 text-muted-foreground/80 hover:text-foreground/95 hover:border-primary/25 disabled:opacity-40 transition-colors cursor-pointer ${historyLastPolled == null ? 'ml-auto' : ''}`}
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
            <div key={i} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-red-500/5 border border-red-500/10">
              <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
              <span className="text-muted-foreground/80 truncate flex-1">{err.message}</span>
              <span className="text-red-400 font-medium shrink-0">{err.count}x</span>
            </div>
          ))}
        </div>
      )}

      {/* Execution table */}
      {executions.length === 0 ? (
        <p className="text-sm text-muted-foreground/90 py-8 text-center">
          {isLoading ? 'Loading execution history...' : 'No executions found for the selected filters.'}
        </p>
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