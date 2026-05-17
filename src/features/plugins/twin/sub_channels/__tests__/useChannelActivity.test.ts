import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useChannelActivity } from '../useChannelActivity';
import type { TwinCommunication } from '@/lib/bindings/TwinCommunication';

// useSystemStore is mocked at file scope; each test reconfigures the
// returned slice shape via setStoreState below. This keeps the hook test
// purely about its derivation logic without booting the real zustand
// store or the IPC layer.

const setStoreState = vi.fn();

const mockState = {
  fetchTwinCommunications: vi.fn().mockResolvedValue(undefined),
  twinCommsLoading: false,
  twinCommunications: [] as TwinCommunication[],
};

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

function makeComm(over: Partial<TwinCommunication>): TwinCommunication {
  return {
    id: 'c',
    twin_id: 't1',
    channel: 'discord',
    direction: 'in',
    contact_handle: 'alice',
    content: 'hi',
    summary: null,
    key_facts_json: null,
    occurred_at: '2026-05-01T00:00:00Z',
    created_at: '2026-05-01T00:00:00Z',
    ...over,
  };
}

describe('useChannelActivity', () => {
  beforeEach(() => {
    setStoreState.mockReset();
    mockState.fetchTwinCommunications.mockClear();
    mockState.twinCommsLoading = false;
    mockState.twinCommunications = [];
  });

  it('returns an empty map when twin id is null', () => {
    const { result } = renderHook(() => useChannelActivity(null));
    expect(result.current.lastByChannel.size).toBe(0);
    expect(result.current.loading).toBe(false);
  });

  it('triggers fetchTwinCommunications when twinId is provided', () => {
    renderHook(() => useChannelActivity('t1'));
    expect(mockState.fetchTwinCommunications).toHaveBeenCalledWith('t1', undefined, 200);
  });

  it('derives the latest occurred_at per channel for the active twin', () => {
    mockState.twinCommunications = [
      makeComm({ id: '1', channel: 'discord', occurred_at: '2026-05-01T10:00:00Z' }),
      makeComm({ id: '2', channel: 'discord', occurred_at: '2026-05-03T10:00:00Z' }),
      makeComm({ id: '3', channel: 'discord', occurred_at: '2026-05-02T10:00:00Z' }),
      makeComm({ id: '4', channel: 'email',   occurred_at: '2026-05-04T10:00:00Z' }),
    ];
    const { result } = renderHook(() => useChannelActivity('t1'));
    expect(result.current.lastByChannel.get('discord')).toBe('2026-05-03T10:00:00Z');
    expect(result.current.lastByChannel.get('email')).toBe('2026-05-04T10:00:00Z');
  });

  it('filters out communications scoped to other twins', () => {
    mockState.twinCommunications = [
      makeComm({ id: '1', twin_id: 't1', channel: 'discord', occurred_at: '2026-05-01T10:00:00Z' }),
      makeComm({ id: '2', twin_id: 't2', channel: 'discord', occurred_at: '2026-05-09T10:00:00Z' }),
      makeComm({ id: '3', twin_id: 't1', channel: 'slack',   occurred_at: '2026-05-05T10:00:00Z' }),
    ];
    const { result } = renderHook(() => useChannelActivity('t1'));
    expect(result.current.lastByChannel.get('discord')).toBe('2026-05-01T10:00:00Z');
    expect(result.current.lastByChannel.get('slack')).toBe('2026-05-05T10:00:00Z');
    expect(result.current.lastByChannel.size).toBe(2);
  });

  it('reflects the loading flag from the store', () => {
    mockState.twinCommsLoading = true;
    const { result } = renderHook(() => useChannelActivity('t1'));
    expect(result.current.loading).toBe(true);
  });
});
