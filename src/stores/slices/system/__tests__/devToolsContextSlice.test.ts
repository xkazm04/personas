// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/api/devTools/devTools', () => ({
  listContextGroups: vi.fn(),
  listContexts: vi.fn(),
}));

import * as devApi from '@/api/devTools/devTools';
import { createDevToolsContextSlice, type DevToolsContextSlice } from '../devToolsContextSlice';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Minimal zustand-shaped harness around the slice creator. */
function harness() {
  let state = {} as DevToolsContextSlice & { error: unknown };
  const set = (partial: unknown) => {
    const patch = typeof partial === 'function'
      ? (partial as (s: typeof state) => object)(state)
      : partial;
    state = { ...state, ...(patch as object) };
  };
  const get = () => state;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state = { ...(createDevToolsContextSlice as any)(set, get, {}), error: null };
  return { get: () => state };
}

/**
 * ContextMapPage fires fetchContextGroups and fetchContexts together and gates
 * its zero-groups empty state on ONE flag, contextMapLoading. Each fetch used
 * to clear the flag on its own settle, so the faster one ended "loading" while
 * the other was still in flight: the page flashed "no context groups".
 */
describe('devToolsContextSlice — contextMapLoading spans both map reads', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('stays true until the LAST of the two reads settles', async () => {
    const groups = deferred<never[]>();
    const contexts = deferred<never[]>();
    vi.mocked(devApi.listContextGroups).mockReturnValueOnce(groups.promise);
    vi.mocked(devApi.listContexts).mockReturnValueOnce(contexts.promise);
    const h = harness();

    const pg = h.get().fetchContextGroups('p1');
    const pc = h.get().fetchContexts('p1');
    expect(h.get().contextMapLoading).toBe(true);

    contexts.resolve([]);
    await pc;
    expect(h.get().contextMapLoading).toBe(true);

    groups.resolve([]);
    await pg;
    expect(h.get().contextMapLoading).toBe(false);
  });

  it('a failed read still releases its share of the flag', async () => {
    vi.mocked(devApi.listContextGroups).mockRejectedValueOnce({ error: 'db locked', kind: 'database' });
    vi.mocked(devApi.listContexts).mockResolvedValueOnce([]);
    const h = harness();

    await Promise.all([h.get().fetchContextGroups('p1'), h.get().fetchContexts('p1')]);
    expect(h.get().contextMapLoading).toBe(false);
  });
});
