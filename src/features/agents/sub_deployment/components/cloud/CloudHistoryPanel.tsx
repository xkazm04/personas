import { useTranslation } from '@/i18n/useTranslation';
import { useCallback, useRef, useState, useEffect } from 'react';
import { RefreshCw, AlertTriangle, X } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { LiveStatusDot } from '@/features/shared/components/display/LiveStatusDot';
import { CloudExecutionRow } from './CloudExecutionRow';
import { useAgentStore } from "@/stores/agentStore";
import { usePersonaNameMap } from "@/hooks/usePersonaNameMap";
import { cloudListExecutions, cloudExecutionStats, cloudGetExecutionOutput, cloudListDeployments } from '@/api/system/cloud';
import type { CloudExecution, CloudExecutionStats, CloudDeployment } from '@/api/system/cloud';
import { DEPLOYMENT_TOKENS } from '../deploymentTokens';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import { formatDuration, formatCost, classifyExecutionStatus, matchesErrorCluster, monthlyBudgetRollup, budgetTone, projectMonthEndSpend } from './CloudHistoryHelpers';
import { formatNumeric } from '@/lib/utils/formatters';
import { StatCard } from './StatCard';
import { DailyBreakdownChart } from './DailyBreakdownChart';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { RevealItem } from '@/features/shared/components/display/RevealItem';

