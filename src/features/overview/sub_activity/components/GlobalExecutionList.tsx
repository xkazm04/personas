import { useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Loader2, RefreshCw, BarChart3, Bot, Plus, BookOpen } from 'lucide-react';
import { MotionEmptyState } from '@/features/overview/shared/emptyStatePrototype';
import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { FilterBar } from '@/features/shared/components/overlays/FilterBar';
import { ExecutionMetricsDashboard } from './ExecutionMetricsDashboard';

import { ExecutionDetailModal } from '@/features/shared/components/modals/ExecutionDetailModal';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { PersonaColumnFilter } from '@/features/shared/components/forms/PersonaColumnFilter';
import { ColumnDropdownFilter } from '@/features/shared/components/forms/ColumnDropdownFilter';
import { SortableColumnHeader, type SortDirection } from '@/features/shared/components/forms/SortableColumnHeader';
import { useColumnWidths, ColumnResizeHandle } from '@/features/shared/components/display/ColumnResize';
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
// Note: FILTER_LABELS values are used at module scope; runtime t() calls below.

// Ordered columns for the desktop grid. Widths are defaults — users can
// drag-resize them; overrides persist via useColumnWidths('overview-activity').
const EXEC_COLUMNS: { key: string; width: string }[] = [
  { key: 'persona', width: 'minmax(280px,2fr)' },
  { key: 'status', width: 'minmax(0,1fr)' },
  { key: 'duration', width: '120px' },
  { key: 'started', width: '160px' },
];
const EXEC_ROW_HEIGHT = 56;

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'running', label: 'Running' },
];

interface GlobalExecutionListProps {
  /** Extra action buttons to render in the header (left of Metrics/Refresh) */
  headerActions?: React.ReactNode;
}

