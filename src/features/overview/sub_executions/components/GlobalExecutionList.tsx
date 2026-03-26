import { useEffect, useState, useMemo, useCallback } from 'react';
import { Loader2, RefreshCw, BarChart3, Bot } from 'lucide-react';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from "@/stores/agentStore";
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { FilterBar } from '@/features/shared/components/overlays/FilterBar';
import { ExecutionMetricsDashboard } from './ExecutionMetricsDashboard';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { ExecutionDetail } from '@/features/agents/sub_executions';
import { formatDuration, formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import type { GlobalExecution } from '@/lib/types/types';
import { useOverviewFilterValues, useOverviewFilterActions } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useFilteredCollection } from '@/hooks/utility/data/useFilteredCollection';

import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';

type FilterStatus = 'all' | 'running' | 'completed' | 'failed';

const FILTER_LABELS: Record<FilterStatus, string> = {
  all: 'All', running: 'Running', completed: 'Completed', failed: 'Failed',
};

export default function GlobalExecutionList() {
  const {
    globalExecutions, globalExecutionsTotal, globalExecutionsOffset,
    globalExecutionsWarning, fetchGlobalExecutions,
  } = useOverviewStore(useShallow((s) => ({
    globalExecutions: s.globalExecutions,
    globalExecutionsTotal: s.globalExecutionsTotal,
    globalExecutionsOffset: s.globalExecutionsOffset,
    globalExecutionsWarning: s.globalExecutionsWarning,
    fetchGlobalExecutions: s.fetchGlobalExecutions,
  })));
  const personas = useAgentStore((s) => s.personas);

  const [filter, setFilter] = useState<FilterStatus>('all');
  const { selectedPersonaId } = useOverviewFilterValues();
  const { setSelectedPersonaId } = useOverviewFilterActions();
  const [selectedExec, setSelectedExec] = useState<GlobalExecution | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

  const { filtered: personaFiltered } = useFilteredCollection(globalExecutions, {
    exact: [{ field: 'persona_id', value: selectedPersonaId || null }],
  });

  const statusCounts = useMemo(() => {
    const counts: Record<FilterStatus, number> = { all: personaFiltered.length, running: 0, completed: 0, failed: 0 };
    for (const exec of personaFiltered) {
      if (exec.status === 'running' || exec.status === 'pending') counts.running++;
      else if (exec.status === 'completed') counts.completed++;
      else if (exec.status === 'failed') counts.failed++;
    }
    return counts;
  }, [personaFiltered]);

  const statusPredicate = useCallback((e: GlobalExecution) =>
    filter === 'running' ? e.status === 'running' || e.status === 'pending' : e.status === filter,
  [filter]);

  const { filtered: filteredExecutions } = useFilteredCollection(personaFiltered, {
    custom: [filter !== 'all' ? statusPredicate : null],
  });

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      const statusParam = filter === 'all' ? undefined : filter;
      try { await fetchGlobalExecutions(true, statusParam); }
      finally { if (active) setIsLoading(false); }
    };
    load();
    return () => { active = false; };
  }, [filter, fetchGlobalExecutions]);

  const hasRunning = useMemo(
    () => globalExecutions.some((e) => e.status === 'running' || e.status === 'pending'),
    [globalExecutions],
  );

  const pollFetch = useCallback(() => {
    const statusParam = filter === 'all' ? undefined : filter;
    return fetchGlobalExecutions(true, statusParam);
  }, [filter, fetchGlobalExecutions]);

  usePolling(pollFetch, {
    interval: POLLING_CONFIG.runningExecutions.interval,
    enabled: hasRunning,
    maxBackoff: POLLING_CONFIG.runningExecutions.maxBackoff,
  });

  const handleLoadMore = () => {
    const statusParam = filter === 'all' ? undefined : filter;
    fetchGlobalExecutions(false, statusParam);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const statusParam = filter === 'all' ? undefined : filter;
      await fetchGlobalExecutions(true, statusParam);
    } finally { setIsRefreshing(false); }
  };

  const hasMore = globalExecutionsOffset < globalExecutionsTotal;
  const { parentRef, virtualizer } = useVirtualList(filteredExecutions, 44);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Loader2 className="w-5 h-5 text-blue-400" />}
        iconColor="blue"
        title="Executions"
        subtitle={`${globalExecutionsTotal} execution${globalExecutionsTotal !== 1 ? 's' : ''} recorded`}
        actions={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowDashboard(!showDashboard)}
              className={`p-1.5 rounded-lg transition-colors ${showDashboard ? 'text-blue-400 bg-blue-500/15 border border-blue-500/25' : 'text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/50'}`}
              title={showDashboard ? 'Show execution list' : 'Show metrics dashboard'}
            >
              <BarChart3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/50 disabled:opacity-60 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      />

      {showDashboard ? (
        <ContentBody flex>
          <ExecutionMetricsDashboard onClose={() => setShowDashboard(false)} />
        </ContentBody>
      ) : (
        <>
          <FilterBar<FilterStatus>
            options={(['all', 'running', 'completed', 'failed'] as FilterStatus[]).map((id) => ({
              id, label: FILTER_LABELS[id], badge: statusCounts[id],
            }))}
            value={filter}
            onChange={setFilter}
            badgeStyle="paren"
            layoutIdPrefix="execution-filter"
            trailing={<PersonaSelect value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />}
            summary={`Showing ${filteredExecutions.length} of ${globalExecutionsTotal}`}
          />

          {globalExecutionsWarning && (
            <div className="mx-4 md:mx-6 mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-300/90" role="status" aria-live="polite">
              {globalExecutionsWarning}
            </div>
          )}

          <ContentBody flex>
            {isLoading ? (
              null
            ) : filteredExecutions.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-4 md:p-6">
                {personas.length === 0 ? (
                  <EmptyState
                    icon={Bot}
                    title="No agents created yet"
                    subtitle="Create your first agent to see execution activity here."
                  />
                ) : (
                  <EmptyState variant="dashboard-no-executions" />
                )}
              </div>
            ) : (
              <div ref={parentRef} className="flex-1 overflow-y-auto">
                {!IS_MOBILE && (
                  <table className="w-full border-collapse">
                    <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
                      <tr className="border-b border-primary/10">
                        <th className="text-left text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Persona</th>
                        <th className="text-left text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Status</th>
                        <th className="text-right text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Duration</th>
                        <th className="text-right text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">Started</th>
                        <th className="text-left text-sm text-muted-foreground/80 uppercase tracking-wider font-medium px-4 py-2.5">ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ height: `${virtualizer.getTotalSize()}px` }} aria-hidden><td colSpan={5} className="p-0" /></tr>
                    </tbody>
                  </table>
                )}

                <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', marginTop: IS_MOBILE ? undefined : `-${virtualizer.getTotalSize()}px` }}>
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const exec = filteredExecutions[virtualRow.index]!;
                    const status = getStatusEntry(exec.status);
                    const hoverAccent =
                      exec.status === 'running' || exec.status === 'pending' ? 'hover:border-l-blue-400'
                      : exec.status === 'completed' ? 'hover:border-l-emerald-400'
                      : exec.status === 'failed' ? 'hover:border-l-red-400'
                      : 'hover:border-l-amber-400';
                    return IS_MOBILE ? (
                      <div
                        key={exec.id} role="row" tabIndex={0}
                        onClick={() => setSelectedExec(exec)}
                        style={{ position: 'absolute', top: 0, transform: `translateY(${virtualRow.start}px)`, width: '100%', height: `${virtualRow.size}px` }}
                        className="px-3 py-2 border-b border-primary/[0.06] active:bg-white/[0.05]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="w-6 h-6 rounded-lg flex items-center justify-center text-sm border border-primary/15 flex-shrink-0" style={{ backgroundColor: (exec.persona_color || '#6366f1') + '15' }}>
                              {exec.persona_icon || '?'}
                            </div>
                            <span className="typo-heading text-foreground/80 truncate">{exec.persona_name || 'Unknown'}</span>
                          </div>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg typo-caption flex-shrink-0 ${badgeClass(status)}`}>
                            {status.pulse && (<span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" /></span>)}
                            {status.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground/70">
                          <span className="font-mono">{formatDuration(exec.duration_ms)}</span>
                          <span>{formatRelativeTime(exec.started_at || exec.created_at)}</span>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={exec.id} role="row" tabIndex={0}
                        onClick={() => setSelectedExec(exec)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedExec(exec); } }}
                        style={{ position: 'absolute', top: 0, transform: `translateY(${virtualRow.start}px)`, width: '100%', height: `${virtualRow.size}px` }}
                        className={`flex items-center cursor-pointer transition-colors border-b border-primary/[0.06] border-l-2 border-l-transparent hover:bg-white/[0.05] ${hoverAccent} ${virtualRow.index % 2 === 0 ? 'bg-white/[0.015]' : ''}`}
                      >
                        <div className="flex items-center gap-2 px-4 w-[25%] min-w-0">
                          <div className="w-6 h-6 rounded-lg flex items-center justify-center text-sm border border-primary/15 flex-shrink-0" style={{ backgroundColor: (exec.persona_color || '#6366f1') + '15' }}>
                            {exec.persona_icon || '?'}
                          </div>
                          <span className="typo-heading text-foreground/80 truncate">{exec.persona_name || 'Unknown'}</span>
                        </div>
                        <div className="px-4 w-[20%]">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg typo-heading ${badgeClass(status)}`}>
                            {status.pulse && (<span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" /></span>)}
                            {status.label}
                          </span>
                        </div>
                        <div className="px-4 w-[15%] text-right"><span className="text-sm text-muted-foreground/90 font-mono">{formatDuration(exec.duration_ms)}</span></div>
                        <div className="px-4 w-[20%] text-right"><span className="text-sm text-muted-foreground/80">{formatRelativeTime(exec.started_at || exec.created_at)}</span></div>
                        <div className="px-4 w-[20%] min-w-0"><span className="text-sm text-muted-foreground/60 font-mono truncate block">{exec.id.slice(0, 8)}</span></div>
                      </div>
                    );
                  })}
                </div>

                {hasMore && (
                  <div className="pt-3 pb-2 text-center">
                    <button onClick={handleLoadMore} className="px-4 py-2 typo-heading text-muted-foreground/80 hover:text-muted-foreground bg-secondary/30 hover:bg-secondary/50 rounded-xl border border-primary/15 transition-all">
                      Load More
                    </button>
                  </div>
                )}
              </div>
            )}
          </ContentBody>
        </>
      )}

      {selectedExec && (
        <DetailModal title={`${selectedExec.persona_name || 'Unknown'} - Execution`} subtitle={`ID: ${selectedExec.id}`} onClose={() => setSelectedExec(null)}>
          <ExecutionDetail execution={selectedExec} />
        </DetailModal>
      )}
    </ContentBox>
  );
}
