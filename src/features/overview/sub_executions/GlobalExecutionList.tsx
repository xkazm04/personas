import { useEffect, useState, useMemo } from 'react';
import { Loader2, RefreshCw, BarChart3, Bot, Inbox } from 'lucide-react';
import { useVirtualList } from '@/hooks/utility/useVirtualList';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { ExecutionMetricsDashboard } from './ExecutionMetricsDashboard';
import { PersonaSelect } from '@/features/overview/sub_usage/DashboardFilters';
import DetailModal from '@/features/overview/components/DetailModal';
import { ExecutionDetail } from '@/features/agents/sub_executions/ExecutionDetail';
import { formatDuration, formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import type { GlobalExecution } from '@/lib/types/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FilterStatus = 'all' | 'running' | 'completed' | 'failed';

const filterOptions: Array<{ id: FilterStatus; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GlobalExecutionList() {
  const globalExecutions = usePersonaStore((s) => s.globalExecutions);
  const globalExecutionsTotal = usePersonaStore((s) => s.globalExecutionsTotal);
  const globalExecutionsOffset = usePersonaStore((s) => s.globalExecutionsOffset);
  const fetchGlobalExecutions = usePersonaStore((s) => s.fetchGlobalExecutions);
  const personas = usePersonaStore((s) => s.personas);

  const [filter, setFilter] = useState<FilterStatus>('all');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [selectedExec, setSelectedExec] = useState<GlobalExecution | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

  // Client-side persona filter
  const filteredExecutions = useMemo(() => {
    if (!selectedPersonaId) return globalExecutions;
    return globalExecutions.filter((e) => e.persona_id === selectedPersonaId);
  }, [globalExecutions, selectedPersonaId]);

  const statusCounts = useMemo(() => {
    const counts: Record<FilterStatus, number> = { all: filteredExecutions.length, running: 0, completed: 0, failed: 0 };
    for (const exec of filteredExecutions) {
      if (exec.status === 'running' || exec.status === 'pending') counts.running++;
      else if (exec.status === 'completed') counts.completed++;
      else if (exec.status === 'failed') counts.failed++;
    }
    return counts;
  }, [filteredExecutions]);

  // Initial fetch and filter changes
  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      const statusParam = filter === 'all' ? undefined : filter;
      try {
        await fetchGlobalExecutions(true, statusParam);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [filter, fetchGlobalExecutions]);

  // Poll only when there are running/pending executions
  const hasRunning = useMemo(
    () => globalExecutions.some((e) => e.status === 'running' || e.status === 'pending'),
    [globalExecutions]
  );

  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => {
      const statusParam = filter === 'all' ? undefined : filter;
      fetchGlobalExecutions(true, statusParam);
    }, 5000);
    return () => clearInterval(id);
  }, [hasRunning, filter, fetchGlobalExecutions]);

  const handleLoadMore = () => {
    const statusParam = filter === 'all' ? undefined : filter;
    fetchGlobalExecutions(false, statusParam);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const statusParam = filter === 'all' ? undefined : filter;
      await fetchGlobalExecutions(true, statusParam);
    } finally {
      setIsRefreshing(false);
    }
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
            {/* Dashboard toggle */}
            <button
              onClick={() => setShowDashboard(!showDashboard)}
              className={`p-1.5 rounded-lg transition-colors ${
                showDashboard
                  ? 'text-blue-400 bg-blue-500/15 border border-blue-500/25'
                  : 'text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/50'
              }`}
              title={showDashboard ? 'Show execution list' : 'Show metrics dashboard'}
            >
              <BarChart3 className="w-3.5 h-3.5" />
            </button>
            {/* Refresh */}
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
        /* Metrics Dashboard view */
        <ContentBody flex>
          <ExecutionMetricsDashboard onClose={() => setShowDashboard(false)} />
        </ContentBody>
      ) : (
        <>
          {/* Filter bar */}
          <div className="px-4 md:px-6 py-3 border-b border-primary/10 flex items-center gap-2 flex-shrink-0 flex-wrap">
            {filterOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setFilter(opt.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                  filter === opt.id
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'bg-secondary/30 text-muted-foreground/80 border-primary/15 hover:text-muted-foreground hover:bg-secondary/50'
                }`}
              >
                {opt.id === 'running' && statusCounts.running > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                )}
                {opt.label}
                <span className="opacity-60">({statusCounts[opt.id]})</span>
              </button>
            ))}
            <PersonaSelect
              value={selectedPersonaId}
              onChange={setSelectedPersonaId}
              personas={personas}
            />
            <span className="ml-auto text-sm font-mono text-muted-foreground/80">
              Showing {filteredExecutions.length} of {globalExecutionsTotal}
            </span>
          </div>

          {/* Execution table */}
          <ContentBody flex>
            {isLoading ? (
              <div className="flex-1 flex items-center justify-center p-4 md:p-6">
                <div className="text-center">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-primary/70 animate-spin" />
                  </div>
                  <p className="text-sm text-muted-foreground/90">Loading executions...</p>
                </div>
              </div>
            ) : filteredExecutions.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-4 md:p-6">
                {personas.length === 0 ? (
                  <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center">
                      <Bot className="w-5 h-5 text-muted-foreground/60" />
                    </div>
                    <p className="text-sm text-muted-foreground/90">No agents created yet</p>
                    <p className="text-sm text-muted-foreground/60 mt-1">Create your first agent to see execution activity here</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center">
                      <Inbox className="w-5 h-5 text-muted-foreground/60" />
                    </div>
                    <p className="text-sm text-muted-foreground/90">No executions yet</p>
                    <p className="text-sm text-muted-foreground/60 mt-1">Run an agent to see execution activity here</p>
                  </div>
                )}
              </div>
            ) : (
              <div ref={parentRef} className="flex-1 overflow-y-auto">
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
                    <tr style={{ height: `${virtualizer.getTotalSize()}px` }} aria-hidden>
                      <td colSpan={5} className="p-0" />
                    </tr>
                  </tbody>
                </table>

                {/* Virtualized rows rendered as absolutely positioned table-style divs */}
                <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', marginTop: `-${virtualizer.getTotalSize()}px` }}>
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const exec = filteredExecutions[virtualRow.index]!;
                    const status = getStatusEntry(exec.status);
                    return (
                      <div
                        key={exec.id}
                        role="row"
                        tabIndex={0}
                        onClick={() => setSelectedExec(exec)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedExec(exec);
                          }
                        }}
                        style={{
                          position: 'absolute',
                          top: 0,
                          transform: `translateY(${virtualRow.start}px)`,
                          width: '100%',
                          height: `${virtualRow.size}px`,
                        }}
                        className="flex items-center hover:bg-white/[0.03] cursor-pointer transition-colors border-b border-primary/[0.06]"
                      >
                        {/* Persona */}
                        <div className="flex items-center gap-2 px-4 w-[25%] min-w-0">
                          <div
                            className="w-6 h-6 rounded-md flex items-center justify-center text-xs border border-primary/15 flex-shrink-0"
                            style={{ backgroundColor: (exec.persona_color || '#6366f1') + '15' }}
                          >
                            {exec.persona_icon || '?'}
                          </div>
                          <span className="text-sm font-medium text-foreground/80 truncate">
                            {exec.persona_name || 'Unknown'}
                          </span>
                        </div>

                        {/* Status */}
                        <div className="px-4 w-[20%]">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-sm font-medium ${badgeClass(status)}`}>
                            {status.pulse && (
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
                              </span>
                            )}
                            {status.label}
                          </span>
                        </div>

                        {/* Duration */}
                        <div className="px-4 w-[15%] text-right">
                          <span className="text-sm text-muted-foreground/90 font-mono">
                            {formatDuration(exec.duration_ms)}
                          </span>
                        </div>

                        {/* Started */}
                        <div className="px-4 w-[20%] text-right">
                          <span className="text-sm text-muted-foreground/80">
                            {formatRelativeTime(exec.started_at || exec.created_at)}
                          </span>
                        </div>

                        {/* ID */}
                        <div className="px-4 w-[20%] min-w-0">
                          <span className="text-sm text-muted-foreground/60 font-mono truncate block">
                            {exec.id.slice(0, 8)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Load more */}
                {hasMore && (
                  <div className="pt-3 pb-2 text-center">
                    <button
                      onClick={handleLoadMore}
                      className="px-4 py-2 text-sm font-medium text-muted-foreground/80 hover:text-muted-foreground bg-secondary/30 hover:bg-secondary/50 rounded-lg border border-primary/15 transition-all"
                    >
                      Load More ({globalExecutionsTotal - globalExecutionsOffset} remaining)
                    </button>
                  </div>
                )}
              </div>
            )}
          </ContentBody>
        </>
      )}

      {/* Detail Modal */}
      {selectedExec && (
        <DetailModal
          title={`${selectedExec.persona_name || 'Unknown'} - Execution`}
          subtitle={`ID: ${selectedExec.id}`}
          onClose={() => setSelectedExec(null)}
        >
          <ExecutionDetail execution={selectedExec} />
        </DetailModal>
      )}
    </ContentBox>
  );
}
