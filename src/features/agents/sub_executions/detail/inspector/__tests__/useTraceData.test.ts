import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Event, EventCallback } from '@tauri-apps/api/event';

/**
 * Regression pin for the fetch-window span race in `useTraceData`.
 *
 * Opening a RUNNING execution races `getExecutionTrace()` against the live
 * `execution-trace-span` stream. Before the fix, every span event that landed
 * while the fetch was in flight hit `setTrace((prev) => { if (!prev) return prev; ... })`
 * and was discarded — so the trace of an in-flight run was silently missing
 * its earliest spans until the wholesale `execution-trace` event replaced the
 * object at finish. These tests drive the race directly.
 */
vi.mock('@/api/agents/executions', () => ({
  getExecutionTrace: vi.fn(),
}));

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (selector: (s: { pipelineTrace: null }) => unknown) =>
    selector({ pipelineTrace: null }),
}));

// Pass-through spy so the collapse tests can prove a toggle does NOT rebuild
// the span tree.
vi.mock('../traceInspectorTypes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../traceInspectorTypes')>();
  return { ...actual, buildSpanTree: vi.fn(actual.buildSpanTree) };
});

import { listen } from '@tauri-apps/api/event';
import * as executionsApi from '@/api/agents/executions';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import type { UnifiedSpan } from '@/lib/execution/pipeline';
import { useTraceData } from '../useTraceData';
import {
  applySpanEvent,
  buildParentIndex,
  buildSpanTree,
  computeVisibleNodes,
  flattenTree,
} from '../traceInspectorTypes';
import type { SpanNode } from '../traceInspectorTypes';

const getExecutionTraceMock = vi.mocked(executionsApi.getExecutionTrace);
const listenMock = vi.mocked(listen);

const EXEC_ID = 'exec-1';
const PERSONA_ID = 'persona-1';

// ---------------------------------------------------------------------------
// Fixtures / harness
// ---------------------------------------------------------------------------

function span(id: string, opts: Partial<TraceSpan> = {}): TraceSpan {
  return {
    span_id: id,
    parent_span_id: null,
    span_type: 'tool_call',
    name: `span ${id}`,
    start_ms: 0,
    end_ms: null,
    duration_ms: null,
    cost_usd: null,
    input_tokens: null,
    output_tokens: null,
    error: null,
    metadata: null,
    ...opts,
  } as TraceSpan;
}

function trace(spans: TraceSpan[]): ExecutionTrace {
  return {
    trace_id: 'trace-1',
    execution_id: EXEC_ID,
    persona_id: PERSONA_ID,
    chain_trace_id: null,
    spans,
    total_duration_ms: null,
    evicted_span_count: 0,
    created_at: '2026-01-01T00:00:00Z',
  };
}

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Handlers registered per Tauri event name by the hook under test. */
const handlers = new Map<string, EventCallback<unknown>[]>();

function emitSpanEvent(payload: { execution_id: string; span: TraceSpan; event_type: string }) {
  for (const cb of handlers.get('execution-trace-span') ?? []) {
    cb({ event: 'execution-trace-span', id: 0, payload } as unknown as Event<unknown>);
  }
}

beforeEach(() => {
  handlers.clear();
  getExecutionTraceMock.mockReset();
  listenMock.mockReset();
  listenMock.mockImplementation(async (name: string, cb: EventCallback<unknown>) => {
    const list = handlers.get(name) ?? [];
    list.push(cb);
    handlers.set(name, list);
    return () => {
      handlers.set(name, (handlers.get(name) ?? []).filter((h) => h !== cb));
    };
  });
});

/** Render the hook and let the async `listen()` subscriptions settle. */
async function mountHook() {
  const rendered = renderHook(() => useTraceData(EXEC_ID, PERSONA_ID));
  await act(async () => { await Promise.resolve(); });
  return rendered;
}

// ---------------------------------------------------------------------------
// applySpanEvent — the pure reducer the buffer replays through
// ---------------------------------------------------------------------------