export default function GlobalExecutionList({ headerActions }: GlobalExecutionListProps) {
  const { t, tx } = useTranslation();
  const {
    globalExecutions, globalExecutionsHasMore,
    globalExecutionsWarning, fetchGlobalExecutions,
    globalExecutionCounts, fetchGlobalExecutionCounts,
    pendingExecutionFocus, setPendingExecutionFocus,
  } = useOverviewStore(useShallow((s) => ({
    globalExecutions: s.globalExecutions,
    globalExecutionsHasMore: s.globalExecutionsHasMore,
    globalExecutionsWarning: s.globalExecutionsWarning,
    fetchGlobalExecutions: s.fetchGlobalExecutions,
    globalExecutionCounts: s.globalExecutionCounts,
    fetchGlobalExecutionCounts: s.fetchGlobalExecutionCounts,
    pendingExecutionFocus: s.pendingExecutionFocus,
    setPendingExecutionFocus: s.setPendingExecutionFocus,
  })));
  const personas = useAgentStore((s) => s.personas);

  const [filter, setFilter] = useState<FilterStatus>('all');
  const { selectedPersonaId } = useOverviewFilterValues();
  const { setSelectedPersonaId } = useOverviewFilterActions();
  const [selectedExec, setSelectedExec] = useState<GlobalExecution | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

  const [startedSort, setStartedSort] = useState<SortDirection>(null);

  const toggleStartedSort = useCallback(() => {
    setStartedSort((d) => d === null ? 'desc' : d === 'desc' ? 'asc' : null);
  }, []);

  const { filtered: personaFiltered } = useFilteredCollection(globalExecutions, {
    exact: [{ field: 'persona_id', value: selectedPersonaId || null }],
  });

  // Server-side counts — precise totals for the filter badges, independent
  // of whichever status/page is currently loaded. Falls back to zero until
  // the first fetch completes.
  const statusCounts: Record<FilterStatus, number> = {
    all: globalExecutionCounts.total,
    running: globalExecutionCounts.running,
    completed: globalExecutionCounts.completed,
    failed: globalExecutionCounts.failed,
  };

  const statusPredicate = useCallback((e: GlobalExecution) =>
    filter === 'running' ? e.status === 'running' || e.status === 'pending' : e.status === filter,
    [filter]);

  const { filtered: statusFiltered } = useFilteredCollection(personaFiltered, {
    custom: [filter !== 'all' ? statusPredicate : null],
  });

  const filteredExecutions = useMemo(() => {
    if (startedSort === null) return statusFiltered;
    const tsMap = new Map<string, number>();
    for (const e of statusFiltered) {
      tsMap.set(e.id, new Date(e.started_at || e.created_at).getTime());
    }
    const sorted = [...statusFiltered].sort((a, b) => {
      const ta = tsMap.get(a.id) ?? 0;
      const tb = tsMap.get(b.id) ?? 0;
      return startedSort === 'asc' ? ta - tb : tb - ta;
    });
    return sorted;
  }, [statusFiltered, startedSort]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      const statusParam = filter === 'all' ? undefined : filter;
      try {
        await Promise.all([
          fetchGlobalExecutions(true, statusParam),
          fetchGlobalExecutionCounts(selectedPersonaId || undefined),
        ]);
      }
      finally { if (active) setIsLoading(false); }
    };
    load();
    return () => { active = false; };
  }, [filter, fetchGlobalExecutions, fetchGlobalExecutionCounts, selectedPersonaId]);

  // Pop the ExecutionDetailModal when a notification click parks an
  // execution id in `pendingExecutionFocus`. If the row isn't loaded yet
  // we trigger a fresh fetch; the next render that includes the row will
  // re-fire this effect and open the modal. The focus is cleared once
  // the modal opens so the same id can't loop on remount.
  useEffect(() => {
    if (!pendingExecutionFocus) return;
    const match = globalExecutions.find((e) => e.id === pendingExecutionFocus);
    if (match) {
      setSelectedExec(match);
      setPendingExecutionFocus(null);
      return;
    }
    // Not loaded yet — kick a one-off fetch and let the next render handle it.
    void fetchGlobalExecutions(true).catch(() => {});
  }, [pendingExecutionFocus, globalExecutions, fetchGlobalExecutions, setPendingExecutionFocus]);

  const hasRunning = useMemo(
    () => globalExecutions.some((e) => e.status === 'running' || e.status === 'pending'),
    [globalExecutions],
  );

  const pollFetch = useCallback(async () => {
    const statusParam = filter === 'all' ? undefined : filter;
    await fetchGlobalExecutions(true, statusParam);
    await fetchGlobalExecutionCounts(selectedPersonaId || undefined);
  }, [filter, fetchGlobalExecutions, fetchGlobalExecutionCounts, selectedPersonaId]);

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
      await Promise.all([
        fetchGlobalExecutions(true, statusParam),
        fetchGlobalExecutionCounts(selectedPersonaId || undefined),
      ]);
    } finally { setIsRefreshing(false); }
  };

  const hasMore = globalExecutionsHasMore;
  const { parentRef, virtualizer } = useVirtualList(filteredExecutions, EXEC_ROW_HEIGHT);
  const colWidths = useColumnWidths('overview-activity');
  const execGridTemplate = colWidths.template(EXEC_COLUMNS);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Loader2 className="w-5 h-5 text-blue-400" />}
        iconColor="blue"
        title={t.overview.activity.title}
        subtitle={globalExecutionCounts.total !== 1 ? tx(t.overview.activity.recorded, { count: globalExecutionCounts.total }) : tx(t.overview.activity.recorded_one, { count: globalExecutionCounts.total })}
        actions={
          <div className="flex items-center gap-2">
            {headerActions}
            {/* Metrics + Refresh are only meaningful once executions exist —
                hide both when the app has recorded none (empty state). */}
            {globalExecutionCounts.total > 0 && (
              <>
                <button
                  onClick={() => setShowDashboard(!showDashboard)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-modal transition-colors ${showDashboard ? 'text-blue-400 bg-blue-500/15 border border-blue-500/25' : 'text-foreground hover:text-muted-foreground bg-secondary/30 hover:bg-secondary/50 border border-primary/15'}`}
                  title={showDashboard ? t.overview.activity.show_list : t.overview.activity.show_metrics}
                >
                  <BarChart3 className="w-5 h-5" />
                  <span className="typo-body font-medium">{showDashboard ? t.overview.activity.list : t.overview.activity.metrics}</span>
                </button>
                <button
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal text-foreground hover:text-muted-foreground bg-secondary/30 hover:bg-secondary/50 border border-primary/15 disabled:opacity-60 transition-colors"
                  title={t.common.refresh}
                >
                  <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
                  <span className="typo-body font-medium">{t.common.refresh}</span>
                </button>
              </>
            )}
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
            summary={tx(t.overview.activity.showing, { count: filteredExecutions.length, total: globalExecutionCounts.total })}
          />

          {globalExecutionsWarning && (
            <div className="mx-4 md:mx-6 mt-3 rounded-modal border border-amber-500/25 bg-amber-500/10 px-3 py-2 typo-body text-amber-300/90" role="status" aria-live="polite">
              {globalExecutionsWarning}
            </div>
          )}

          <ContentBody flex>
            {isLoading ? (
              null
            ) : filteredExecutions.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-4 md:p-6">
                <MotionEmptyState
                  motif="activity"
                  content={{
                    icon: Bot,
                    title: personas.length === 0 ? t.overview.activity.no_agents : t.overview.activity.no_executions,
                    subtitle: personas.length === 0 ? t.overview.activity.no_agents_hint : t.overview.activity.no_executions_hint,
                    action: { label: t.overview.activity.create_persona, onClick: () => useSystemStore.getState().setSidebarSection('personas'), icon: Plus },
                    secondaryAction: { label: t.overview.activity.from_templates, onClick: () => useSystemStore.getState().setSidebarSection('design-reviews'), icon: BookOpen },
                  }}
                />
              </div>
            ) : (
              <div ref={parentRef} className={`flex-1 overflow-y-auto ${colWidths.isResizing ? 'select-none cursor-col-resize' : ''}`}>
                {!IS_MOBILE && (
                  <div role="row" className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-primary/10 grid" style={{ gridTemplateColumns: execGridTemplate }}>
                    <div role="columnheader" className="relative px-4 py-1.5 flex items-center">
                      <PersonaColumnFilter value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />
                      <ColumnResizeHandle
                        label={t.shared.resize_column}
                        onBeginResize={(w, x) => colWidths.beginResize('persona', w, x)}
                        onReset={() => colWidths.clearColumn('persona')}
                      />
                    </div>
                    <div role="columnheader" className="relative px-4 py-1.5 flex items-center">
                      <ColumnDropdownFilter
                        label="Status"
                        value={filter}
                        options={STATUS_FILTER_OPTIONS}
                        onChange={(v) => setFilter(v as FilterStatus)}
                      />
                      <ColumnResizeHandle
                        label={t.shared.resize_column}
                        onBeginResize={(w, x) => colWidths.beginResize('status', w, x)}
                        onReset={() => colWidths.clearColumn('status')}
                      />
                    </div>
                    <div role="columnheader" className="relative flex items-center justify-end px-4 py-1.5 typo-label text-foreground">
                      {t.overview.activity.col_duration}
                      <ColumnResizeHandle
                        label={t.shared.resize_column}
                        onBeginResize={(w, x) => colWidths.beginResize('duration', w, x)}
                        onReset={() => colWidths.clearColumn('duration')}
                      />
                    </div>
                    <div role="columnheader" className="flex items-center justify-end px-4 py-1.5">
                      <SortableColumnHeader label={t.overview.activity.col_started} direction={startedSort} onToggle={toggleStartedSort} />
                    </div>
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
                        className="px-3 py-2 border-b border-primary/[0.06] active:bg-white/[0.05]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <PersonaIcon icon={exec.persona_icon ?? null} color={exec.persona_color ?? null} display="framed" frameSize={"lg"} />
                            <span className="typo-heading text-foreground truncate">{exec.persona_name || 'Unknown'}</span>
                          </div>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-card typo-caption flex-shrink-0 ${badgeClass(status)}`}>
                            {status.pulse && (<span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" /></span>)}
                            {status.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 typo-caption text-foreground">
                          <span className="font-mono">{formatDuration(exec.duration_ms)}</span>
                          <span>{formatRelativeTime(exec.started_at || exec.created_at)}</span>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={exec.id} role="row" tabIndex={0}
                        onClick={() => setSelectedExec(exec)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedExec(exec); } }}
                        style={{ position: 'absolute', top: 0, transform: `translateY(${virtualRow.start}px)`, width: '100%', height: `${virtualRow.size}px`, gridTemplateColumns: execGridTemplate }}
                        className={`grid items-center cursor-pointer transition-colors border-b border-primary/[0.06] border-l-2 ${borderAccent} hover:bg-white/[0.05] ${virtualRow.index % 2 === 0 ? 'bg-white/[0.015]' : ''}`}
                      >
                        <div className="flex items-center gap-2 px-4 min-w-0">
                          <PersonaIcon icon={exec.persona_icon ?? null} color={exec.persona_color ?? null} display="framed" frameSize={"lg"} />
                          <span className="typo-body text-foreground truncate">{exec.persona_name || 'Unknown'}</span>
                        </div>
                        <div className="px-4">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-card typo-heading ${badgeClass(status)}`}>
                            {status.pulse && (<span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" /></span>)}
                            {status.label}
                          </span>
                        </div>
                        <div className="px-4 text-right"><span className="typo-code text-foreground font-mono">{formatDuration(exec.duration_ms)}</span></div>
                        <div className="px-4 text-right"><span className="typo-body text-foreground">{formatRelativeTime(exec.started_at || exec.created_at)}</span></div>
                      </div>
                    );
                  })}
                </div>

                {hasMore && (
                  <div className="pt-3 pb-2 text-center">
                    <button onClick={handleLoadMore} className="px-4 py-2 typo-heading text-foreground hover:text-muted-foreground bg-secondary/30 hover:bg-secondary/50 rounded-modal border border-primary/15 transition-all">
                      {t.overview.activity.load_more}
                    </button>
                  </div>
                )}
              </div>
            )}
          </ContentBody>
        </>
      )}

      {selectedExec && (
        <ExecutionDetailModal execution={selectedExec} onClose={() => setSelectedExec(null)} />
      )}
    </ContentBox>
  );
}
