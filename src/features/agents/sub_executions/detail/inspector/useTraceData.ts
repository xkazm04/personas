import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Event } from '@tauri-apps/api/event';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import type { UnifiedTrace, UnifiedSpan, UnifiedSpanType } from '@/lib/execution/pipeline';
import { mergeBackendSpans } from '@/lib/execution/pipeline';
import { getExecutionTrace } from '@/api/agents/executions';
import { useAgentStore } from '@/stores/agentStore';
import {
  buildSpanTree,
  flattenTree,
  applySpanEvent,
  buildParentIndex,
  computeVisibleNodes,
} from './traceInspectorTypes';
import type { SpanNode, BufferedSpanEvent, TraceSpanEvent } from './traceInspectorTypes';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Ceiling on span events held while the initial fetch is in flight. Matches
 * the backend tracer's own `MAX_SPANS` (src-tauri/core/src/trace.rs), so a
 * runaway producer can never grow this buffer past what the trace itself
 * could ever contain.
 */
const MAX_BUFFERED_SPAN_EVENTS = 10_000;

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

  // Span events that arrived while the initial fetch was still in flight.
  // `null` means "not buffering" — events apply straight to state. Opening a
  // RUNNING execution races the fetch against the live stream; without this
  // every span emitted during the fetch window was dropped on the floor
  // (`setTrace` had no `prev` to merge into) and the view silently under-
  // reported until the wholesale `execution-trace` event landed at finish.
  // Same shape of fix as the early-buffer in `hooks/realtime/createSingletonListener`.
  const pendingSpanEventsRef = useRef<BufferedSpanEvent[] | null>([]);

  // Fetch trace data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Re-arm the buffer for this execution before the fetch starts.
    pendingSpanEventsRef.current = [];

    getExecutionTrace(executionId, personaId)
      .then((t) => {
        if (cancelled) return;
        // Flush exactly once: drop the buffer before replaying it so any
        // event arriving from here on takes the direct path.
        const buffered = pendingSpanEventsRef.current ?? [];
        pendingSpanEventsRef.current = null;

        if (!t) {
          // No trace persisted for this execution — there is no object to
          // replay the buffered spans onto, so they go where they went before.
          setTrace(null);
          setLoading(false);
          return;
        }

        let spans = t.spans;
        for (const ev of buffered) {
          spans = applySpanEvent(spans, ev.span, ev.event_type);
        }
        setTrace(spans === t.spans ? t : { ...t, spans });
        setLoading(false);
      })
      .catch((err) => {
        silentCatch('useTraceData:getExecutionTrace')(err);
        if (!cancelled) {
          // Nothing to replay onto — discard rather than hold the buffer open.
          pendingSpanEventsRef.current = null;
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
    (event: Event<TraceSpanEvent>) => {
      if (event.payload.execution_id !== executionId) return;
      const { span, event_type } = event.payload;

      const pending = pendingSpanEventsRef.current;
      if (pending) {
        if (pending.length < MAX_BUFFERED_SPAN_EVENTS) {
          pending.push({ span, event_type });
        }
        return;
      }

      setTrace((prev) => {
        if (!prev) return prev;
        const spans = applySpanEvent(prev.spans, span, event_type);
        return spans === prev.spans ? prev : { ...prev, spans };
      });
    },
    [executionId],
  );
  useTauriEvent<TraceSpanEvent>('execution-trace-span', handleTraceSpan);

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

  // Build tree + flat list + total from the unified trace. Deliberately does
  // NOT depend on `collapsedSpans` — expanding a node must not rebuild the
  // tree, and at the tracer's 10,000-span ceiling that rebuild is the whole
  // cost of the interaction.
  const { allNodes, parentIndex, totalMs } = useMemo(() => {
    if (!unifiedTrace) {
      return {
        allNodes: [] as SpanNode[],
        parentIndex: new Map<string, string | null>(),
        totalMs: 0,
      };
    }

    const tree = buildSpanTree(unifiedTrace.spans);
    const allFlat = flattenTree(tree);

    // Prefer backend total_duration_ms when available (richest signal),
    // fall back to unified trace timing, then to max(end_ms).
    let total = trace?.total_duration_ms ?? 0;
    if (!total && unifiedTrace.completedAt && unifiedTrace.startedAt) {
      total = unifiedTrace.completedAt - unifiedTrace.startedAt;
    }
    if (!total) {
      // Loop rather than `Math.max(0, ...spans)` — spreading a 10k-element
      // array into a call is a needless argument-list stress test.
      for (const s of unifiedTrace.spans) {
        const end = s.end_ms ?? s.start_ms + (s.duration_ms ?? 0);
        if (end > total) total = end;
      }
    }

    return {
      allNodes: allFlat,
      parentIndex: buildParentIndex(unifiedTrace.spans),
      totalMs: total,
    };
  }, [unifiedTrace, trace]);

  // Only the visible-set derivation reruns on a collapse toggle.
  const visibleNodes = useMemo(
    () => computeVisibleNodes(allNodes, collapsedSpans, parentIndex),
    [allNodes, collapsedSpans, parentIndex],
  );

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