const EXEC_CASCADE_ROWS = 14;


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CloudHistoryPanel() {
  const { t, tx } = useTranslation();
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
  // The top-error cluster the operator drilled into, or null. Purely a client
  // filter over the page already fetched - the stats panel computed the
  // clusters, so clicking one must not cost another round trip.
  const [errorCluster, setErrorCluster] = useState<string | null>(null);
  // Deployments carry the monthly caps. Read once on mount (not on the history
  // poll) - a cap changes when the operator edits it, not every 30 seconds.
  const [deployments, setDeployments] = useState<CloudDeployment[]>([]);

  // True once a fetch has failed and no later one has succeeded: the rows on
  // screen are the last good snapshot, not the current one.
  const [stale, setStale] = useState(false);

  // `source` names who asked, because the error door differs: a user-pressed
  // Refresh earns a toast, a filter change or a poll tick a breadcrumb only.
  // A poll tick RETHROWS after reporting - `usePolling` only backs off and only
  // withholds `lastRefreshed` on a thrown error, so a catch here that swallowed
  // everything (as it did until 2026-09-07) kept the poller at full cadence
  // against a dead orchestrator and kept the "Live" dot green over the last
  // good snapshot. The failed-poll trap of the registry's
  // transition-detection-and-notify technique: a failed poll yields NO
  // snapshot (the previous rows stay), and the display says so.
  const fetchData = useCallback(async (source: 'poll' | 'manual' | 'filter' = 'poll') => {
    setIsLoading(true);
    try {
      const [execs, st] = await Promise.all([
        cloudListExecutions(filterPersona || undefined, filterStatus || undefined, 50),
        cloudExecutionStats(filterPersona || undefined, period),
      ]);
      setExecutions(execs);
      setStats(st);
      setStale(false);
    } catch (err) {
      setStale(true);
      if (source === 'manual') toastCatch('features/deployment/components/cloud/CloudHistoryPanel:refresh')(err);
      else silentCatch('features/deployment/components/cloud/CloudHistoryPanel:catch1')(err);
      if (source === 'poll') throw err;
    } finally {
      setIsLoading(false);
    }
  }, [filterPersona, filterStatus, period]);

  const fetchingRef = useRef(new Set<string>());
  // A terminal execution's output is immutable, so its entry never expires
  // (the LRU cap is its only reaper); an in-flight execution's output is
  // still growing, so its entry ages out. Until 2026-09-07 every entry had
  // the 5-minute TTL AND the row's refresh control went through the same
  // cache read, so "refresh output" was a no-op for five minutes on exactly
  // the rows whose output was changing. Registry techniques:
  // deployment-history (terminal is immutable - cache accordingly) and
  // failure-drill-down (a running job's tail is a refreshing tail).
  const outputCacheRef = useRef(new Map<string, { lines: string[]; ts: number; terminal: boolean }>());
  const OUTPUT_CACHE_TTL = 5 * 60 * 1000;
  const OUTPUT_CACHE_MAX = 50;

  /** Evict aged in-flight entries, then trim oldest if over cap (LRU via Map insertion order). */
  const evictCache = useCallback(() => {
    const cache = outputCacheRef.current;
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (!entry.terminal && now - entry.ts >= OUTPUT_CACHE_TTL) cache.delete(key);
    }
    while (cache.size > OUTPUT_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
      else break;
    }
  }, [OUTPUT_CACHE_TTL]);

  const fetchOutput = useCallback(async (exec: CloudExecution, opts: { force?: boolean } = {}) => {
    const execId = exec.id;
    const terminal = classifyExecutionStatus(exec.status) !== 'in_flight';
    // Serve the cache unless the caller asked for a fresh read (re-insert to
    // mark as recently used). A terminal entry is fresh forever.
    const cached = outputCacheRef.current.get(execId);
    if (!opts.force && cached && (cached.terminal || Date.now() - cached.ts < OUTPUT_CACHE_TTL)) {
      outputCacheRef.current.delete(execId);
      outputCacheRef.current.set(execId, cached);
      setOutputMap((prev) => ({ ...prev, [execId]: { lines: cached.lines, loading: false } }));
      return;
    }
    if (fetchingRef.current.has(execId)) return;
    fetchingRef.current.add(execId);
    // A refresh keeps the lines on screen while the new read is in flight.
    setOutputMap((prev) => ({ ...prev, [execId]: { lines: prev[execId]?.lines ?? [], loading: true } }));
    try {
      const lines = await cloudGetExecutionOutput(execId);
      outputCacheRef.current.set(execId, { lines, ts: Date.now(), terminal });
      evictCache();
      setOutputMap((prev) => ({ ...prev, [execId]: { lines, loading: false } }));
    } catch (e) {
      setOutputMap((prev) => ({
        ...prev,
        [execId]: { lines: [], loading: false, error: e instanceof Error ? e.message : t.deployment.history.fetch_output_failed },
      }));
    } finally {
      fetchingRef.current.delete(execId);
    }
  }, [OUTPUT_CACHE_TTL, evictCache, t]);

  // Debounce filter-driven refetches to avoid API spam when iterating filters
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const debouncedFetchData = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void fetchData('filter'); }, 300);
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

  useEffect(() => {
    let cancelled = false;
    cloudListDeployments()
      .then((d) => { if (!cancelled) setDeployments(d); })
      .catch(silentCatch('features/deployment/components/cloud/CloudHistoryPanel:deployments'));
    return () => { cancelled = true; };
  }, []);

  // Month-to-date spend against the declared caps. Null when nothing has a cap.
  const budget = monthlyBudgetRollup(deployments);
  // Where that burn is heading by month end - the number an operator can still
  // act on. Null early in the month, when there is nothing to extrapolate from.
  const projected = budget ? projectMonthEndSpend(budget.spend) : null;
  const paceOverCap = budget != null && projected != null && projected > budget.cap;

  // Ghost rows only into cold emptiness while a fetch runs; settled-only
  // empty state. Row entrance cascades once per fresh result set — a poll
  // re-delivering the same ids never replays it (docs/design/overview-loading.md).
  const showGhost = isLoading && executions.length === 0;
  const enter = useRevealTracker(`${filterPersona}|${filterStatus}|${period}|${errorCluster ?? ''}`);

  // Drill-down over the fetched page. `executions` stays the fetch result so a
  // cleared chip restores the full list without a refetch.
  const visibleExecutions = errorCluster
    ? executions.filter((e) => matchesErrorCluster(e, errorCluster))
    : executions;
  const clearFilters = () => {
    setFilterPersona('');
    setFilterStatus('');
    setErrorCluster(null);
  };

  return (
    <div className={DEPLOYMENT_TOKENS.panelSpacing}>
      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 3xl:grid-cols-8 gap-3">
          <StatCard label={dt.history.total_runs} value={String(stats.totalExecutions)} />
          <StatCard
            label={dt.history.success_rate}
            value={stats.successRate != null ? formatNumeric(stats.successRate, 'ratio', { precision: 0 }) : '-'}
            color={stats.successRate != null && stats.successRate >= 0.9 ? 'emerald' : stats.successRate != null && stats.successRate >= 0.7 ? 'amber' : 'red'}
          />
          <StatCard label={dt.history.total_cost} value={formatCost(stats.totalCostUsd)} />
          <StatCard label={dt.history.avg_duration} value={formatDuration(stats.avgDurationMs == null ? null : Number(stats.avgDurationMs))} />
          {/* The cap the operator already set, beside the spend it governs.
              Its own card rather than an overlay on Total Cost, because that
              figure covers the selected 7/30/90-day window while the cap is a
              calendar month - two different predicates. Hidden entirely when
              no deployment declares a cap. */}
          {budget && (
            <StatCard
              label={dt.history.monthly_budget}
              value={`${formatCost(budget.spend)} / ${formatCost(budget.cap)}`}
              hint={projected != null ? tx(dt.history.monthly_budget_pace, { amount: formatCost(projected) }) : undefined}
              color={budgetTone(budget.pct, paceOverCap)}
            />
          )}
        </div>
      )}

      {/* Daily breakdown chart */}
      {stats && stats.dailyBreakdown.length > 0 && (
        <DailyBreakdownChart data={stats.dailyBreakdown.map((d) => ({
          date: d.date,
          count: Number(d.count),
          cost: d.cost,
          success_rate: d.successRate,
        }))} />
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <select
          value={filterPersona}
          onChange={(e) => setFilterPersona(e.target.value)}
          className="px-3 py-1.5 typo-body rounded-modal bg-secondary/40 border border-primary/15 text-foreground focus-visible:outline-none focus-visible:border-indigo-500/40 transition-colors"
        >
          <option value="">{dt.history.all_personas}</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-1.5 typo-body rounded-modal bg-secondary/40 border border-primary/15 text-foreground focus-visible:outline-none focus-visible:border-indigo-500/40 transition-colors"
        >
          <option value="">{dt.history.all_statuses}</option>
          <option value="completed">{dt.history.completed}</option>
          <option value="failed">{dt.history.failed}</option>
          <option value="cancelled">{dt.history.cancelled}</option>
        </select>

        <select
          value={period}
          onChange={(e) => setPeriod(Number(e.target.value))}
          className="px-3 py-1.5 typo-body rounded-modal bg-secondary/40 border border-primary/15 text-foreground focus-visible:outline-none focus-visible:border-indigo-500/40 transition-colors"
        >
          <option value={7}>{dt.history.last_7_days}</option>
          <option value={30}>{dt.history.last_30_days}</option>
          <option value={90}>{dt.history.last_90_days}</option>
        </select>

        {historyLastPolled != null && (
          <div className="flex items-center gap-2 typo-caption text-foreground ml-auto mr-2" data-testid="cloud-history-liveness" data-stale={stale ? 'true' : 'false'}>
            {/* Data age is honest state: after a failed poll the rows are the
                last good snapshot, and the indicator must not claim "Live". */}
            <LiveStatusDot tone={stale ? 'off' : 'active'} ping={!stale} size="sm" />
            {stale ? t.agents.health_check.stale : t.agents.executions.live}
          </div>
        )}
        <button
          type="button"
          onClick={() => { void fetchData('manual'); }}
          disabled={isLoading}
          className={`flex items-center gap-1.5 px-3 py-1.5 typo-body rounded-modal bg-secondary/40 border border-primary/15 text-foreground hover:text-foreground/95 hover:border-primary/25 disabled:opacity-40 transition-colors cursor-pointer ${historyLastPolled == null ? 'ml-auto' : ''}`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          {t.common.refresh}
        </button>
      </div>

      {/* Top errors */}
      {stats && stats.topErrors.length > 0 && (
        <div className="space-y-2">
          <SectionHeading className="typo-caption">{dt.history.top_errors}</SectionHeading>
          {stats.topErrors.map((cluster, i) => {
            const active = errorCluster === cluster.message;
            return (
              <button
                key={i}
                type="button"
                data-testid="cloud-top-error"
                aria-pressed={active}
                onClick={() => {
                  if (active) {
                    setErrorCluster(null);
                    return;
                  }
                  setErrorCluster(cluster.message);
                  setFilterStatus('failed');
                }}
                className={`w-full flex items-center gap-2 typo-caption p-2 rounded-card border text-left transition-colors focus-ring cursor-pointer ${
                  active
                    ? 'bg-red-500/15 border-red-500/30'
                    : 'bg-red-500/5 border-red-500/10 hover:bg-red-500/10'
                }`}
              >
                <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                <span className="text-foreground truncate flex-1">{cluster.message}</span>
                <span className="text-red-400 font-medium shrink-0">{cluster.count}x</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Active drill-down chip — the cluster the list is narrowed to. */}
      {errorCluster && (
        <div
          data-testid="cloud-error-cluster-chip"
          className="flex items-center gap-2 typo-caption px-2.5 py-1.5 rounded-card bg-red-500/10 border border-red-500/20"
        >
          <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
          <span className="text-foreground truncate flex-1">{errorCluster}</span>
          <button
            type="button"
            onClick={() => setErrorCluster(null)}
            aria-label={dt.history.clear_filters}
            className="shrink-0 rounded-interactive p-0.5 text-foreground hover:bg-foreground/10 transition-colors focus-ring cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Execution table — ghost rows only into cold emptiness while a fetch
          runs; settled-only empty state (docs/design/overview-loading.md). */}
      {showGhost ? (
        <div className="space-y-1">
          <CloudExecutionRowGhosts />
        </div>
      ) : visibleExecutions.length === 0 ? (
        <div className="py-8 text-center">
          <p className="typo-body text-foreground">
            {'No executions found for the selected filters.'}
          </p>
          {(filterPersona || filterStatus || errorCluster) && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-2 typo-caption text-primary hover:text-primary/80 transition-colors"
            >
              {dt.history.clear_filters}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <SectionHeading className="typo-caption mb-2">{dt.history.execution_history} ({visibleExecutions.length})</SectionHeading>
          {visibleExecutions.map((exec, index) => (
            // One-shot entrance cascade; rows past the first viewport render
            // plainly (folded into hasEntered); entered ids never replay.
            <RevealItem
              key={exec.id}
              revealId={exec.id}
              order={index}
              hasEntered={(id) => index >= EXEC_CASCADE_ROWS || enter.hasEntered(id)}
              markEntered={enter.markEntered}
            >
              <CloudExecutionRow
                exec={exec}
                personaName={personaName(exec.personaId)}
                isExpanded={expandedId === exec.id}
                onToggle={() => setExpandedId(expandedId === exec.id ? null : exec.id)}
                output={outputMap[exec.id]}
                onFetchOutput={() => fetchOutput(exec)}
                onRefreshOutput={() => fetchOutput(exec, { force: true })}
              />
            </RevealItem>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CloudExecutionRowGhosts — calm placeholder rows for the ONLY moment the
// execution list has nothing to show (a fetch with a cold/filtered list).
// Same row shape as `CloudExecutionRow`'s collapsed row. Delayed entrance
// (§C, docs/design/overview-loading.md); no `animate-pulse`.
// ---------------------------------------------------------------------------

function CloudExecutionRowGhosts() {
  return (
    <div aria-hidden="true" className="space-y-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-3 py-2 rounded-card bg-secondary/30 border border-primary/10 animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        >
          <span className="w-3.5 h-3.5 rounded-full bg-primary/[0.06]" />
          <span className="h-3.5 flex-1 max-w-[10rem] rounded bg-primary/[0.06]" />
          <span className="h-3 w-12 rounded bg-primary/[0.06]" />
          <span className="h-3 w-10 rounded bg-primary/[0.06]" />
          <span className="h-3 w-14 rounded bg-primary/[0.06]" />
        </div>
      ))}
    </div>
  );
}