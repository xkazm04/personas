import { useState, useEffect, useMemo } from 'react';
import {
  Link2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Zap,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import { getChainTrace } from '@/api/agents/executions';
import { toastCatch } from "@/lib/silentCatch";
import { formatDuration } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

interface ChainCascadeTimelineProps {
  /** The chain trace ID (from execution trace). */
  chainTraceId: string;
  /** Current execution's persona ID (for API calls). */
  callerPersonaId: string;
  /** Current execution ID to highlight in the chain. */
  currentExecutionId: string;
  /** Current scrub position. */
  currentMs: number;
  /** Total execution duration. */
  totalMs: number;
}

/**
 * Visualizes chain trigger cascades as a domino-effect timeline.
 * Shows all executions in a chain and how they triggered each other.
 */
export function ChainCascadeTimeline({
  chainTraceId,
  callerPersonaId,
  currentExecutionId,
}: ChainCascadeTimelineProps) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const [chainTraces, setChainTraces] = useState<ExecutionTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getChainTrace(chainTraceId, callerPersonaId)
      .then((traces) => {
        if (!cancelled) setChainTraces(traces);
      })
      .catch(toastCatch("ChainCascadeTimeline:fetchChainTrace", "Failed to load chain trace"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [chainTraceId, callerPersonaId]);

  // Sort traces by creation time for cascade ordering
  const sortedTraces = useMemo(() => {
    return [...chainTraces].sort((a, b) => {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [chainTraces]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-foreground">
        <LoadingSpinner size="sm" />
        <span className="typo-body">{e.loading_chain_cascade}</span>
      </div>
    );
  }

  if (sortedTraces.length <= 1) return null;

  // Total chain duration
  const chainStartMs = sortedTraces.length > 0
    ? new Date(sortedTraces[0]!.created_at).getTime()
    : 0;
  const chainEndMs = sortedTraces.length > 0
    ? Math.max(
        ...sortedTraces.map((t) => new Date(t.created_at).getTime() + (t.total_duration_ms ?? 0)),
      )
    : 0;
  const chainDurationMs = chainEndMs - chainStartMs;

  return (
    <div className="rounded-modal border border-orange-500/20 bg-orange-500/5 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-orange-500/15 hover:bg-orange-500/5 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-orange-400/60" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-orange-400/60" />
        )}
        <Link2 className="w-4 h-4 text-orange-400" />
        <span className="typo-heading text-orange-300">
          {e.chain_cascade}
        </span>
        <span className="ml-auto typo-code text-foreground">
          {tx(e.chain_executions, { count: sortedTraces.length })}
        </span>
      </button>

      {expanded && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="p-4 space-y-1">
              {sortedTraces.map((trace, i) => {
                const traceStartMs = new Date(trace.created_at).getTime() - chainStartMs;
                const traceDuration = trace.total_duration_ms ?? 0;
                const isCurrent = trace.execution_id === currentExecutionId;

                // Check if chain has a failure span
                const hasError = trace.spans.some((s) => s.error != null);
                const isCompleted = trace.total_duration_ms != null;

                // Domino offset position
                const offsetPct = chainDurationMs > 0
                  ? (traceStartMs / chainDurationMs) * 100
                  : 0;
                const widthPct = chainDurationMs > 0
                  ? Math.max((traceDuration / chainDurationMs) * 100, 2)
                  : 100 / sortedTraces.length;

                return (
                  <div key={trace.trace_id} className="flex items-center gap-2">
                    {/* Domino number */}
                    <div className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-mono shrink-0 ${
                      isCurrent
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : hasError
                          ? 'bg-red-500/15 text-red-400 border border-red-500/25'
                          : 'bg-secondary/40 text-foreground border border-primary/10'
                    }`}>
                      {i + 1}
                    </div>

                    {/* Cascade bar */}
                    <div className="flex-1 relative h-5">
                      <div className="absolute inset-0 bg-primary/5 rounded" />
                      <div
                        className={`animate-fade-in absolute top-0.5 bottom-0.5 rounded ${
                          isCurrent
                            ? 'bg-blue-500/40'
                            : hasError
                              ? 'bg-red-500/30'
                              : 'bg-orange-500/30'
                        }`}
                        style={{ width: `${widthPct}%`, left: `${offsetPct}%` }}
                      />

                      {/* Connector arrow from previous */}
                      {i > 0 && (
                        <Zap className="absolute -left-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-orange-400/40" />
                      )}
                    </div>

                    {/* Status + duration */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {hasError ? (
                        <XCircle className="w-3 h-3 text-red-400" />
                      ) : isCompleted ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <LoadingSpinner size="xs" className="text-blue-400" />
                      )}
                      <span className="text-[11px] font-mono text-foreground tabular-nums">
                        {formatDuration(traceDuration)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Chain summary */}
            <div className="px-4 pb-3 flex items-center gap-3 text-[10px] font-mono text-foreground">
              <span>Chain: {chainTraceId.slice(0, 8)}</span>
              <span>Total: {formatDuration(chainDurationMs)}</span>
              <span>Depth: {sortedTraces.length}</span>
            </div>
          </div>
        )}
    </div>
  );
}
