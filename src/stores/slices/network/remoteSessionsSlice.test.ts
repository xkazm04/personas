import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/network/remoteSessions', () => ({
  listRemoteSessions: vi.fn(),
  listDispatchDevices: vi.fn(),
  dispatchRemoteFleetSession: vi.fn(),
  remoteSessionCommand: vi.fn(),
  remoteSessionSubscribeOutput: vi.fn(),
}));

import * as api from '@/api/network/remoteSessions';
import type { RemoteSessionView } from '@/lib/bindings/RemoteSessionView';
import type { SystemStore } from '../../storeTypes';
import { P2pUnavailableError } from './networkSlice';
import {
  createRemoteSessionsSlice,
  resetRemoteSessionsSliceForTests,
  selectRemoteDispatchAvailable,
} from './remoteSessionsSlice';

let p2p = true;
const applyRemoteJobUpdate = vi.fn();

function makeHarness() {
  let state = {
    ensureP2pSupport: vi.fn(async () => p2p),
    p2pUnavailable: !p2p,
    applyRemoteJobUpdate,
  } as unknown as SystemStore;
  const set = (partial: Partial<SystemStore> | ((s: SystemStore) => Partial<SystemStore>)) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...patch };
  };
  const slice = createRemoteSessionsSlice(set as never, (() => state) as never, {} as never);
  state = { ...state, ...slice };
  return { get: () => state };
}

const view = (over: Partial<RemoteSessionView> = {}): RemoteSessionView => ({
  jobId: 'job-1', sessionId: null, peerId: 'peer-1', peerDisplayName: 'Desk', projectId: 'p1',
  projectLabel: 'repo', githubUrl: 'https://github.com/o/r', title: null, state: 'running',
  stateReason: null, mode: 'headless', createdAtMs: 1, lastActivityMs: 2, mirrorAtMs: 2,
  jobStatus: 'running', receipt: null, ...over,
});

describe('remoteSessionsSlice', () => {
  beforeEach(() => {
    p2p = true;
    resetRemoteSessionsSliceForTests();
    vi.mocked(api.listRemoteSessions).mockReset();
    vi.mocked(api.listDispatchDevices).mockReset();
    vi.mocked(api.dispatchRemoteFleetSession).mockReset();
    applyRemoteJobUpdate.mockReset();
  });

  it('upserts a pushed view by job id and ignores a late regression', () => {
    const h = makeHarness();
    h.get().applyRemoteSessionUpdate(view({ jobStatus: 'running', mirrorAtMs: 10 }));
    h.get().applyRemoteSessionUpdate(view({ jobStatus: 'completed', state: 'exited', mirrorAtMs: 20 }));
    const before = h.get().remoteSessions;
    h.get().applyRemoteSessionUpdate(view({ jobStatus: 'running', mirrorAtMs: 30 }));
    expect(h.get().remoteSessions).toBe(before);
    expect(h.get().remoteSessions['job-1']?.jobStatus).toBe('completed');
  });

  it('loads both lists when p2p is available', async () => {
    vi.mocked(api.listRemoteSessions).mockResolvedValue([view()]);
    vi.mocked(api.listDispatchDevices).mockResolvedValue([
      { peerId: 'peer-1', displayName: 'Desk', isHome: false, reachability: 'connected' },
    ]);
    const h = makeHarness();
    await h.get().loadRemoteSessions();
    expect(Object.keys(h.get().remoteSessions)).toEqual(['job-1']);
    expect(h.get().dispatchDevices).toHaveLength(1);
    expect(h.get().remoteSessionsSynced).toBe(true);
    expect(selectRemoteDispatchAvailable(h.get())).toBe(true);
  });

  it('is a no-op without p2p: nothing is read, the state stays empty', async () => {
    p2p = false;
    const h = makeHarness();
    await h.get().loadRemoteSessions();
    await h.get().refreshDispatchDevices();
    expect(api.listRemoteSessions).not.toHaveBeenCalled();
    expect(api.listDispatchDevices).not.toHaveBeenCalled();
    expect(h.get().remoteSessions).toEqual({});
    expect(h.get().dispatchDevices).toEqual([]);
    expect(selectRemoteDispatchAvailable(h.get())).toBe(false);
    await expect(h.get().dispatchRemoteSession('peer-1', {
      projectId: 'p1', githubUrl: 'u', projectName: 'n', prompt: 'x', mode: 'headless', branch: '', personaId: null,
    })).rejects.toBeInstanceOf(P2pUnavailableError);
  });

  it('a coalesced device refresh waits for a first load', async () => {
    const h = makeHarness();
    await h.get().refreshDispatchDevices({ coalesce: true });
    expect(api.listDispatchDevices).not.toHaveBeenCalled();
  });

  it('a dispatch lands the job in the history at once', async () => {
    const job = { id: 'job-9', status: 'queued' } as never;
    vi.mocked(api.dispatchRemoteFleetSession).mockResolvedValue(job);
    vi.mocked(api.listRemoteSessions).mockResolvedValue([]);
    vi.mocked(api.listDispatchDevices).mockResolvedValue([]);
    const h = makeHarness();
    await h.get().dispatchRemoteSession('peer-1', {
      projectId: 'p1', githubUrl: 'u', projectName: 'n', prompt: 'x', mode: 'headless', branch: '', personaId: null,
    });
    expect(applyRemoteJobUpdate).toHaveBeenCalledWith(job);
  });
});
