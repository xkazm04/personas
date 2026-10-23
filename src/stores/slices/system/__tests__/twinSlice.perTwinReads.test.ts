import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/twin/twin', () => ({
  listChannels: vi.fn(),
  listCommunications: vi.fn(),
  listPendingMemories: vi.fn(),
}));

import * as twinApi from '@/api/twin/twin';
import { createTwinSlice, type TwinSlice } from '../twinSlice';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Minimal zustand-shaped harness around the slice creator. */
function harness() {
  let state = {} as TwinSlice & Record<string, unknown>;
  const set = (partial: unknown) => {
    const patch = typeof partial === 'function'
      ? (partial as (s: typeof state) => object)(state)
      : partial;
    state = { ...state, ...(patch as object) };
  };
  const get = () => state as never;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state = { ...(createTwinSlice as any)(set, get, {}) };
  return { get: () => state };
}

/** A row tagged with the twin it belongs to; the reads only pass rows through. */
const rowsOf = (twinId: string) => [{ id: `${twinId}-row`, twin_id: twinId }] as never[];

beforeEach(() => { vi.clearAllMocks(); });

/**
 * Same stale-async defect fetchTwinTones was fixed for: rapid twin selection
 * (A then B) let A's slower answer land after B's, so B's surfaces showed A's
 * channels, conversation history or readiness corpus.
 */
describe('twinSlice — per-twin reads are latest-wins', () => {
  const reads: Array<[string, keyof typeof twinApi, (s: TwinSlice, twinId: string) => Promise<void>, (s: TwinSlice) => unknown]> = [
    ['fetchTwinChannels', 'listChannels', (s, id) => s.fetchTwinChannels(id), (s) => s.twinChannels],
    ['fetchTwinCommunications', 'listCommunications', (s, id) => s.fetchTwinCommunications(id), (s) => s.twinCommunications],
    ['fetchTwinReadinessApproved', 'listPendingMemories', (s, id) => s.fetchTwinReadinessApproved(id), (s) => s.twinReadinessApproved],
  ];

  for (const [name, api, run, read] of reads) {
    it(`${name}: twin A's late answer does not overwrite twin B's`, async () => {
      const a = deferred<never[]>();
      const b = deferred<never[]>();
      vi.mocked(twinApi[api] as (...args: unknown[]) => Promise<never[]>)
        .mockReturnValueOnce(a.promise)
        .mockReturnValueOnce(b.promise);
      const h = harness();

      const pa = run(h.get(), 'A');
      const pb = run(h.get(), 'B');
      b.resolve(rowsOf('B'));
      await pb;
      a.resolve(rowsOf('A'));
      await pa;

      expect(read(h.get())).toEqual(rowsOf('B'));
    });
  }
});
