/**
 * The queue lane's sample proposals: open ones only, joined to their sample,
 * refetched when that twin's `twin-sample-updated` arrives, a resolved one
 * leaves at once, and both failure shapes degrade the way the lane needs (a
 * failed load is silent and empty; a failed verdict is an inline error on that
 * proposal, never a toast).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import type { TwinSampleUpdatedEvent } from '@/lib/bindings/TwinSampleUpdatedEvent';

const h = vi.hoisted(() => ({
  handler: null as null | ((payload: TwinSampleUpdatedEvent) => void),
  order: [] as string[],
}));

vi.mock('@/api/twin/twinSample', () => ({
  sampleProposals: vi.fn(),
  sampleList: vi.fn(),
  sampleResolve: vi.fn(),
}));

vi.mock('@/lib/eventRegistry', () => ({
  EventName: { TWIN_SAMPLE_UPDATED: 'twin-sample-updated' },
  typedListen: vi.fn(async (_name: string, handler: (payload: TwinSampleUpdatedEvent) => void) => {
    h.order.push('attach');
    h.handler = handler;
    return () => undefined;
  }),
}));

vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => () => undefined,
  extractMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import * as api from '@/api/twin/twinSample';
import { useSampleProposals } from '../useSampleProposals';

const sampleProposals = vi.mocked(api.sampleProposals);
const sampleList = vi.mocked(api.sampleList);
const sampleResolve = vi.mocked(api.sampleResolve);

const P = (id: string, status = 'open') => ({
  id, sampleId: 's1', twinId: 't1', kind: 'voice', channel: 'email', value: 'v', reason: null,
  status, createdAt: '2026-10-01T10:00:00Z', resolvedAt: null,
});
const S = { id: 's1', twinId: 't1', text: 'x', channel: null, sourceKind: 'clipboard', sourceHost: null,
  status: 'ready', error: null, createdAt: '2026-10-01T10:00:00Z', analyzedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  h.handler = null;
  h.order.length = 0;
  sampleList.mockResolvedValue([S]);
  sampleProposals.mockImplementation(async () => {
    h.order.push('snapshot');
    return [];
  });
});

describe('useSampleProposals', () => {
  it('attaches to the event before it takes the snapshot, so no analysis falls in between', async () => {
    renderHook(() => useSampleProposals('t1'));
    await waitFor(() => expect(h.order).toEqual(['attach', 'snapshot']));
  });

  it('loads open proposals joined to their sample', async () => {
    sampleProposals.mockResolvedValue([P('p1'), P('p2', 'accepted')]);
    const { result } = renderHook(() => useSampleProposals('t1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(sampleProposals).toHaveBeenCalledWith('t1', 'open');
    expect(result.current.items[0]).toMatchObject({ proposal: { id: 'p1' }, sample: { id: 's1' } });
  });

  it('refetches on its own twin\'s sample event only', async () => {
    sampleProposals.mockResolvedValue([]);
    renderHook(() => useSampleProposals('t1'));
    await waitFor(() => expect(sampleProposals).toHaveBeenCalledTimes(1));

    sampleProposals.mockResolvedValue([P('p9')]);
    act(() => h.handler?.({ twinId: 't2', sampleId: 'x', status: 'ready', proposals: 1 }));
    expect(sampleProposals).toHaveBeenCalledTimes(1);
    act(() => h.handler?.({ twinId: 't1', sampleId: 's1', status: 'ready', proposals: 1 }));
    await waitFor(() => expect(sampleProposals).toHaveBeenCalledTimes(2));
  });

  it('a failed load (backend not built yet) is quiet and empty', async () => {
    sampleProposals.mockRejectedValue(new Error('not built yet'));
    const { result } = renderHook(() => useSampleProposals('t1'));
    await waitFor(() => expect(sampleProposals).toHaveBeenCalled());
    expect(result.current.items).toEqual([]);
    expect(result.current.errors).toEqual({});
  });

  it('a kept proposal leaves the lane; a failed one keeps its card with an inline error', async () => {
    sampleProposals.mockResolvedValue([P('p1'), P('p2')]);
    const { result } = renderHook(() => useSampleProposals('t1'));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    sampleResolve.mockResolvedValueOnce({ ...P('p1'), status: 'edited' });
    await act(() => result.current.resolve('p1', 'accept', 'better'));
    expect(sampleResolve).toHaveBeenCalledWith('p1', 'accept', 'better');
    expect(result.current.items.map((i) => i.proposal.id)).toEqual(['p2']);

    sampleResolve.mockRejectedValueOnce(new Error('door refused the value'));
    await act(() => result.current.resolve('p2', 'dismiss'));
    expect(sampleResolve).toHaveBeenLastCalledWith('p2', 'dismiss', null);
    expect(result.current.items.map((i) => i.proposal.id)).toEqual(['p2']);
    expect(result.current.errors.p2).toBe('door refused the value');
    expect(result.current.busyId).toBeNull();
  });

  it('no twin, no load', async () => {
    const { result } = renderHook(() => useSampleProposals(null));
    await act(async () => undefined);
    expect(sampleProposals).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });
});
