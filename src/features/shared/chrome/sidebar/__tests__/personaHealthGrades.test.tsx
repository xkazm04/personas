/**
 * The Agents nav's health dots subscribe to the whole overviewStore. Only a
 * change of `healthSignals` may re-render it: before, every unrelated store
 * write (process events, cost ticks) built a fresh grade map and re-rendered
 * the whole nav.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const { store } = vi.hoisted(() => {
  type S = { healthSignals: Array<{ personaId: string; grade: string }>; other: number };
  let state: S = { healthSignals: [{ personaId: 'p1', grade: 'healthy' }], other: 0 };
  const listeners = new Set<(s: S) => void>();
  return {
    store: {
      getState: () => state,
      setState: (patch: Partial<S>) => { state = { ...state, ...patch }; for (const l of listeners) l(state); },
      subscribe: (l: (s: S) => void) => { listeners.add(l); return () => listeners.delete(l); },
    },
  };
});
vi.mock('@/stores/overviewStore', () => ({ useOverviewStore: store }));

import { usePersonaHealthGrades } from '../sections/AgentsSidebarNav';

describe('usePersonaHealthGrades', () => {
  it('re-renders on a health change and not on unrelated store writes', async () => {
    let renders = 0;
    const { result } = renderHook(() => { renders += 1; return usePersonaHealthGrades(); });
    await waitFor(() => expect(result.current).toEqual({ p1: 'healthy' }));
    const settled = renders;

    for (let i = 1; i <= 10; i += 1) act(() => store.setState({ other: i }));
    expect(renders - settled).toBe(0);

    act(() => store.setState({ healthSignals: [{ personaId: 'p1', grade: 'degraded' }] }));
    expect(result.current).toEqual({ p1: 'degraded' });
    expect(renders - settled).toBe(1);
  });
});
