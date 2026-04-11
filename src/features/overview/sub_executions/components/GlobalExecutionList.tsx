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
import { useTranslation } from '@/i18n/useTranslation';

import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { ExecutionDetail } from '@/features/agents/sub_executions';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { formatDuration, formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import type { GlobalExecution } from '@/lib/types/types';
import { useOverviewFilterValues, useOverviewFilterActions } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useFilteredCollection } from '@/hooks/utility/data/useFilteredCollection';

import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';

type FilterStatus = 'all' | 'running' | 'completed' | 'failed';

const EXEC_GRID_COLUMNS = 'minmax(280px,2fr) minmax(0,1fr) 120px 140px 120px';

interface GlobalExecutionListProps {
  /** Extra action buttons to render in the header (left of Metrics/Refresh) */
  headerActions?: React.ReactNode;
}

export default function GlobalExecutionList({ headerActions }: GlobalExecutionListProps) {
  const { t, tx } = useTranslation();
  const FILTER_LABELS: Record<FilterStatus, string> = {
    all: t.overview.execution_list.filter_all, running: t.overview.execution_list.filter_running, completed: t.overview.execution_list.filter_completed, failed: t.overview.execution_list.filter_failed,
  };
  const STATUS_FILTER_OPTIONS = [
    { value: 'all', label: t.overview.execution_list.all_statuses },
    { value: 'running', label: t.overview.execution_list.filter_running },
    { value: 'completed', label: t.overview.execution_list.filter_completed },
    { value: 'failed', label: t.overview.execution_list.filter_failed },
  ];
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

  const personaFilterOptions = useMemo(() => [
    { value: '', label: t.overview.execution_list.all_personas },
    ...personas.map((p) => ({ value: p.id, label: p.name })),
  ], [personas, t]);

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
        title={t.overview.executions.title}
        subtitle={tx(globalExecutionsTotal === 1 ? t.overview.execution_list.recorded_one : t.overview.execution_list.recorded, { count: globalExecutionsTotal })}
        actions={
          <div className="flex items-center gap-2">
            {headerActions}
            <button
              onClick={() => setShowDashboard(!showDashboard)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-colors ${showDashboard ? 'text-blue-400 bg-blue-500/15 border border-blue-500/25' : 'text-muted-foreground/80 hover:text-muted-foreground bg-secondary/30 hover:bg-secondary/50 border border-primary/15'}`}
              title={showDashboard ? t.overview.execution_list.show_list : t.overview.execution_list.show_metrics}
            >
              <BarChart3 className="w-5 h-5" />
              <span className="text-sm font-medium">{showDashboard ? t.overview.execution_list.list : t.overview.execution_list.metrics}</span>
            </button>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-muted-foreground/80 hover:text-muted-foreground bg-secondary/30 hover:bg-secondary/50 border border-primary/15 disabled:opacity-60 transition-colors"
              title={t.common.refresh}
            >
              <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="text-sm font-medium">{t.common.refresh}</span>
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
            summary={tx(t.overview.execution_list.showing, { count: filteredExecutions.length, total: globalExecutionsTotal })}
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
                    title={t.overview.execution_list.no_agents}
                    subtitle={t.overview.execution_list.no_agents_hint}
                  />
                ) : (
                  <EmptyState variant="dashboard-no-executions" />
                )}
              </div>
            ) : (
              <div ref={parentRef} className="flex-1 overflow-y-auto">
                {!IS_MOBILE && (
                  <div role="row" className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-primary/10 grid" style={{ gridTemplateColumns: EXEC_GRID_COLUMNS }}>
                    <div role="columnheader" className="px-4 py-1.5">
                      <ThemedSelect
                        filterable
                        options={personaFilterOptions}
                        value={selectedPersonaId}
                        onValueChange={setSelectedPersonaId}
                        placeholder={t.overview.execution_list.col_persona}
                        className="!px-2 !py-0 !rounded-lg !border-transparent !bg-transparent hover:!bg-secondary/30 hover:!text-foreground typo-label"
                      />
                    </div>
                    <div role="columnheader" className="px-4 py-1.5">
                      <ThemedSelect
                        filterable
                        options={STATUS_FILTER_OPTIONS}
                        value={filter}
                        onValueChange={(v) => setFilter(v as FilterStatus)}
                        placeholder={t.overview.execution_list.col_status}
                        className="!px-2 !py-0 !rounded-lg !border-transparent !bg-transparent hover:!bg-secondary/30 hover:!text-foreground typo-label"
                      />
                    </div>
                    <div role="columnheader" className="flex items-center justify-end px-4 py-1.5 typo-label text-foreground/80">{t.overview.execution_list.col_duration}</div>
                    <div role="columnheader" className="flex items-center justify-end px-4 py-1.5 typo-label text-foreground/80">{t.overview.execution_list.col_started}</div>
                    <div role="columnheader" className="flex items-center px-4 py-1.5 typo-label text-foreground/80">{t.common.id}</div>
                  </div>
                )}

                <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const exec = filteredExecutions[virtualRow.index]!;
                    const status = getStatusEntry(exec.status);
                    const borderAccent =
                      exec.status === 'running' || exec.status === 'pending' ? 'border-l-blue-400'
                        : exec.status === 'completed' ? 'border-l-emerald-400'
                          : exec.status === 'failed' ? 'border-l-red-400'
                            : 'border-l-amber-400';
                    return IS_MOBILE ? (
                      <div
                        key={exec.id} role="row" tabIndex={0}
                        onClick={() => setSelectedExec(exec)}
                        style={{ position: 'absolute', top: 0, transform: `translateY(${virtualRow.start}px)`, width: '100%', height: `${virtualRow.size}px` }}
                        className="px-3 py-2 border-b border-primary/[0.06] active:bg-primary/[0.08]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <PersonaIcon icon={exec.persona_icon ?? null} color={exec.persona_color ?? null} display="framed" frameSize={"lg"} />
                            <span className="typo-heading text-foreground/80 truncate">{exec.persona_name || t.overview.execution_list.unknown_persona}</span>
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
                        style={{ position: 'absolute', top: 0, transform: `translateY(${virtualRow.start}px)`, width: '100%', height: `${virtualRow.size}px`, gridTemplateColumns: EXEC_GRID_COLUMNS }}
                        className={`grid items-center cursor-pointer transition-colors border-b border-primary/[0.06] border-l-2 ${borderAccent} hover:bg-primary/[0.08] ${virtualRow.index % 2 === 0 ? 'bg-primary/[0.03]' : ''}`}
                      >
                        <div className="flex items-center gap-2 px-4 min-w-0">
                          <PersonaIcon icon={exec.persona_icon ?? null} color={exec.persona_color ?? null} display="framed" frameSize={"lg"} />
                          <span className="text-sm text-muted-foreground/80 truncate">{exec.persona_name || t.overview.execution_list.unknown_persona}</span>
                        </div>
                        <div className="px-4">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg typo-heading ${badgeClass(status)}`}>
                            {status.pulse && (<span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" /></span>)}
                            {status.label}
                          </span>
                        </div>
                        <div className="px-4 text-right"><span className="text-sm text-muted-foreground/90 font-mono">{formatDuration(exec.duration_ms)}</span></div>
                        <div className="px-4 text-right"><span className="text-sm text-muted-foreground/80">{formatRelativeTime(exec.started_at || exec.created_at)}</span></div>
                        <div className="px-4 min-w-0"><span className="text-sm text-muted-foreground/60 font-mono truncate block">{exec.id.slice(0, 8)}</span></div>
                      </div>
                    );
                  })}
                </div>

                {hasMore && (
                  <div className="pt-3 pb-2 text-center">
                    <button onClick={handleLoadMore} className="px-4 py-2 typo-heading text-muted-foreground/80 hover:text-muted-foreground bg-secondary/30 hover:bg-secondary/50 rounded-xl border border-primary/15 transition-all">
                      {t.overview.execution_list.load_more}
                    </button>
                  </div>
                )}
              </div>
            )}
          </ContentBody>
        </>
      )}

      {selectedExec && (
        <DetailModal title={`${selectedExec.persona_name || t.overview.execution_list.unknown_persona} - ${t.overview.executions.title}`} subtitle={`${t.common.id}: ${selectedExec.id}`} onClose={() => setSelectedExec(null)}>
          <ExecutionDetail execution={selectedExec} />
        </DetailModal>
      )}
    </ContentBox>
  );
}
