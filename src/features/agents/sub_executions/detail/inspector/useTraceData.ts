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

/**
 * A trace object stood up locally when the backend has none to hand out.
 *
 * `traces::save` runs ONLY at the four finalize sites in
 * `src-tauri/src/engine/runner/mod.rs`, so `get_execution_trace` returns null
 * for every execution that is still running — the exact case the live view
 * exists for. The `!t` branch used to leave `trace` null, and the span-event
 * reducer's `if (!prev) return prev` guard then no-oped forever: the whole
 * backend span stream went on the floor, uncounted by `droppedSpanEvents`,
 * until the wholesale `execution-trace` event landed at finish.
 *
 * The shell carries only what is genuinely known — the ids the caller already
 * supplied — and null/zero for every field that is a MEASUREMENT the backend
 * has not made. `traceIsSynthetic` travels with it so a consumer can tell a
 * shell from a persisted trace instead of guessing from empty fields.
 */
function synthesizeTraceShell(executionId: string, personaId: string, spans: TraceSpan[]): ExecutionTrace {
  return {
    trace_id: '',
    execution_id: executionId,
    persona_id: personaId,
    chain_trace_id: null,
    spans,
    total_duration_ms: null,
    evicted_span_count: 0,
    created_at: '',
  };
}

export function useTraceData(executionId: string, personaId: string) {
  const [trace, setTrace] = useState<ExecutionTrace | null>(null);
  /** True while `trace` is the locally-built shell above, not a backend trace. */
  const [traceIsSynthetic, setTraceIsSynthetic] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedSpans, setCollapsedSpans] = useState<Set<string>>(new Set());
  /** Bumped by `retry()` to re-run the fetch effect after a load failure. */
  const [refreshKey, setRefreshKey] = useState(0);

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

  // A cap without a truncation signal is a lie the UI cannot see: past the
  // ceiling the event was discarded and nothing recorded that it happened, so
  // every number derived from this trace afterwards (duration, cost, span
  // count, error count) described a clipped set while reading as the whole.
  // The backend ceiling IS signalled — `ExecutionTrace.evicted_span_count`
  // drives TraceSummary's banner — this is the frontend half of that pair.
  // Counted in a ref and published once, when the buffer drains: an event
  // dropped past the ceiling must not itself cause a render.
  const droppedSpanEventsRef = useRef(0);
  const [droppedSpanEvents, setDroppedSpanEvents] = useState(0);

  // Fetch trace data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Re-arm the buffer for this execution before the fetch starts.
    pendingSpanEventsRef.current = [];
    droppedSpanEventsRef.current = 0;
    setDroppedSpanEvents(0);
    setTraceIsSynthetic(false);

    getExecutionTrace(executionId, personaId)
      .then((t) => {
        if (cancelled) return;
        // Flush exactly once: drop the buffer before replaying it so any
        // event arriving from here on takes the direct path.
        const buffered = pendingSpanEventsRef.current ?? [];
        pendingSpanEventsRef.current = null;
        // Publish the overflow count with the buffer it belongs to, whether or
        // not a trace came back to replay onto.
        setDroppedSpanEvents(droppedSpanEventsRef.current);

        if (!t) {
          // Nothing is PERSISTED — which is not the same as nothing being
          // known. Build the shell so the buffered spans (and every span event
          // from here on) have a base to land on; see synthesizeTraceShell.
          let shellSpans: TraceSpan[] = [];
          for (const ev of buffered) {
            shellSpans = applySpanEvent(shellSpans, ev.span, ev.event_type);
          }
          setTraceIsSynthetic(true);
          setTrace(synthesizeTraceShell(executionId, personaId, shellSpans));
          setLoading(false);
          return;
        }

        let spans = t.spans;
        for (const ev of buffered) {
          spans = applySpanEvent(spans, ev.span, ev.event_type);
        }
        setTraceIsSynthetic(false);
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
  }, [executionId, personaId, refreshKey]);

  const retry = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Listen for live trace updates (complete trace emitted on finish)
  const handleTrace = useCallback((event: Event<ExecutionTrace>) => {
    if (event.payload.execution_id === executionId) {
      // The persisted trace supersedes any shell built while the run was live.
      setTraceIsSynthetic(false);
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
        } else {
          droppedSpanEventsRef.current += 1;
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

  return {
    trace,
    traceIsSynthetic,
    unifiedTrace,
    loading,
    error,
    retry,
    collapsedSpans,
    toggleSpan,
    visibleNodes,
    totalMs,
    childrenMap,
    // The count and the cap that produced it travel together — a truncation
    // signal that does not carry its own predicate is not readable.
    droppedSpanEvents,
    spanEventBufferCap: MAX_BUFFERED_SPAN_EVENTS,
  };
}
