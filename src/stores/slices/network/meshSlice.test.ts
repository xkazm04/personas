import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/network/mesh', () => ({
  meshDeviceSnapshots: vi.fn(),
  meshSendVerb: vi.fn(),
  meshQueueMove: vi.fn(),
}));
vi.mock('@/api/fleet/resources', () => ({ resourceLiveSamples: vi.fn() }));

import * as mesh from '@/api/network/mesh';
import * as resources from '@/api/fleet/resources';
import type { LiveResourceSample } from '@/lib/bindings/LiveResourceSample';
import type { MeshDeviceView } from '@/lib/bindings/MeshDeviceView';
import type { RemoteJob } from '@/lib/bindings/RemoteJob';
import type { SystemStore } from '../../storeTypes';
import {
  agentOutcomeKey,
  createMeshSlice,
  effectiveLiveness,
  MESH_SNAPSHOT_STALE_MS,
  moveOutcomeKey,
} from './meshSlice';

const applyRemoteJobUpdate = vi.fn();

function makeHarness() {
  let state = { applyRemoteJobUpdate } as unknown as SystemStore;
  const set = (partial: Partial<SystemStore> | ((s: SystemStore) => Partial<SystemStore>)) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...patch };
  };
  const slice = createMeshSlice(set as never, (() => state) as never, {} as never);
  state = { ...state, ...slice };
  return { get: () => state };
}

const view = (peerId: string, over: Partial<MeshDeviceView> = {}): MeshDeviceView => ({
  peerId, displayName: peerId, isSelf: false, isHome: false, reachability: 'connected', liveness: 'live',
  snapshot: null, receivedAtMs: Date.now(), lastProbe: null, ...over,
});

const sample = (runId: string): LiveResourceSample => ({
  runKind: 'fleet', runId, personaId: null, cpuShare: 0.3, ramShare: 0.1, gpuShare: null, dominant: 'cpu', atMs: 1,
});

const job = (over: Partial<RemoteJob>): RemoteJob => ({
  id: 'job-1', direction: 'outbound', peerId: 'peer-a', peerDisplayName: 'A', kind: 'mesh_verb', instruction: '',
  payloadJson: null, receipt: null, status: 'pending', summary: null, refusalReason: null, lastSeq: 0,
  createdAt: '', updatedAt: '', completedAt: null, ...over,
});

