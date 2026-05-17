import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Event } from '@tauri-apps/api/event';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import type { UnifiedTrace, UnifiedSpan, UnifiedSpanType } from '@/lib/execution/pipeline';
import { mergeBackendSpans } from '@/lib/execution/pipeline';
import { getExecutionTrace } from '@/api/agents/executions';
import { useAgentStore } from '@/stores/agentStore';
import { buildSpanTree, flattenTree } from './traceInspectorTypes';
import type { SpanNode } from './traceInspectorTypes';

/** Convert backend ExecutionTrace spans into UnifiedSpan format. */
function convertBackendSpans(spans: TraceSpan[]): UnifiedSpan[] {
  return spans.map((s) => ({
    span_id: s.span_id,
    parent_span_id: s.parent_span_id,
    span_type: s.span_type as UnifiedSpanType,
    name: s.name,
    start_ms: s.start_ms,
    end_ms: s.end_ms,
    duration_ms: s.duration_ms,
    cost_usd: s.cost_usd,
    error: s.error,
    metadata: s.metadata as Record<string, unknown> | null,
  }));
}

export function useTraceData(executionId: string, personaId: string) {
  const [trace, setTrace] = useState<ExecutionTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedSpans, setCollapsedSpans] = useState<Set<string>>(new Set());

  // Pipeline trace from store -- merged with backend trace when execution matches.
  const pipelineTrace = useAgentStore((s) => s.pipelineTrace);

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
  }, [executionId, personaId]);

  // Listen for live trace updates (complete trace emitted on finish)
  const handleTrace = useCallback((event: Event<ExecutionTrace>) => {
    if (event.payload.execution_id === executionId) {
      setTrace(event.payload);
    }
  }, [executionId]);
  useTauriEvent<ExecutionTrace>('execution-trace', handleTrace);

  // Listen for live span events
  const handleTraceSpan = useCallback(
    (event: Event<{ execution_id: string; span: TraceSpan; event_type: string }>) => {
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
    [executionId],
  );
  useTauriEvent<{ execution_id: string; span: TraceSpan; event_type: string }>(
    'execution-trace-span',
    handleTraceSpan,
  );

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

  // Merge pipeline trace + backend trace into a single unified trace for the
  // tree/waterfall view. When pipeline trace is present, backend engine
  // spans are nested under their owning pipeline stage span.
  const unifiedTrace = useMemo<UnifiedTrace | null>(() => {
    const hasPipeline = pipelineTrace && pipelineTrace.executionId === executionId;
    const hasBackend = trace && trace.spans.length > 0;

    if (hasPipeline && hasBackend) {
      return mergeBackendSpans(pipelineTrace, trace.spans);
    }
    if (hasPipeline) {
      return pipelineTrace;
    }
    if (hasBackend) {
      return {
        executionId: trace.execution_id,
        spans: convertBackendSpans(trace.spans),
        startedAt: 0,
        completedAt: trace.total_duration_ms ?? undefined,
      };
    }
    return null;
  }, [pipelineTrace, trace, executionId]);

  // Build tree + visible flat list from unified trace
  const { visibleNodes, totalMs } = useMemo(() => {
    if (!unifiedTrace) return { visibleNodes: [] as SpanNode[], totalMs: 0 };

    const tree = buildSpanTree(unifiedTrace.spans);
    const allFlat = flattenTree(tree);

    const isAncestorCollapsed = (node: SpanNode): boolean => {
      let currentParentId = node.span.parent_span_id;
      while (currentParentId) {
        if (collapsedSpans.has(currentParentId)) return true;
        const parent = unifiedTrace.spans.find(s => s.span_id === currentParentId);
        currentParentId = parent?.parent_span_id ?? null;
      }
      return false;
    };

    const visible = allFlat.filter(n => !isAncestorCollapsed(n));

    // Prefer backend total_duration_ms when available (richest signal),
    // fall back to unified trace timing, then to max(end_ms).
    let total = trace?.total_duration_ms ?? 0;
    if (!total && unifiedTrace.completedAt && unifiedTrace.startedAt) {
      total = unifiedTrace.completedAt - unifiedTrace.startedAt;
    }
    if (!total) {
      total = Math.max(0, ...unifiedTrace.spans.map(s => s.end_ms ?? s.start_ms + (s.duration_ms ?? 0)));
    }

    return { visibleNodes: visible, totalMs: total };
  }, [unifiedTrace, collapsedSpans, trace]);

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

  return { trace, unifiedTrace, loading, error, collapsedSpans, toggleSpan, visibleNodes, totalMs, childrenMap };
}
