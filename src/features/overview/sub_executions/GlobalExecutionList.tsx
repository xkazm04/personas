import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Loader2, RefreshCw } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { ExecutionRow } from './ExecutionRow';

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

  const [filter, setFilter] = useState<FilterStatus>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const statusCounts = useMemo(() => {
    const counts: Record<FilterStatus, number> = { all: globalExecutions.length, running: 0, completed: 0, failed: 0 };
    for (const exec of globalExecutions) {
      if (exec.status === 'running' || exec.status === 'pending') counts.running++;
      else if (exec.status === 'completed') counts.completed++;
      else if (exec.status === 'failed') counts.failed++;
    }
    return counts;
  }, [globalExecutions]);

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

  // Poll for running executions every 5s
  const pollRunning = useCallback(() => {
    const hasRunning = globalExecutions.some((e) => e.status === 'running' || e.status === 'pending');
    if (hasRunning) {
      const statusParam = filter === 'all' ? undefined : filter;
      fetchGlobalExecutions(true, statusParam);
    }
  }, [globalExecutions, filter, fetchGlobalExecutions]);

  useEffect(() => {
    pollRef.current = setInterval(pollRunning, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pollRunning]);

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

  return (
    <ContentBox>
      <ContentHeader
        icon={<Loader2 className="w-5 h-5 text-blue-400" />}
        iconColor="blue"
        title="Executions"
        subtitle={`${globalExecutionsTotal} execution${globalExecutionsTotal !== 1 ? 's' : ''} recorded`}
        actions={
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-muted-foreground hover:bg-secondary/50 disabled:opacity-60 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        }
      />

      {/* Filter bar */}
      <div className="px-4 md:px-6 py-3 border-b border-primary/10 flex items-center gap-2 flex-shrink-0">
        {filterOptions.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setFilter(opt.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
              filter === opt.id
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-secondary/30 text-muted-foreground/60 border-primary/15 hover:text-muted-foreground hover:bg-secondary/50'
            }`}
          >
            {opt.id === 'running' && statusCounts.running > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            )}
            {opt.label}
            <span className="opacity-60">({statusCounts[opt.id]})</span>
          </button>
        ))}
        <span className="ml-auto text-[11px] font-mono text-muted-foreground/40">
          Showing {globalExecutions.length} of {globalExecutionsTotal}
        </span>
      </div>

      {/* Execution list */}
      <ContentBody flex>
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center p-4 md:p-6">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-primary/70 animate-spin" />
              </div>
              <p className="text-sm text-muted-foreground/50">Loading executions...</p>
            </div>
          </div>
        ) : globalExecutions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-4 md:p-6">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/40 border border-primary/15 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-muted-foreground/30" />
              </div>
              <p className="text-sm text-muted-foreground/50">No executions yet</p>
              <p className="text-xs text-muted-foreground/30 mt-1">Execution activity from personas will appear here</p>
            </div>
          </div>
        ) : (
          <div className="p-4 md:p-6 space-y-1.5">
            <AnimatePresence initial={false}>
              {globalExecutions.map((exec) => (
                <ExecutionRow
                  key={exec.id}
                  execution={exec}
                  isExpanded={expandedId === exec.id}
                  onToggle={() => setExpandedId(expandedId === exec.id ? null : exec.id)}
                />
              ))}
            </AnimatePresence>

            {/* Load more */}
            {hasMore && (
              <div className="pt-3 pb-2 text-center">
                <button
                  onClick={handleLoadMore}
                  className="px-4 py-2 text-xs font-medium text-muted-foreground/60 hover:text-muted-foreground bg-secondary/30 hover:bg-secondary/50 rounded-lg border border-primary/15 transition-all"
                >
                  Load More ({globalExecutionsTotal - globalExecutionsOffset} remaining)
                </button>
              </div>
            )}
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
