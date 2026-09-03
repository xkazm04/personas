/**
 * A SECOND LIVE RUN MUST SHOW ITS OWN TRACE.
 *
 * `isLive` was initial-state-only (`useState(!!executionId)`) and its ONLY
 * writer was `setIsLive(false)` on the result event; `entries` were never
 * cleared. So switching the mini-player or the monitor drawer from run A to a
 * second LIVE run B kept run A's steps on screen, labelled "completed" — and
 * `useExecutionSummary` turned that into a completed run with no cost.
 *
 * The distinction the fix rests on, pinned here: a NEW execution id is a new
 * run (reset + re-arm), while the id going NULL is the store dropping a
 * finished run (keep the trace so the completed view can still summarise it).
 *
 * Driven through the real `useStructuredStream` singleton so the per-run event
 * filtering is exercised too, with `requestAnimationFrame` stubbed away so the
 * singleton's documented `queueMicrotask` fallback drives the flush.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { useReasoningTrace } from '../useReasoningTrace';
import type { StructuredExecutionEvent } from '@/lib/types/terminalEvents';

const listenMock = vi.mocked(listen);

let nativeHandler: EventCallback<StructuredExecutionEvent> | null = null;

function emit(event: StructuredExecutionEvent) {
  nativeHandler?.({ event: 'execution-event', id: 0, payload: event });
}

function text(executionId: string, content: string): StructuredExecutionEvent {
  return { type: 'text', execution_id: executionId, content };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  nativeHandler = null;
  vi.stubGlobal('requestAnimationFrame', undefined);
  listenMock.mockReset();
  listenMock.mockImplementation((async (
    _name: string,
    cb: EventCallback<StructuredExecutionEvent>,
  ) => {
    nativeHandler = cb;
    return () => {};
  }) as unknown as typeof listen);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useReasoningTrace — run switching', () => {
  it('re-arms isLive and drops run A\'s entries when a second live run starts', async () => {
    const view = renderHook(({ id }) => useReasoningTrace(id), {
      initialProps: { id: 'run-a' as string | null },
    });
    await flush();

    emit(text('run-a', 'A one'));
    emit(text('run-a', 'A two'));
    await flush();
    expect(view.result.current.entries).toHaveLength(2);
    expect(view.result.current.isLive).toBe(true);

    // Run A finishes: the result event is the only thing that ends liveness.
    emit({ type: 'result', execution_id: 'run-a', duration_ms: 10, cost_usd: 0.5 });
    await flush();
    expect(view.result.current.isLive).toBe(false);
    expect(view.result.current.entries).toHaveLength(3);

    // Switch to a second LIVE run. Before the fix this stayed isLive:false with
    // run A's three entries still on screen.
    view.rerender({ id: 'run-b' });
    await flush();
    expect(view.result.current.isLive).toBe(true);
    expect(view.result.current.entries).toEqual([]);

    emit(text('run-b', 'B one'));
    await flush();
    expect(view.result.current.entries).toHaveLength(1);
    expect(view.result.current.entries[0]).toMatchObject({ type: 'text', content: 'B one' });
  });

  it('drops events that belong to another run', async () => {
    const view = renderHook(() => useReasoningTrace('run-a'));
    await flush();

    emit(text('run-b', 'not mine'));
    emit(text('run-a', 'mine'));
    await flush();

    expect(view.result.current.entries).toHaveLength(1);
    expect(view.result.current.entries[0]).toMatchObject({ content: 'mine' });
  });

  it('keeps the finished trace but ends liveness when the id is cleared', async () => {
    const view = renderHook(({ id }) => useReasoningTrace(id), {
      initialProps: { id: 'run-a' as string | null },
    });
    await flush();

    emit(text('run-a', 'A one'));
    await flush();
    expect(view.result.current.entries).toHaveLength(1);

    // The store clears activeExecutionId when a run reaches a terminal state.
    // That is not a new run: the completed view still needs the trace.
    view.rerender({ id: null });
    await flush();
    expect(view.result.current.isLive).toBe(false);
    expect(view.result.current.entries).toHaveLength(1);
  });

  it('caps the trace at 500 entries, keeping the most recent', async () => {
    const view = renderHook(() => useReasoningTrace('run-a'));
    await flush();

    for (let i = 0; i < 520; i++) emit(text('run-a', `line ${i}`));
    await flush();

    const entries = view.result.current.entries;
    expect(entries).toHaveLength(500);
    expect(entries[0]).toMatchObject({ content: 'line 20' });
    expect(entries[499]).toMatchObject({ content: 'line 519' });
  });
});
