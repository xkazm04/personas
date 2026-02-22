import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Copy, Check, RotateCw } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import type { GlobalExecution } from '@/lib/types/types';
import type { PersonaExecutionStatus } from '@/lib/types/frontendTypes';
import { formatDuration, formatRelativeTime } from '@/lib/utils/formatters';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const statusConfig: Record<PersonaExecutionStatus, { label: string; color: string; bgColor: string; borderColor: string; pulse?: boolean }> = {
  pending: { label: 'Pending', color: 'text-muted-foreground', bgColor: 'bg-muted/30', borderColor: 'border-muted-foreground/20' },
  running: { label: 'Running', color: 'text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/30', pulse: true },
  completed: { label: 'Completed', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30' },
  failed: { label: 'Failed', color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30' },
  cancelled: { label: 'Cancelled', color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30' },
};

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

// ---------------------------------------------------------------------------
// Execution Row
// ---------------------------------------------------------------------------

function ExecutionRow({
  execution,
  isExpanded,
  onToggle,
}: {
  execution: GlobalExecution;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const status = statusConfig[execution.status as PersonaExecutionStatus] || statusConfig.pending;
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (value: string, field: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }).catch(() => {});
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="rounded-xl border border-primary/15 bg-secondary/20 hover:bg-secondary/30 transition-colors overflow-hidden"
    >
      {/* Main row */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer"
      >
        {/* Expand icon */}
        <div className="text-muted-foreground/40">
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </div>

        {/* Persona icon + name */}
        <div className="flex items-center gap-2 min-w-[140px]">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm border border-primary/15"
            style={{ backgroundColor: (execution.persona_color || '#6366f1') + '15' }}
          >
            {execution.persona_icon || '?'}
          </div>
          <span className="text-sm font-medium text-foreground/80 truncate max-w-[100px]">
            {execution.persona_name || 'Unknown'}
          </span>
        </div>

        {/* Status badge */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border ${status.bgColor} ${status.color} ${status.borderColor}`}>
          {status.pulse && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
          )}
          {status.label}
        </div>

        {/* Retry badge */}
        {execution.retry_count > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" title={`Healing retry #${execution.retry_count}`}>
            <RotateCw className="w-2.5 h-2.5" />
            #{execution.retry_count}
          </span>
        )}

        {/* Duration */}
        <span className="text-xs text-muted-foreground/50 min-w-[60px] text-right font-mono">
          {formatDuration(execution.duration_ms)}
        </span>

        {/* Started */}
        <span className="text-xs text-muted-foreground/40 min-w-[70px] text-right">
          {formatRelativeTime(execution.started_at || execution.created_at)}
        </span>

        {/* Error (truncated) */}
        {execution.error_message && (
          <span className="flex-1 text-xs text-red-400/70 truncate ml-2">
            {execution.error_message}
          </span>
        )}
      </div>

      {/* Expanded detail */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-primary/15 space-y-3">
              {/* Output */}
              {execution.output_data && (
                <div>
                  <div className="text-[11px] font-mono text-muted-foreground/50 uppercase mb-1.5">Output</div>
                  <pre className="text-xs text-foreground/70 bg-background/50 border border-primary/10 rounded-lg p-3 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono">
                    {execution.output_data}
                  </pre>
                </div>
              )}

              {/* Error */}
              {execution.error_message && (
                <div>
                  <div className="text-[11px] font-mono text-red-400/50 uppercase mb-1.5">Error</div>
                  <pre className="text-xs text-red-400/80 bg-red-500/5 border border-red-500/10 rounded-lg p-3 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono">
                    {execution.error_message}
                  </pre>
                </div>
              )}

              {/* Metadata */}
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground/40">
                <button
                  onClick={(e) => { e.stopPropagation(); copyToClipboard(execution.id, 'id'); }}
                  className="inline-flex items-center gap-1 hover:text-muted-foreground/70 transition-colors group"
                  title={execution.id}
                >
                  ID: <span className="font-mono">#{execution.id.slice(0, 8)}</span>
                  {copiedField === 'id' ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                  )}
                </button>
                {execution.claude_session_id && (
                  <button
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(execution.claude_session_id!, 'session'); }}
                    className="inline-flex items-center gap-1 hover:text-muted-foreground/70 transition-colors group"
                    title={execution.claude_session_id}
                  >
                    Session: <span className="font-mono">#{execution.claude_session_id.slice(0, 8)}</span>
                    {copiedField === 'session' ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                    )}
                  </button>
                )}
                {execution.started_at && (
                  <span>Started: {new Date(execution.started_at).toLocaleString()}</span>
                )}
                {execution.completed_at && (
                  <span>Completed: {new Date(execution.completed_at).toLocaleString()}</span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
