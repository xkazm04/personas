import { useState, useCallback, useEffect, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { PersonaExecution } from '@/lib/types/types';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import type { UnifiedTrace, UnifiedSpan } from '@/lib/execution/pipeline';
import { mergeBackendSpans } from '@/lib/execution/pipeline';
import { getExecutionTrace } from '@/api/agents/executions';
import { useAgentStore } from "@/stores/agentStore";
import { formatDuration } from '@/lib/utils/formatters';
import { Activity } from 'lucide-react';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';
import { motion, AnimatePresence } from 'framer-motion';
import { buildSpanTree, flattenTree } from '../../libs/traceHelpers';
import { SpanRow } from './TraceTree';
import { TraceSummary, TraceErrors } from './TraceNodeDetail';

interface TraceInspectorProps {
  execution: PersonaExecution;
}

/** Convert backend ExecutionTrace spans into UnifiedSpan format. */
function convertBackendSpans(spans: TraceSpan[]): UnifiedSpan[] {
  return spans.map((s) => ({
    span_id: s.span_id,
    parent_span_id: s.parent_span_id,
    span_type: s.span_type,
    name: s.name,
    start_ms: s.start_ms,
    end_ms: s.end_ms,
    duration_ms: s.duration_ms,
    cost_usd: s.cost_usd,
    error: s.error,
    metadata: s.metadata as Record<string, unknown> | null,
  }));
}

export function TraceInspector({ execution }: TraceInspectorProps) {
  const [backendTrace, setBackendTrace] = useState<ExecutionTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedSpans, setCollapsedSpans] = useState<Set<string>>(new Set());

  // Get pipeline trace from store for merging
  const pipelineTrace = useAgentStore((s) => s.pipelineTrace);

  // Fetch backend trace data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getExecutionTrace(execution.id, execution.persona_id)
      .then((t) => {
        if (!cancelled) {
          setBackendTrace(t);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [execution.id]);

  // Listen for live trace updates
  useEffect(() => {
    const unlisten = listen<ExecutionTrace>('execution-trace', (event) => {
      if (event.payload.execution_id === execution.id) {
        setBackendTrace(event.payload);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, [execution.id]);

  // Listen for live span events
  useEffect(() => {
    const unlisten = listen<{ execution_id: string; span: TraceSpan; event_type: string }>(
      'execution-trace-span',
      (event) => {
        if (event.payload.execution_id !== execution.id) return;
        setBackendTrace((prev) => {
          if (!prev) return prev;
          const { span, event_type } = event.payload;
          const existingIdx = prev.spans.findIndex(s => s.span_id === span.span_id);
          const newSpans = [...prev.spans];
          if (event_type === 'start' && existingIdx === -1) {
            newSpans.push(span);
          } else if (event_type === 'end' && existingIdx >= 0) {
            newSpans[existingIdx] = span;
          }
          return { ...prev, spans: newSpans };
        });
      },
    );
    return () => { unlisten.then(fn => fn()); };
  }, [execution.id]);

  const toggleSpan = useCallback((spanId: string) => {
    setCollapsedSpans((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  }, []);

  // Merge pipeline trace + backend trace into a single unified trace
  const unifiedTrace = useMemo<UnifiedTrace | null>(() => {
    const hasPipeline = pipelineTrace && pipelineTrace.executionId === execution.id;
    const hasBackend = backendTrace && backendTrace.spans.length > 0;

    if (hasPipeline && hasBackend) {
      // Merge backend spans under pipeline stage spans
      return mergeBackendSpans(pipelineTrace, backendTrace.spans);
    }
    if (hasPipeline) {
      return pipelineTrace;
    }
    if (hasBackend) {
      // No pipeline trace -- wrap backend trace as unified
      return {
        executionId: backendTrace.execution_id,
        spans: convertBackendSpans(backendTrace.spans),
        startedAt: 0,
        completedAt: backendTrace.total_duration_ms ?? undefined,
      };
    }
    return null;
  }, [pipelineTrace, backendTrace, execution.id]);

  const totalMs = useMemo(() => {
    if (backendTrace?.total_duration_ms) return backendTrace.total_duration_ms;
    if (unifiedTrace?.completedAt && unifiedTrace.startedAt) {
      return unifiedTrace.completedAt - unifiedTrace.startedAt;
    }
    // Fallback: max span end_ms
    if (unifiedTrace) {
      return Math.max(0, ...unifiedTrace.spans.map(s => s.end_ms ?? s.start_ms + (s.duration_ms ?? 0)));
    }
    return 0;
  }, [unifiedTrace, backendTrace]);

  // Build tree + visible flat list
  const { visibleNodes } = useMemo(() => {
    if (!unifiedTrace) return { visibleNodes: [] };

    const tree = buildSpanTree(unifiedTrace.spans);
    const allFlat = flattenTree(tree);

    const isAncestorCollapsed = (node: typeof allFlat[0]): boolean => {
      let currentParentId = node.span.parent_span_id;
      while (currentParentId) {
        if (collapsedSpans.has(currentParentId)) return true;
        const parent = unifiedTrace.spans.find(s => s.span_id === currentParentId);
        currentParentId = parent?.parent_span_id ?? null;
      }
      return false;
    };

    const visible = allFlat.filter(n => !isAncestorCollapsed(n));
    return { visibleNodes: visible };
  }, [unifiedTrace, collapsedSpans]);

  // Children lookup for expand/collapse icons
  const childrenMap = useMemo(() => {
    if (!unifiedTrace) return new Map<string, boolean>();
    const map = new Map<string, boolean>();
    for (const span of unifiedTrace.spans) {
      if (span.parent_span_id) {
        map.set(span.parent_span_id, true);
      }
    }
    return map;
  }, [unifiedTrace]);

  if (loading) {
    return <ContentLoader variant="panel" hint="trace" />;
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-300/80 font-mono">
        Failed to load trace: {error}
      </div>
    );
  }

  if (!unifiedTrace || unifiedTrace.spans.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/60 border border-primary/20 flex items-center justify-center">
          <Activity className="w-6 h-6 text-muted-foreground/60" />
        </div>
        <p className="text-sm text-muted-foreground/80">No trace data recorded</p>
        <p className="text-sm text-muted-foreground/60 mt-1">Trace spans appear during execution</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TraceSummary trace={unifiedTrace} />

      <div className="rounded-xl border border-primary/20 bg-secondary/30 overflow-hidden">
        <div className="grid grid-cols-[minmax(200px,1fr)_minmax(200px,2fr)] gap-2 px-2 py-1.5 border-b border-primary/10 bg-secondary/40">
          <div className="text-sm font-mono text-muted-foreground/60 uppercase tracking-wider">
            Span
          </div>
          <div className="flex justify-between text-sm font-mono text-muted-foreground/60 uppercase tracking-wider">
            <span>0ms</span>
            <span>{formatDuration(totalMs)}</span>
          </div>
        </div>

        <div className="max-h-[500px] overflow-y-auto">
          <AnimatePresence initial={false}>
            {visibleNodes.map((node) => (
              <motion.div
                key={node.span.span_id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.1 }}
              >
                <SpanRow
                  node={node}
                  totalMs={totalMs}
                  expanded={!collapsedSpans.has(node.span.span_id)}
                  onToggle={() => toggleSpan(node.span.span_id)}
                  hasChildren={childrenMap.has(node.span.span_id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <TraceErrors trace={unifiedTrace} />
    </div>
  );
}