describe('meshSlice', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(mesh.meshSendVerb).mockReset();
    vi.mocked(mesh.meshQueueMove).mockReset();
    applyRemoteJobUpdate.mockReset();
  });

  it('a snapshot applied now is live, and 45 s later the tick turns it unknown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = makeHarness();
    h.get().applyDeviceSnapshot(view('peer-a', { receivedAtMs: 1_000_000 }));
    expect(h.get().meshLiveness['peer-a']).toBe('live');

    h.get().tickMeshLiveness(1_000_000 + MESH_SNAPSHOT_STALE_MS);
    expect(h.get().meshLiveness['peer-a']).toBe('live');
    h.get().tickMeshLiveness(1_000_000 + MESH_SNAPSHOT_STALE_MS + 1);
    expect(h.get().meshLiveness['peer-a']).toBe('unknown');
  });

  it('the tick rewrites nothing while no answer changes', () => {
    const h = makeHarness();
    h.get().applyDeviceSnapshot(view('peer-a'));
    const before = h.get().meshLiveness;
    h.get().tickMeshLiveness();
    expect(h.get().meshLiveness).toBe(before);
  });

  it('this device is always live; a stored unknown stays unknown however fresh', () => {
    expect(effectiveLiveness(view('me', { isSelf: true, receivedAtMs: 0 }), 10_000_000)).toBe('live');
    expect(effectiveLiveness(view('p', { liveness: 'unknown' }), Date.now())).toBe('unknown');
    expect(effectiveLiveness(view('p', { receivedAtMs: null }), Date.now())).toBe('unknown');
  });

  it('a snapshot replaces its device by peerId and keeps the others', () => {
    const h = makeHarness();
    h.get().applyDeviceSnapshot(view('peer-a', { displayName: 'old' }));
    h.get().applyDeviceSnapshot(view('peer-b'));
    h.get().applyDeviceSnapshot(view('peer-a', { displayName: 'new' }));
    expect(h.get().meshDevices.map((d) => [d.peerId, d.displayName])).toEqual([['peer-a', 'new'], ['peer-b', 'peer-b']]);
  });

  it('samples replace the whole map: a run missing from the push is gone', () => {
    const h = makeHarness();
    h.get().applyResourceSamples([sample('s1'), sample('s2')]);
    expect(Object.keys(h.get().liveSamples).sort()).toEqual(['s1', 's2']);
    h.get().applyResourceSamples([sample('s2')]);
    expect(Object.keys(h.get().liveSamples)).toEqual(['s2']);
    h.get().applyResourceSamples([]);
    expect(h.get().liveSamples).toEqual({});
  });

  it('a refused verb surfaces the peer reason on its row, not as a throw', async () => {
    vi.mocked(mesh.meshSendVerb).mockResolvedValue(job({ status: 'refused', refusalReason: 'project_off' }));
    const h = makeHarness();
    const outcome = await h.get().toggleRemoteAgent('peer-a', 'persona-1', true);
    expect(mesh.meshSendVerb).toHaveBeenCalledWith('peer-a', { verb: 'persona_set_enabled', personaId: 'persona-1', enabled: true });
    expect(outcome).toMatchObject({ state: 'refused', reason: 'project_off', peerId: 'peer-a' });
    expect(h.get().meshOutcomes[agentOutcomeKey('peer-a', 'persona-1')]).toMatchObject({ state: 'refused', reason: 'project_off' });
    expect(applyRemoteJobUpdate).toHaveBeenCalledTimes(1);
  });

  it('an offline peer answers queued; an IPC failure becomes the row reason', async () => {
    vi.mocked(mesh.meshSendVerb).mockResolvedValue(job({ status: 'queued' }));
    vi.mocked(mesh.meshQueueMove).mockRejectedValue(new Error('mesh_queue_move: the device mesh is not wired in this build yet.'));
    const h = makeHarness();
    expect((await h.get().remoteQueueVerb('peer-a', { verb: 'queue_cancel', sessionId: 's1' })).state).toBe('queued');
    const moved = await h.get().moveQueuedToDevice('s9', 'peer-b');
    expect(moved.state).toBe('refused');
    expect(moved.reason).toBeTruthy();
    expect(h.get().meshOutcomes[moveOutcomeKey('s9')]?.peerId).toBe('peer-b');
  });
  it('a reconcile read never clobbers a newer pushed view', async () => {
    const h = makeHarness();
    vi.mocked(mesh.meshDeviceSnapshots).mockImplementation(async () => {
      // A push lands while the read is in flight.
      h.get().applyDeviceSnapshot(view('peer-a', { displayName: 'pushed', receivedAtMs: 2_000 }));
      return [view('peer-a', { displayName: 'read', receivedAtMs: 1_000 }), view('peer-b', { receivedAtMs: 1_000 })];
    });
    await h.get().refreshMeshDevices();
    expect(h.get().meshDevices.map((d) => [d.peerId, d.displayName])).toEqual([['peer-a', 'pushed'], ['peer-b', 'peer-b']]);
  });

  it('a sample read is dropped when a push landed while it was in flight', async () => {
    const h = makeHarness();
    vi.mocked(resources.resourceLiveSamples).mockImplementation(async () => {
      h.get().applyResourceSamples([sample('pushed')]);
      return [sample('stale-read')];
    });
    await h.get().refreshLiveSamples();
    expect(Object.keys(h.get().liveSamples)).toEqual(['pushed']);
  });
});
