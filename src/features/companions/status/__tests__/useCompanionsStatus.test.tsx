/**
 * The status read, and the one fact the backend cannot see.
 *
 * Curator's prerequisite — a workspace that maps a knowledge registry — lives
 * in the frontend's localStorage at this stage, so the backend reports her as
 * unblocked and this hook decides. These tests pin that override in both
 * directions, because getting it wrong is invisible: an un-overridden Curator
 * reads as ready-to-switch-on and the toggle simply does nothing useful.
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

interface Links {
  registries: Record<string, { id: string; fullName: string; clonePath: string }>;
  workspaceRegistry: Record<string, string>;
}
let links: Links = { registries: {}, workspaceRegistry: {} };

vi.mock('@/features/plugins/dev-tools/sub_workspaces/registry/registryLinkStore', () => ({
  registryLinkSnapshot: () => links,
  subscribeRegistryLinks: () => () => {},
}));

import { __resetCompanionsStatusForTests } from '../companionsStatusStore';
import { useCompanionsStatus } from '../useCompanionsStatus';

/** The backend's answer: Curator optimistic, because Rust cannot read the link. */
const BACKEND_ANSWER = {
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
    { id: 'curator', enabled: false, eligible: true, onboarded: true, detail: {} },
  ],
};

beforeEach(() => {
  handlers.clear();
  listenMock.mockClear();
  invokeMock.mockReset();
  links = { registries: {}, workspaceRegistry: {} };
  __resetCompanionsStatusForTests();
});

describe('useCompanionsStatus', () => {
  it('blocks Curator when no workspace maps a registry, whatever the backend said', async () => {
    invokeMock.mockResolvedValue(BACKEND_ANSWER);
    const { result } = renderHook(() => useCompanionsStatus());

    await waitFor(() => expect(result.current.companions).not.toBeNull());
    const curator = result.current.byId('curator');
    expect(curator?.eligible).toBe(false);
    expect(curator?.blocker).toBe('no_registry');
    // The switch itself is untouched: losing a prerequisite must never rewrite
    // the operator's intent.
    expect(curator?.enabled).toBe(false);
  });

  it('marks Curator eligible and fills the registry detail when one is mapped', async () => {
    links = {
      registries: {
        'acme/registry': {
          id: 'acme/registry',
          fullName: 'acme/registry',
          clonePath: 'C:/checkouts/registry',
        },
      },
      workspaceRegistry: { 'ws-1': 'acme/registry' },
    };
    invokeMock.mockResolvedValue(BACKEND_ANSWER);
    const { result } = renderHook(() => useCompanionsStatus());

    await waitFor(() => expect(result.current.companions).not.toBeNull());
    const curator = result.current.byId('curator');
    expect(curator?.eligible).toBe(true);
    expect(curator?.blocker).toBeUndefined();
    expect(curator?.detail.registryName).toBe('acme/registry');
    expect(curator?.detail.registryPath).toBe('C:/checkouts/registry');
  });

  it('leaves the other two companions exactly as the backend reported them', async () => {
    invokeMock.mockResolvedValue(BACKEND_ANSWER);
    const { result } = renderHook(() => useCompanionsStatus());

    await waitFor(() => expect(result.current.companions).not.toBeNull());
    expect(result.current.byId('athena')).toEqual(BACKEND_ANSWER.companions[0]);
    expect(result.current.byId('overseer')).toEqual(BACKEND_ANSWER.companions[1]);
  });

  it('adopts a status-changed event without reading back', async () => {
    invokeMock.mockResolvedValue(BACKEND_ANSWER);
    const { result } = renderHook(() => useCompanionsStatus());
    await waitFor(() => expect(result.current.companions).not.toBeNull());
    const callsAfterFirstRead = invokeMock.mock.calls.length;

    act(() => {
      handlers.get('companions://status-changed')?.({
        payload: {
          companions: [
            { id: 'athena', enabled: false, eligible: true, onboarded: true, detail: {} },
            {
              id: 'overseer',
              enabled: true,
              eligible: true,
              onboarded: true,
              detail: { starredCount: 2, agentsTotal: 4 },
            },
            { id: 'curator', enabled: false, eligible: true, onboarded: true, detail: {} },
          ],
        },
      });
    });

    // Delivery is coalesced per animation frame by the shared singleton
    // listener, so this settles on the next frame rather than synchronously.
    await waitFor(() => expect(result.current.byId('athena')?.enabled).toBe(false));
    expect(result.current.byId('overseer')?.detail.starredCount).toBe(2);
    // The event CARRIES the whole status, so nothing re-invokes on it.
    expect(invokeMock.mock.calls.length).toBe(callsAfterFirstRead);
  });

  it('shares one read and one listener across concurrent consumers', async () => {
    invokeMock.mockResolvedValue(BACKEND_ANSWER);
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
