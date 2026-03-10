import { useState, useEffect, useCallback, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import { getExecutionTrace } from '@/api/agents/executions';
import { buildSpanTree, flattenTree } from './traceInspectorTypes';
import type { SpanNode } from './traceInspectorTypes';

export function useTraceData(executionId: string, personaId: string) {
  const [trace, setTrace] = useState<ExecutionTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedSpans, setCollapsedSpans] = useState<Set<string>>(new Set());

  // Fetch trace data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getExecutionTrace(executionId, personaId)
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
  }, [executionId]);

  // Listen for live trace updates (complete trace emitted on finish)
  useEffect(() => {
    const unlisten = listen<ExecutionTrace>('execution-trace', (event) => {
      if (event.payload.execution_id === executionId) {
        setTrace(event.payload);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, [executionId]);

  // Listen for live span events
  useEffect(() => {
    const unlisten = listen<{ execution_id: string; span: TraceSpan; event_type: string }>(
      'execution-trace-span',
      (event) => {
        if (event.payload.execution_id !== executionId) return;
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
  }, [executionId]);

  const toggleSpan = useCallback((spanId: string) => {
    setCollapsedSpans((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  }, []);

  // Build tree + visible flat list
  const { visibleNodes, totalMs } = useMemo(() => {
    if (!trace) return { visibleNodes: [] as SpanNode[], totalMs: 0 };

    const tree = buildSpanTree(trace.spans);
    const allFlat = flattenTree(tree);

    // Filter out collapsed children
    const isAncestorCollapsed = (node: SpanNode): boolean => {
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

  return { trace, loading, error, collapsedSpans, toggleSpan, visibleNodes, totalMs, childrenMap };
}
