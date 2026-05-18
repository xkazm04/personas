/**
 * Unit tests for useMcpRequestBridge + resolveMcpRequest + the MCP
 * pending-request store. Pure JS — no Rust, no real Tauri runtime.
 *
 * What we cover:
 *  - Snapshot fetch on mount populates the store with stub payloads.
 *  - Live `athena://mcp/guidance-request` event lands a guidance card
 *    in the store with the parsed payload.
 *  - Live `athena://mcp/approval-request` event lands an approval card.
 *  - Duplicate request_id is deduped (snapshot + live race).
 *  - resolveMcpRequest invokes companion_mcp_resolve_request and
 *    removes the request from the store on success.
 *  - Backend returning false leaves the request in place.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const handlers = new Map<string, (event: { payload: unknown }) => void>();
const unlisten = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(name, cb);
    return Promise.resolve(unlisten);
  }),
}));

const invokeMock = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...args: unknown[]) => invokeMock(...args),
}));

import {
  useMcpRequestBridge,
  resolveMcpRequest,
} from '../mcp/useMcpRequestBridge';
import { useMcpRequestStore } from '../mcp/mcpRequestStore';

beforeEach(() => {
  handlers.clear();
  invokeMock.mockReset();
  useMcpRequestStore.getState().clear();
});

describe('useMcpRequestBridge', () => {
  it('seeds the store from the initial snapshot', async () => {
    invokeMock.mockResolvedValueOnce([
      { requestId: 'mcpreq_snap1', kind: 'guidance', fleetSessionId: 'fs-a' },
      { requestId: 'mcpreq_snap2', kind: 'approval', fleetSessionId: 'fs-b' },
    ]);

    renderHook(() => useMcpRequestBridge());

    await waitFor(() => {
      expect(useMcpRequestStore.getState().pendingRequests).toHaveLength(2);
    });
    const list = useMcpRequestStore.getState().pendingRequests;
    expect(list.map((r) => r.requestId)).toEqual([
      'mcpreq_snap1',
      'mcpreq_snap2',
    ]);
    expect(list[0].kind).toBe('guidance');
    expect(list[1].kind).toBe('approval');
  });

  it('appends live guidance requests', async () => {
    invokeMock.mockResolvedValueOnce([]); // empty snapshot
    renderHook(() => useMcpRequestBridge());

    await waitFor(() => {
      expect(handlers.has('athena://mcp/guidance-request')).toBe(true);
    });

    act(() => {
      handlers.get('athena://mcp/guidance-request')!({
        payload: {
          requestId: 'mcpreq_g1',
          fleetSessionId: 'fs-g',
          kind: 'guidance',
          payload: { question: 'which auth lib?', context: 'see migration X' },
        },
      });
    });

    const reqs = useMcpRequestStore.getState().pendingRequests;
    expect(reqs).toHaveLength(1);
    expect(reqs[0].kind).toBe('guidance');
    expect((reqs[0].payload as { question: string }).question).toBe(
      'which auth lib?',
    );
  });

  it('appends live approval requests', async () => {
    invokeMock.mockResolvedValueOnce([]);
    renderHook(() => useMcpRequestBridge());

    await waitFor(() => {
      expect(handlers.has('athena://mcp/approval-request')).toBe(true);
    });

    act(() => {
      handlers.get('athena://mcp/approval-request')!({
        payload: {
          requestId: 'mcpreq_a1',
          fleetSessionId: 'fs-a',
          kind: 'approval',
          payload: {
            action: 'force-push to origin/main',
            rationale: 'rebased the feature branch',
            details: { ref: 'origin/main' },
          },
        },
      });
    });

    const reqs = useMcpRequestStore.getState().pendingRequests;
    expect(reqs).toHaveLength(1);
    expect(reqs[0].kind).toBe('approval');
    const payload = reqs[0].payload as { action: string; rationale: string };
    expect(payload.action).toBe('force-push to origin/main');
    expect(payload.rationale).toBe('rebased the feature branch');
  });

  it('dedupes a snapshot-then-live race on the same request_id', async () => {
    invokeMock.mockResolvedValueOnce([
      { requestId: 'mcpreq_dup', kind: 'guidance', fleetSessionId: 'fs-x' },
    ]);
    renderHook(() => useMcpRequestBridge());

    await waitFor(() => {
      expect(handlers.has('athena://mcp/guidance-request')).toBe(true);
    });

    act(() => {
      handlers.get('athena://mcp/guidance-request')!({
        payload: {
          requestId: 'mcpreq_dup',
          fleetSessionId: 'fs-x',
          kind: 'guidance',
          payload: { question: 'live payload', context: null },
        },
      });
    });

    expect(useMcpRequestStore.getState().pendingRequests).toHaveLength(1);
  });
});

describe('resolveMcpRequest', () => {
  it('removes the request from the store on success', async () => {
    useMcpRequestStore.getState().addRequest({
      requestId: 'mcpreq_r1',
      fleetSessionId: 'fs-r',
      kind: 'guidance',
      payload: { question: 'q', context: null },
      receivedAt: Date.now(),
    });
    invokeMock.mockResolvedValueOnce(true);

    const ok = await resolveMcpRequest('mcpreq_r1', { text: 'use the new lib' });
    expect(ok).toBe(true);
    expect(useMcpRequestStore.getState().pendingRequests).toHaveLength(0);
    expect(invokeMock).toHaveBeenCalledWith('companion_mcp_resolve_request', {
      requestId: 'mcpreq_r1',
      response: { text: 'use the new lib' },
    });
  });

  it('leaves the request in place when backend returns false', async () => {
    useMcpRequestStore.getState().addRequest({
      requestId: 'mcpreq_r2',
      fleetSessionId: 'fs-r',
      kind: 'guidance',
      payload: { question: 'q', context: null },
      receivedAt: Date.now(),
    });
    invokeMock.mockResolvedValueOnce(false);

    const ok = await resolveMcpRequest('mcpreq_r2', { text: 'whatever' });
    expect(ok).toBe(false);
    expect(useMcpRequestStore.getState().pendingRequests).toHaveLength(1);
  });
});
