import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Loader2, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, XCircle, Ban } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { cloudListExecutions, cloudExecutionStats } from '@/api/cloud';
import type { CloudExecution, CloudExecutionStats } from '@/api/cloud';
import { DEPLOYMENT_TOKENS } from './deploymentTokens';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusIcon(status: string) {
  switch (status) {
    case 'completed': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case 'failed': return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    case 'cancelled': return <Ban className="w-3.5 h-3.5 text-amber-400" />;
    default: return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />;
  }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatCost(usd: number | null): string {
  if (usd == null || usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CloudHistoryPanel() {
  const personas = usePersonaStore((s) => s.personas);
  const [executions, setExecutions] = useState<CloudExecution[]>([]);
  const [stats, setStats] = useState<CloudExecutionStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterPersona, setFilterPersona] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [period, setPeriod] = useState<number>(7);

  const personaName = useCallback(
    (id: string) => personas.find((p) => p.id === id)?.name ?? id.slice(0, 8),
    [personas],
  );

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
      // Errors handled silently â€” panel shows empty state
    } finally {
      setIsLoading(false);
    }
  }, [filterPersona, filterStatus, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

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

      {/* Filters */}
      <div className="flex items-center gap-3">
        <select
          value={filterPersona}
          onChange={(e) => setFilterPersona(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-xl bg-secondary/40 border border-primary/15 text-foreground/80 focus:outline-none focus:border-indigo-500/40 transition-colors"
        >
          <option value="">All personas</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-xl bg-secondary/40 border border-primary/15 text-foreground/80 focus:outline-none focus:border-indigo-500/40 transition-colors"
        >
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <select
          value={period}
          onChange={(e) => setPeriod(Number(e.target.value))}
          className="px-3 py-1.5 text-sm rounded-xl bg-secondary/40 border border-primary/15 text-foreground/80 focus:outline-none focus:border-indigo-500/40 transition-colors"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>

        <button
          onClick={fetchData}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-secondary/40 border border-primary/15 text-muted-foreground/80 hover:text-foreground/95 hover:border-primary/25 disabled:opacity-40 transition-colors cursor-pointer ml-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Top errors */}
      {stats && stats.top_errors.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground/90 uppercase tracking-wider">
            Top Errors
          </h3>
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
          <h3 className="text-xs font-medium text-muted-foreground/90 uppercase tracking-wider mb-2">
            Execution History ({executions.length})
          </h3>
          {executions.map((exec) => {
            const isExpanded = expandedId === exec.id;

            return (
              <div key={exec.id} className="rounded-lg bg-secondary/30 border border-primary/10 overflow-hidden">
                {/* Row */}
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : exec.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-secondary/50 transition-colors cursor-pointer"
                >
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/60" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />}
                  {statusIcon(exec.status)}
                  <span className="text-sm text-foreground/80 truncate flex-1">{personaName(exec.persona_id)}</span>
                  <span className="text-xs text-muted-foreground/60">{formatDuration(exec.duration_ms)}</span>
                  <span className="text-xs text-muted-foreground/60">{formatCost(exec.cost_usd)}</span>
                  <span className="text-xs text-muted-foreground/50">{timeAgo(exec.created_at)}</span>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-primary/10 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-muted-foreground/60">Status:</span> <span className="text-foreground/80">{exec.status}</span></div>
                      <div><span className="text-muted-foreground/60">Duration:</span> <span className="text-foreground/80">{formatDuration(exec.duration_ms)}</span></div>
                      <div><span className="text-muted-foreground/60">Cost:</span> <span className="text-foreground/80">{formatCost(exec.cost_usd)}</span></div>
                      <div><span className="text-muted-foreground/60">Tokens:</span> <span className="text-foreground/80">{(exec.input_tokens ?? 0) + (exec.output_tokens ?? 0)}</span></div>
                      <div><span className="text-muted-foreground/60">Started:</span> <span className="text-foreground/80">{exec.started_at ? new Date(exec.started_at).toLocaleString() : '-'}</span></div>
                      <div><span className="text-muted-foreground/60">Completed:</span> <span className="text-foreground/80">{exec.completed_at ? new Date(exec.completed_at).toLocaleString() : '-'}</span></div>
                    </div>
                    {exec.error_message && (
                      <div className="p-2 rounded-lg bg-red-500/5 border border-red-500/10 text-xs text-red-400">
                        {exec.error_message}
                      </div>
                    )}
                    {exec.input_data && (
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground/60">Input:</span>
                        <pre className="text-xs text-foreground/70 bg-secondary/40 p-2 rounded-lg overflow-auto max-h-32 border border-primary/10">
                          {exec.input_data}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card sub-component
// ---------------------------------------------------------------------------

function StatCard({ label, value, color }: { label: string; value: string; color?: 'emerald' | 'amber' | 'red' }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
  };

  return (
    <div className="p-3 rounded-xl bg-secondary/30 border border-primary/10 text-center">
      <p className="text-xs text-muted-foreground/70 mb-1">{label}</p>
      <p className={`text-lg font-semibold ${color ? colorMap[color] : 'text-foreground/90'}`}>{value}</p>
    </div>
  );
}
