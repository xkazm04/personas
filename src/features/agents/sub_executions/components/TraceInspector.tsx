import { useState, useCallback, useEffect, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { DbPersonaExecution } from '@/lib/types/types';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import { getExecutionTrace } from '@/api/executions';
import { formatDuration } from '@/lib/utils/formatters';
import { Loader2, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { buildSpanTree, flattenTree } from '../libs/traceHelpers';
import { SpanRow } from './TraceTree';
import { TraceSummary, TraceErrors } from './TraceNodeDetail';

interface TraceInspectorProps {
  execution: DbPersonaExecution;
}

export function TraceInspector({ execution }: TraceInspectorProps) {
  const [trace, setTrace] = useState<ExecutionTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedSpans, setCollapsedSpans] = useState<Set<string>>(new Set());

  // Fetch trace data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getExecutionTrace(execution.id, execution.persona_id)
      .then((t) => {
        if (!cancelled) {
          setTrace(t);
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
        setTrace(event.payload);
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
        setTrace((prev) => {
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

  // Build tree + visible flat list
  const { visibleNodes, totalMs } = useMemo(() => {
    if (!trace) return { visibleNodes: [], totalMs: 0 };

    const tree = buildSpanTree(trace.spans);
    const allFlat = flattenTree(tree);

    const isAncestorCollapsed = (node: typeof allFlat[0]): boolean => {
      let currentParentId = node.span.parent_span_id;
      while (currentParentId) {
        if (collapsedSpans.has(currentParentId)) return true;
        const parent = trace.spans.find(s => s.span_id === currentParentId);
        currentParentId = parent?.parent_span_id ?? null;
      }
      return false;
    };

    const visible = allFlat.filter(n => !isAncestorCollapsed(n));
    const total = trace.total_duration_ms ?? 0;

    return { visibleNodes: visible, totalMs: total };
  }, [trace, collapsedSpans]);

  // Children lookup for expand/collapse icons
  const childrenMap = useMemo(() => {
    if (!trace) return new Map<string, boolean>();
    const map = new Map<string, boolean>();
    for (const span of trace.spans) {
      if (span.parent_span_id) {
        map.set(span.parent_span_id, true);
      }
    }
    return map;
  }, [trace]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/80" />
        <span className="ml-2 text-sm text-muted-foreground/80">Loading trace...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-300/80 font-mono">
        Failed to load trace: {error}
      </div>
    );
  }

  if (!trace || trace.spans.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/60 border border-primary/15 flex items-center justify-center">
          <Activity className="w-6 h-6 text-muted-foreground/60" />
        </div>
        <p className="text-sm text-muted-foreground/80">No trace data recorded</p>
        <p className="text-sm text-muted-foreground/60 mt-1">Trace spans appear during execution</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TraceSummary trace={trace} />

      <div className="rounded-xl border border-primary/15 bg-secondary/30 overflow-hidden">
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

      <TraceErrors trace={trace} />
    </div>
  );
}