describe('applySpanEvent', () => {
  it('appends an unknown span on start', () => {
    const out = applySpanEvent([], span('a'), 'start');
    expect(out.map((s) => s.span_id)).toEqual(['a']);
  });

  it('is a no-op for a start whose span is already present (dedupe on span_id)', () => {
    const base = [span('a')];
    const out = applySpanEvent(base, span('a'), 'start');
    expect(out).toBe(base);
  });

  it('replaces a known span on end', () => {
    const out = applySpanEvent([span('a')], span('a', { end_ms: 50, duration_ms: 50 }), 'end');
    expect(out).toHaveLength(1);
    expect(out[0].end_ms).toBe(50);
  });

  it('materialises a span whose start was never seen when its end arrives', () => {
    const out = applySpanEvent([span('a')], span('b', { end_ms: 10 }), 'end');
    expect(out.map((s) => s.span_id)).toEqual(['a', 'b']);
  });

  it('ignores unknown event types', () => {
    const base = [span('a')];
    expect(applySpanEvent(base, span('b'), 'progress')).toBe(base);
  });
});

// ---------------------------------------------------------------------------
// The race
// ---------------------------------------------------------------------------

describe('useTraceData — span events during the initial fetch window', () => {
  it('buffers start/end events emitted before the fetch resolves and replays them exactly once', async () => {
    const fetchDeferred = deferred<ExecutionTrace>();
    getExecutionTraceMock.mockReturnValue(fetchDeferred.promise);

    const { result } = await mountHook();
    expect(result.current.trace).toBeNull();

    // Live stream fires while the fetch is still in flight.
    act(() => {
      emitSpanEvent({ execution_id: EXEC_ID, span: span('a'), event_type: 'start' });
      emitSpanEvent({
        execution_id: EXEC_ID,
        span: span('a', { end_ms: 42, duration_ms: 42 }),
        event_type: 'end',
      });
      emitSpanEvent({ execution_id: EXEC_ID, span: span('b', { start_ms: 5 }), event_type: 'start' });
    });

    // Nothing applied yet — the fetch owns the base object.
    expect(result.current.trace).toBeNull();

    // The fetch comes back already knowing about `a` (it started before the
    // snapshot was taken) but not about `b`.
    await act(async () => {
      fetchDeferred.resolve(trace([span('a')]));
      await fetchDeferred.promise;
    });

    const spans = result.current.trace!.spans;
    expect(spans.map((s) => s.span_id).sort()).toEqual(['a', 'b']);
    // `a` appears exactly once and carries the buffered `end` payload.
    expect(spans.filter((s) => s.span_id === 'a')).toHaveLength(1);
    expect(spans.find((s) => s.span_id === 'a')!.end_ms).toBe(42);
    expect(result.current.loading).toBe(false);
  });

  it('handles an end event for a span not present in the fetched trace', async () => {
    const fetchDeferred = deferred<ExecutionTrace>();
    getExecutionTraceMock.mockReturnValue(fetchDeferred.promise);

    const { result } = await mountHook();
    act(() => {
      emitSpanEvent({
        execution_id: EXEC_ID,
        span: span('orphan', { end_ms: 7, duration_ms: 7 }),
        event_type: 'end',
      });
    });

    await act(async () => {
      fetchDeferred.resolve(trace([]));
      await fetchDeferred.promise;
    });

    expect(result.current.trace!.spans.map((s) => s.span_id)).toEqual(['orphan']);
  });

  it('flushes the buffer once — later events apply directly, not a second replay', async () => {
    const fetchDeferred = deferred<ExecutionTrace>();
    getExecutionTraceMock.mockReturnValue(fetchDeferred.promise);

    const { result } = await mountHook();
    act(() => {
      emitSpanEvent({ execution_id: EXEC_ID, span: span('a'), event_type: 'start' });
    });
    await act(async () => {
      fetchDeferred.resolve(trace([]));
      await fetchDeferred.promise;
    });
    expect(result.current.trace!.spans).toHaveLength(1);

    act(() => {
      emitSpanEvent({ execution_id: EXEC_ID, span: span('c'), event_type: 'start' });
      // Re-delivery of an already applied span must not duplicate it.
      emitSpanEvent({ execution_id: EXEC_ID, span: span('a'), event_type: 'start' });
    });

    expect(result.current.trace!.spans.map((s) => s.span_id)).toEqual(['a', 'c']);
  });

  it('ignores buffered events belonging to another execution', async () => {
    const fetchDeferred = deferred<ExecutionTrace>();
    getExecutionTraceMock.mockReturnValue(fetchDeferred.promise);

    const { result } = await mountHook();
    act(() => {
      emitSpanEvent({ execution_id: 'other-exec', span: span('x'), event_type: 'start' });
    });
    await act(async () => {
      fetchDeferred.resolve(trace([]));
      await fetchDeferred.promise;
    });

    expect(result.current.trace!.spans).toHaveLength(0);
  });

  it('drops the buffer when the fetch rejects (nothing to replay onto)', async () => {
    const fetchDeferred = deferred<ExecutionTrace>();
    getExecutionTraceMock.mockReturnValue(fetchDeferred.promise);

    const { result } = await mountHook();
    act(() => {
      emitSpanEvent({ execution_id: EXEC_ID, span: span('a'), event_type: 'start' });
    });

    await act(async () => {
      fetchDeferred.reject(new Error('boom'));
      try {
        await fetchDeferred.promise;
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });

    expect(result.current.error).toBe('boom');
    expect(result.current.trace).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('still tears down cleanly when unmounted mid-fetch (cancelled guard holds)', async () => {
    const fetchDeferred = deferred<ExecutionTrace>();
    getExecutionTraceMock.mockReturnValue(fetchDeferred.promise);

    const { result, unmount } = await mountHook();
    act(() => {
      emitSpanEvent({ execution_id: EXEC_ID, span: span('a'), event_type: 'start' });
    });
    unmount();

    await act(async () => {
      fetchDeferred.resolve(trace([span('a')]));
      await fetchDeferred.promise;
    });

    expect(result.current.trace).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The fetch-window buffer's ceiling — the cap and its truncation signal
// ---------------------------------------------------------------------------

describe('useTraceData — buffer overflow is counted, not silent', () => {
  it('reports zero drops for a buffer that never reached its ceiling', async () => {
    const fetchDeferred = deferred<ExecutionTrace>();
    getExecutionTraceMock.mockReturnValue(fetchDeferred.promise);

    const { result } = await mountHook();
    act(() => {
      emitSpanEvent({ execution_id: EXEC_ID, span: span('a'), event_type: 'start' });
    });
    await act(async () => {
      fetchDeferred.resolve(trace([]));
      await fetchDeferred.promise;
    });

    expect(result.current.droppedSpanEvents).toBe(0);
  });

  it('counts every event dropped past the ceiling and hands out the cap with it', async () => {
    // The regression this pins: past MAX_BUFFERED_SPAN_EVENTS the event was
    // discarded and nothing recorded that it happened, so cost/duration/span
    // and error counts described a clipped set while reading as the whole.
    const fetchDeferred = deferred<ExecutionTrace>();
    getExecutionTraceMock.mockReturnValue(fetchDeferred.promise);

    const { result } = await mountHook();
    const cap = result.current.spanEventBufferCap;
    const overflow = 3;

    act(() => {
      // Same span_id throughout: the replay then dedupes in O(1) instead of
      // turning the flush into a 10,000² scan.
      for (let i = 0; i < cap + overflow; i++) {
        emitSpanEvent({ execution_id: EXEC_ID, span: span('a'), event_type: 'start' });
      }
    });

    await act(async () => {
      fetchDeferred.resolve(trace([]));
      await fetchDeferred.promise;
    });

    expect(result.current.droppedSpanEvents).toBe(overflow);
    expect(result.current.spanEventBufferCap).toBe(10_000);
    // The buffer kept everything it could: the span still lands.
    expect(result.current.trace!.spans.map((s) => s.span_id)).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
// Collapse derivation — O(1) parent lookup, no tree rebuild on toggle
// ---------------------------------------------------------------------------

/**
 * The pre-optimisation collapse walk, verbatim in behaviour: resolve every
 * ancestor hop with a linear scan over the whole span array. Kept here as the
 * equivalence oracle (and as the baseline the timing check measures against).
 */
function legacyVisibleNodes(
  spans: UnifiedSpan[],
  nodes: SpanNode[],
  collapsedSpans: Set<string>,
): SpanNode[] {
  const isAncestorCollapsed = (node: SpanNode): boolean => {
    let currentParentId = node.span.parent_span_id;
    while (currentParentId) {
      if (collapsedSpans.has(currentParentId)) return true;
      const parent = spans.find((s) => s.span_id === currentParentId);
      currentParentId = parent?.parent_span_id ?? null;
    }
    return false;
  };
  return nodes.filter((n) => !isAncestorCollapsed(n));
}

function uSpan(id: string, parent: string | null, startMs = 0): UnifiedSpan {
  return {
    span_id: id,
    parent_span_id: parent,
    span_type: 'tool_call',
    name: id,
    start_ms: startMs,
    end_ms: startMs + 1,
    duration_ms: 1,
    cost_usd: null,
    error: null,
    metadata: null,
  } as UnifiedSpan;
}

/** `roots` chains of `depth` spans each — a realistic nested-trace shape. */
function chainForest(roots: number, depth: number): UnifiedSpan[] {
  const spans: UnifiedSpan[] = [];
  for (let r = 0; r < roots; r++) {
    let parent: string | null = null;
    for (let d = 0; d < depth; d++) {
      const id = `r${r}-d${d}`;
      spans.push(uSpan(id, parent, d));
      parent = id;
    }
  }
  return spans;
}

describe('computeVisibleNodes — behaviour parity with the linear-scan walk', () => {
  const spans: UnifiedSpan[] = [
    uSpan('root', null, 0),
    uSpan('a', 'root', 1),
    uSpan('a1', 'a', 2),
    uSpan('a1x', 'a1', 3),
    uSpan('b', 'root', 4),
    uSpan('b1', 'b', 5),
    uSpan('orphan', 'missing-parent', 6),
    uSpan('root2', null, 7),
    uSpan('c', 'root2', 8),
  ];
  const nodes = flattenTree(buildSpanTree(spans));
  const parentIndex = buildParentIndex(spans);

  const scenarios: Array<[string, string[]]> = [
    ['nothing collapsed', []],
    ['a leaf collapsed (no visible effect)', ['a1x']],
    ['a mid node collapsed', ['a1']],
    ['nested collapse — ancestor and descendant both collapsed', ['a', 'a1']],
    ['a root collapsed', ['root']],
    ['both roots collapsed', ['root', 'root2']],
    ['a collapsed id not present in the trace', ['ghost']],
    ['the missing parent of an orphan collapsed', ['missing-parent']],
  ];

  for (const [label, collapsed] of scenarios) {
    it(`matches the oracle: ${label}`, () => {
      const set = new Set(collapsed);
      expect(computeVisibleNodes(nodes, set, parentIndex).map((n) => n.span.span_id))
        .toEqual(legacyVisibleNodes(spans, nodes, set).map((n) => n.span.span_id));
    });
  }

  it('returns the input array by reference when nothing is collapsed', () => {
    expect(computeVisibleNodes(nodes, new Set(), parentIndex)).toBe(nodes);
  });

  it('terminates on a parent cycle instead of spinning', () => {
    const cyclic = [uSpan('x', 'y'), uSpan('y', 'x')];
    const cyclicNodes = flattenTree(buildSpanTree(cyclic));
    expect(() =>
      computeVisibleNodes(cyclicNodes, new Set(['z']), buildParentIndex(cyclic)),
    ).not.toThrow();
  });
});

describe('useTraceData — toggling a span does not rebuild the tree', () => {
  it('reuses the memoised tree across collapse toggles', async () => {
    const spans = [
      span('root'),
      span('a', { parent_span_id: 'root', start_ms: 1 }),
      span('a1', { parent_span_id: 'a', start_ms: 2 }),
    ];
    getExecutionTraceMock.mockResolvedValue(trace(spans));

    const { result } = await mountHook();
    await act(async () => { await Promise.resolve(); });

    expect(result.current.visibleNodes).toHaveLength(3);
    const buildsAfterMount = vi.mocked(buildSpanTree).mock.calls.length;
    expect(buildsAfterMount).toBeGreaterThan(0);

    act(() => { result.current.toggleSpan('a'); });

    expect(result.current.visibleNodes.map((n) => n.span.span_id)).toEqual(['root', 'a']);
    expect(vi.mocked(buildSpanTree).mock.calls.length).toBe(buildsAfterMount);

    act(() => { result.current.toggleSpan('a'); });

    expect(result.current.visibleNodes).toHaveLength(3);
    expect(vi.mocked(buildSpanTree).mock.calls.length).toBe(buildsAfterMount);
  });
});

describe('computeVisibleNodes — 2,000+ span fixture', () => {
  it('beats the linear-scan walk and stays identical', () => {
    const spans = chainForest(100, 25); // 2,500 spans, avg ancestor depth ~12
    expect(spans).toHaveLength(2500);

    const nodes = flattenTree(buildSpanTree(spans));
    const parentIndex = buildParentIndex(spans);
    // Collapse one node halfway down every chain — the realistic worst case
    // where most nodes must climb before the verdict is known.
    const collapsed = new Set(Array.from({ length: 100 }, (_, r) => `r${r}-d12`));

    const t0 = performance.now();
    const legacy = legacyVisibleNodes(spans, nodes, collapsed);
    const legacyMs = performance.now() - t0;

    const t1 = performance.now();
    const optimised = computeVisibleNodes(nodes, collapsed, parentIndex);
    const optimisedMs = performance.now() - t1;

    expect(optimised.map((n) => n.span.span_id)).toEqual(legacy.map((n) => n.span.span_id));
    // Reported for the record; the assertion is deliberately loose so a noisy
    // CI box can't flake it, while still failing if the quadratic walk returns.
    console.info(
      `[trace-collapse] 2500 spans — legacy ${legacyMs.toFixed(1)}ms, optimised ${optimisedMs.toFixed(1)}ms`,
    );
    expect(optimisedMs).toBeLessThan(legacyMs / 5);
  });
});

// ---------------------------------------------------------------------------
// No persisted trace row — i.e. EVERY running execution
// ---------------------------------------------------------------------------

/**
 * `traces::save` runs only at the four finalize sites in
 * `src-tauri/src/engine/runner/mod.rs`, so `get_execution_trace` returns
 * `null` for anything still running. The `!t` branch used to set `trace` to
 * null and drop the buffer, after which the span reducer's `if (!prev) return
 * prev` guard no-oped forever — the whole live backend span stream went on the
 * floor, uncounted, until the wholesale `execution-trace` event at finish.
 */
describe('useTraceData — live spans when no trace row is persisted yet', () => {
  it('replays the fetch-window buffer onto a synthesized shell', async () => {
    const fetchDeferred = deferred<ExecutionTrace | null>();
    getExecutionTraceMock.mockReturnValue(fetchDeferred.promise);

    const { result } = await mountHook();
    act(() => {
      emitSpanEvent({ execution_id: EXEC_ID, span: span('a'), event_type: 'start' });
      emitSpanEvent({ execution_id: EXEC_ID, span: span('b', { start_ms: 5 }), event_type: 'start' });
    });

    await act(async () => {
      fetchDeferred.resolve(null);
      await fetchDeferred.promise;
    });

    expect(result.current.trace).not.toBeNull();
    expect(result.current.trace!.spans.map((s) => s.span_id)).toEqual(['a', 'b']);
    expect(result.current.loading).toBe(false);
  });

  it('keeps applying span events that arrive after the null fetch settles', async () => {
    getExecutionTraceMock.mockResolvedValue(null);

    const { result } = await mountHook();
    await act(async () => { await Promise.resolve(); });

    act(() => {
      emitSpanEvent({ execution_id: EXEC_ID, span: span('a'), event_type: 'start' });
    });
    act(() => {
      emitSpanEvent({
        execution_id: EXEC_ID,
        span: span('a', { end_ms: 12, duration_ms: 12 }),
        event_type: 'end',
      });
      emitSpanEvent({ execution_id: EXEC_ID, span: span('c', { start_ms: 3 }), event_type: 'start' });
    });

    expect(result.current.trace!.spans.map((s) => s.span_id)).toEqual(['a', 'c']);
    expect(result.current.trace!.spans.find((s) => s.span_id === 'a')!.end_ms).toBe(12);
    expect(result.current.visibleNodes.map((n) => n.span.span_id).sort()).toEqual(['a', 'c']);
  });

  it('claims no measurement the shell does not have, and says it is a shell', async () => {
    getExecutionTraceMock.mockResolvedValue(null);

    const { result } = await mountHook();
    await act(async () => { await Promise.resolve(); });

    expect(result.current.traceIsSynthetic).toBe(true);
    expect(result.current.trace!.total_duration_ms).toBeNull();
    expect(result.current.trace!.evicted_span_count).toBe(0);
    expect(result.current.trace!.execution_id).toBe(EXEC_ID);
  });

  it('drops the shell flag once a real trace lands on the finish event', async () => {
    getExecutionTraceMock.mockResolvedValue(null);

    const { result } = await mountHook();
    await act(async () => { await Promise.resolve(); });
    expect(result.current.traceIsSynthetic).toBe(true);

    act(() => {
      for (const cb of handlers.get('execution-trace') ?? []) {
        cb({
          event: 'execution-trace',
          id: 0,
          payload: { ...trace([span('a')]), total_duration_ms: 99 },
        } as unknown as Event<unknown>);
      }
    });

    expect(result.current.traceIsSynthetic).toBe(false);
    expect(result.current.trace!.total_duration_ms).toBe(99);
  });
});
