import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Shared, mutable mock state (hoisted so the vi.mock factories can close over it).
const h = vi.hoisted(() => {
  const overviewState = {
    homeOpenIncidents: 0 as number | null,
    homeActivePersonaWindow: null as { curr: number; prev: number } | null,
    homeEventWindow: null as { curr: number; prev: number } | null,
    primeHomeSpine: vi.fn(),
  };
  const pipelineState = {
    teams: [] as Array<{ id: string }>,
    fetchTeams: vi.fn().mockResolvedValue(undefined),
  };
  const attention = { counts: { unread_messages: 0, pending_reviews: 0 } as Record<string, number> };
  const vault = {
    credentials: [] as Array<{ id: string; service_type: string }>,
    fetchCredentials: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(() => () => {}),
  };
  return { overviewState, pipelineState, attention, vault };
});

vi.mock('@/stores/overviewStore', () => {
  const useOverviewStore = (sel: (s: typeof h.overviewState) => unknown) => sel(h.overviewState);
  useOverviewStore.getState = () => h.overviewState;
  return { useOverviewStore };
});

vi.mock('@/stores/pipelineStore', () => {
  const usePipelineStore = (sel: (s: typeof h.pipelineState) => unknown) => sel(h.pipelineState);
  usePipelineStore.getState = () => h.pipelineState;
  return { usePipelineStore };
});

vi.mock('@/hooks/useAttention', () => ({
  useAttention: () => h.attention,
}));

vi.mock('@/stores/vaultStore', () => {
  const useVaultStore = { getState: () => h.vault, subscribe: h.vault.subscribe };
  return { useVaultStore };
});

import { useNavCardStatus } from './useNavCardStatus';

function chip(map: Record<string, { key: string; value: number; tone: string; trend?: string }[]>, card: string, key: string) {
  return map[card]?.find((c) => c.key === key);
}

describe('useNavCardStatus', () => {
  beforeEach(() => {
    h.overviewState.homeOpenIncidents = 0;
    h.overviewState.homeActivePersonaWindow = null;
    h.overviewState.homeEventWindow = null;
    h.overviewState.primeHomeSpine.mockClear();
    h.pipelineState.teams = [];
    h.pipelineState.fetchTeams.mockClear();
    h.attention.counts = { unread_messages: 0, pending_reviews: 0 };
    h.vault.credentials = [];
  });

  it('primes the shared spine and fetches teams on mount (no own IPC)', () => {
    renderHook(() => useNavCardStatus());
    expect(h.overviewState.primeHomeSpine).toHaveBeenCalledTimes(1);
    expect(h.pipelineState.fetchTeams).toHaveBeenCalledTimes(1);
  });

  it('maps spine window values into persona + event chips with a trend', () => {
    h.overviewState.homeActivePersonaWindow = { curr: 5, prev: 2 };
    h.overviewState.homeEventWindow = { curr: 3, prev: 8 };
    const { result } = renderHook(() => useNavCardStatus());

    const personas = chip(result.current, 'personas', 'agents');
    expect(personas?.value).toBe(5);
    expect(personas?.tone).toBe('cyan');
    expect(personas?.trend).toBe('up'); // 5 > 2

    const events = chip(result.current, 'events', 'events');
    expect(events?.value).toBe(3);
    expect(events?.trend).toBe('down'); // 3 < 8
  });

  it('shows an incidents chip only when the spine reports open incidents', () => {
    h.overviewState.homeOpenIncidents = 0;
    const empty = renderHook(() => useNavCardStatus());
    expect(chip(empty.result.current, 'overview', 'incidents')).toBeUndefined();

    h.overviewState.homeOpenIncidents = 4;
    const withInc = renderHook(() => useNavCardStatus());
    const inc = chip(withInc.result.current, 'overview', 'incidents');
    expect(inc?.value).toBe(4);
    expect(inc?.tone).toBe('red');
  });

  it('splits credentials into external vs built-in from the vault source', async () => {
    // codebase = local/built-in connector; slack = external (see connectorScope).
    h.vault.credentials = [
      { id: '1', service_type: 'slack' },
      { id: '2', service_type: 'codebase' },
    ];
    const { result } = renderHook(() => useNavCardStatus());
    // The vault store is loaded via a dynamic import, so credentials settle async.
    await waitFor(() => {
      expect(chip(result.current, 'credentials', 'external')?.value).toBe(1);
    });
    expect(chip(result.current, 'credentials', 'builtin')?.value).toBe(1);
  });

  it('renders teams count from the pipeline store', () => {
    h.pipelineState.teams = [{ id: 'a' }, { id: 'b' }];
    const { result } = renderHook(() => useNavCardStatus());
    expect(chip(result.current, 'teams', 'teams')?.value).toBe(2);
  });
});
