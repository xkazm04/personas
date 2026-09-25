/**
 * The status read.
 *
 * Until migration e47 this hook PATCHED Curator's eligibility from the browser
 * link store, because Rust could not read it. The backend answers now, so the
 * first test below is the one that matters: whatever the backend says about
 * Curator reaches the surface unaltered. A hook that silently improved on it
 * would put the landing page and Curator's own loop on different facts again,
 * which is exactly the seam that was closed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const handlers = new Map<string, (event: { payload: unknown }) => void>();
const unlisten = vi.fn();

const listenMock = vi.fn((name: string, cb: (e: { payload: unknown }) => void) => {
  handlers.set(name, cb);
  return Promise.resolve(unlisten);
});
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: Parameters<typeof listenMock>) => listenMock(...args),
}));

const invokeMock = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...args: unknown[]) => invokeMock(...args),
}));

import { __resetCompanionsStatusForTests } from '../companionsStatusStore';
import { useCompanionsStatus } from '../useCompanionsStatus';

/** The backend's answer with no registry wired — Curator blocked, by Rust. */
const NO_REGISTRY = {
  companions: [
    { id: 'athena', enabled: true, eligible: true, onboarded: true, detail: {} },
    {
      id: 'overseer',
      enabled: false,
      eligible: false,
      blocker: 'no_starred_personas',
      onboarded: true,
      detail: { starredCount: 0, agentsTotal: 4 },
    },
    {
      id: 'curator',
      enabled: false,
      eligible: false,
      blocker: 'no_registry',
      onboarded: true,
      detail: {},
    },
  ],
};

/** The same read once a held registry's checkout is on disk. */
const WITH_REGISTRY = {
  companions: [
    NO_REGISTRY.companions[0],
    NO_REGISTRY.companions[1],
    {
      id: 'curator',
      enabled: false,
      eligible: true,
      onboarded: true,
      detail: { registryName: 'acme/registry', registryPath: 'C:/checkouts/registry' },
    },
  ],
};

beforeEach(() => {
  handlers.clear();
  listenMock.mockClear();
  invokeMock.mockReset();
  __resetCompanionsStatusForTests();
});

describe('useCompanionsStatus', () => {
  it('reports every companion exactly as the backend did', async () => {
    invokeMock.mockResolvedValue(NO_REGISTRY);
    const { result } = renderHook(() => useCompanionsStatus());

    await waitFor(() => expect(result.current.companions).not.toBeNull());
    expect(result.current.companions).toEqual(NO_REGISTRY.companions);
    const curator = result.current.byId('curator');
    expect(curator?.eligible).toBe(false);
    expect(curator?.blocker).toBe('no_registry');
    // The switch itself is untouched: losing a prerequisite must never rewrite
    // the operator's intent.
    expect(curator?.enabled).toBe(false);
  });

  it('carries the registry detail the backend filled in', async () => {
    invokeMock.mockResolvedValue(WITH_REGISTRY);
    const { result } = renderHook(() => useCompanionsStatus());

    await waitFor(() => expect(result.current.companions).not.toBeNull());
    const curator = result.current.byId('curator');
    expect(curator?.eligible).toBe(true);
    expect(curator?.blocker).toBeUndefined();
    expect(curator?.detail.registryName).toBe('acme/registry');
    expect(curator?.detail.registryPath).toBe('C:/checkouts/registry');
  });

  it('adopts a status-changed event without reading back', async () => {
    invokeMock.mockResolvedValue(NO_REGISTRY);
    const { result } = renderHook(() => useCompanionsStatus());
    await waitFor(() => expect(result.current.companions).not.toBeNull());
    const callsAfterFirstRead = invokeMock.mock.calls.length;

    // This is the path a registry link takes now: the link command emits the
    // whole category, and Curator flips to eligible without anyone re-reading.
    act(() => {
      handlers.get('companions://status-changed')?.({ payload: WITH_REGISTRY });
    });

    // Delivery is coalesced per animation frame by the shared singleton
    // listener, so this settles on the next frame rather than synchronously.
    await waitFor(() => expect(result.current.byId('curator')?.eligible).toBe(true));
    expect(result.current.byId('curator')?.detail.registryName).toBe('acme/registry');
    // The event CARRIES the whole status, so nothing re-invokes on it.
    expect(invokeMock.mock.calls.length).toBe(callsAfterFirstRead);
  });

  it('shares one read and one listener across concurrent consumers', async () => {
    invokeMock.mockResolvedValue(NO_REGISTRY);
    const a = renderHook(() => useCompanionsStatus());
    const b = renderHook(() => useCompanionsStatus());

    await waitFor(() => expect(a.result.current.companions).not.toBeNull());
    await waitFor(() => expect(b.result.current.companions).not.toBeNull());
    // Both mounted inside one tick, so their reads were deduped into one call
    // and their subscriptions into one native listener.
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'companions_status').length).toBe(1);
    expect(listenMock.mock.calls.filter((c) => c[0] === 'companions://status-changed').length).toBe(
      1,
    );
  });
});
