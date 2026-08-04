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

import { listen } from '@tauri-apps/api/event';
import * as executionsApi from '@/api/agents/executions';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import { useTraceData } from '../useTraceData';
import { applySpanEvent } from '../traceInspectorTypes';

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
