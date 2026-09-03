/**
 * TWO PANELS MUST BOTH SEE THE TRACES, AND A NO-OP NOTIFY MUST COST NOTHING.
 *
 * `useSystemTraces` is a `useSyncExternalStore` subscribe, so two mounts are
 * two independent subscribers — which the registry's single mutable callback
 * slot could not represent (the second mount stole the first's updates).
 *
 * The store contract this hook must also keep: `getSnapshot` returns a cached
 * array, and that array's IDENTITY is what drives re-renders. A notify that
 * changed nothing must therefore hand back the SAME array.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSystemTraces } from '../useSystemTrace';
import {
  SystemTraceSession,
  clearCompletedTraces,
  __resetSystemTracesForTests,
} from '@/lib/execution/systemTrace';

beforeEach(() => {
  __resetSystemTracesForTests();
});

afterEach(() => {
  __resetSystemTracesForTests();
});

describe('useSystemTraces', () => {
  it('updates both mounted consumers when a session starts', () => {
    const a = renderHook(() => useSystemTraces());
    const b = renderHook(() => useSystemTraces());

    act(() => {
      SystemTraceSession.start('design_conversation', 'Design Analysis');
    });

    expect(a.result.current.traces).toHaveLength(1);
    expect(b.result.current.traces).toHaveLength(1);
    expect(a.result.current.activeCount).toBe(1);
    expect(b.result.current.activeCount).toBe(1);
  });

  it('drops an abandoned session out of the active count', () => {
    const view = renderHook(() => useSystemTraces());

    let session!: SystemTraceSession;
    act(() => {
      session = SystemTraceSession.start('design_conversation', 'Abandoned');
    });
    expect(view.result.current.activeCount).toBe(1);

    // What the design hooks now do on unmount.
    act(() => {
      session.abandon();
    });
    expect(view.result.current.activeCount).toBe(0);
    expect(view.result.current.traces).toHaveLength(1);
    expect(view.result.current.errorCount).toBe(0);
  });

  it('keeps snapshot identity across a notify that changed nothing', () => {
    const view = renderHook(() => useSystemTraces());
    act(() => {
      SystemTraceSession.start('design_conversation', 'Design Analysis');
    });

    const before = view.result.current.traces;
    // Clearing an already-empty completed ring notifies without changing state.
    act(() => {
      clearCompletedTraces();
    });

    expect(view.result.current.traces).toBe(before);
  });
});
