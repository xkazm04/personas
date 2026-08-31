import { describe, it, expect, vi } from 'vitest';

import type { DevScan } from '@/lib/bindings/DevScan';

import { groupScansByProject, mapWithConcurrency, failStatus, useSceneStore } from '../lib/sceneStore';

const listScansMock = vi.fn();
vi.mock('@/api/devTools/devTools', () => ({
  getCrossProjectMetadata: vi.fn(),
  listAllGoals: vi.fn(),
  listTasks: vi.fn(),
  listScans: (...args: unknown[]) => listScansMock(...args),
}));

const scan = (id: string, projectId: string | null, createdAt: string): DevScan => ({
  id,
  project_id: projectId,
  scan_type: 'idea',
  status: 'completed',
  idea_count: 0,
  input_tokens: null,
  output_tokens: null,
  duration_ms: null,
  error: null,
  created_at: createdAt,
});

describe('sceneStore — groupScansByProject', () => {
  it('groups a flat list by project id and drops null-project rows', () => {
    const rows = [
      scan('1', 'a', '2026-07-01T00:00:00Z'),
      scan('2', 'b', '2026-07-02T00:00:00Z'),
      scan('3', 'a', '2026-07-03T00:00:00Z'),
      scan('4', null, '2026-07-04T00:00:00Z'),
    ];
    const m = groupScansByProject(rows);
    expect([...m.keys()].sort()).toEqual(['a', 'b']);
    expect(m.get('a')).toHaveLength(2);
    expect(m.get('b')).toHaveLength(1);
  });

  it('orders each project newest-first so rows[0] is the freshest scan', () => {
    const rows = [
      scan('old', 'a', '2026-07-01T00:00:00Z'),
      scan('new', 'a', '2026-07-10T00:00:00Z'),
      scan('mid', 'a', '2026-07-05T00:00:00Z'),
    ];
    const m = groupScansByProject(rows);
    expect(m.get('a')!.map((r) => r.id)).toEqual(['new', 'mid', 'old']);
  });

  it('empty input → empty map', () => {
    expect(groupScansByProject([]).size).toBe(0);
  });
});

describe('sceneStore — failStatus', () => {
  it('a family that had data goes stale (keep showing it, flag it)', () => {
    expect(failStatus('loaded')).toBe('stale');
    expect(failStatus('stale')).toBe('stale');
  });
  it('a family that never loaded goes failed', () => {
    expect(failStatus('idle')).toBe('failed');
    expect(failStatus('loading')).toBe('failed');
    expect(failStatus('failed')).toBe('failed');
  });
});

describe('sceneStore — mapWithConcurrency', () => {
  it('preserves input order regardless of resolution order', async () => {
    const out = await mapWithConcurrency([30, 10, 20, 5], 2, (ms) =>
      new Promise<number>((r) => setTimeout(() => r(ms), ms)));
    expect(out).toEqual([30, 10, 20, 5]);
  });

  it('never exceeds the concurrency width', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

const defer = () => {
  let resolve!: (rows: DevScan[]) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<DevScan[]>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('sceneStore — latest-wins per family', () => {
  it('a superseded scans load cannot overwrite the newer answer', async () => {
    const stale = defer();
    const fresh = defer();
    listScansMock.mockReset();
    listScansMock.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);

    const store = useSceneStore.getState();
    const first = store.loadScans();
    // fresh: true — a deliberate supersede (the join path is covered below);
    // this is the onScanStatus shape: the world changed, never join.
    const second = store.loadScans({ fresh: true });

    // The SECOND request answers first; the first one lands afterwards with an
    // older view of the world. Nothing about the store's design orders these.
    fresh.resolve([scan('new', 'p', '2026-07-10T00:00:00Z')]);
    await second;
    stale.resolve([scan('old', 'p', '2026-07-01T00:00:00Z')]);
    await first;

    expect(useSceneStore.getState().scans.get('p')!.map((r) => r.id)).toEqual(['new']);
    expect(useSceneStore.getState().scansStatus).toBe('loaded');
  });
});

describe('sceneStore — in-flight dedup per family', () => {
  it('N concurrent mounts share ONE list call', async () => {
    const flight = defer();
    listScansMock.mockReset();
    listScansMock.mockReturnValue(flight.promise);

    const store = useSceneStore.getState();
    const a = store.loadScans();
    const b = store.loadScans();
    const c = store.loadScans();

    flight.resolve([scan('one', 'p', '2026-07-10T00:00:00Z')]);
    await Promise.all([a, b, c]);

    expect(listScansMock).toHaveBeenCalledTimes(1);
    expect(useSceneStore.getState().scans.get('p')!.map((r) => r.id)).toEqual(['one']);
  });

  it('a settled flight clears its entry — the next call fetches again', async () => {
    listScansMock.mockReset();
    listScansMock.mockResolvedValue([scan('again', 'p', '2026-07-11T00:00:00Z')]);

    await useSceneStore.getState().loadScans();
    await useSceneStore.getState().loadScans();
    expect(listScansMock).toHaveBeenCalledTimes(2);
  });
});

describe('sceneStore — invalidateScans keyed guards', () => {
  it('a stale scoped refresh is inert after a newer full loadScans', async () => {
    const scoped = defer();
    const full = defer();
    listScansMock.mockReset();
    listScansMock.mockReturnValueOnce(scoped.promise).mockReturnValueOnce(full.promise);

    const store = useSceneStore.getState();
    const invalidation = store.invalidateScans('p'); // departs first
    const reload = store.loadScans({ fresh: true }); // supersedes the whole map

    full.resolve([scan('full-new', 'p', '2026-07-10T00:00:00Z')]);
    await reload;
    scoped.resolve([scan('scoped-old', 'p', '2026-07-01T00:00:00Z')]);
    await invalidation;

    // The scoped merge must NOT overwrite the newer full answer.
    expect(useSceneStore.getState().scans.get('p')!.map((r) => r.id)).toEqual(['full-new']);
  });

  it('two invalidations for the same project: the newer one wins regardless of landing order', async () => {
    const first = defer();
    const second = defer();
    listScansMock.mockReset();
    listScansMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const store = useSceneStore.getState();
    const a = store.invalidateScans('p');
    const b = store.invalidateScans('p');

    second.resolve([scan('newer', 'p', '2026-07-10T00:00:00Z')]);
    await b;
    first.resolve([scan('older', 'p', '2026-07-01T00:00:00Z')]);
    await a;

    expect(useSceneStore.getState().scans.get('p')!.map((r) => r.id)).toEqual(['newer']);
  });

  it('distinct projects never cancel each other', async () => {
    const pa = defer();
    const pb = defer();
    listScansMock.mockReset();
    listScansMock.mockReturnValueOnce(pa.promise).mockReturnValueOnce(pb.promise);

    const store = useSceneStore.getState();
    const a = store.invalidateScans('a');
    const b = store.invalidateScans('b');

    pb.resolve([scan('b1', 'b', '2026-07-10T00:00:00Z')]);
    await b;
    pa.resolve([scan('a1', 'a', '2026-07-01T00:00:00Z')]);
    await a;

    expect(useSceneStore.getState().scans.get('a')!.map((r) => r.id)).toEqual(['a1']);
    expect(useSceneStore.getState().scans.get('b')!.map((r) => r.id)).toEqual(['b1']);
  });

  it('a failed scoped refresh keeps the cache and does not wedge the project slot', async () => {
    listScansMock.mockReset();
    listScansMock.mockResolvedValueOnce([scan('seed', 'p', '2026-07-01T00:00:00Z')]);
    await useSceneStore.getState().invalidateScans('p');

    listScansMock.mockRejectedValueOnce(new Error('ipc down'));
    await useSceneStore.getState().invalidateScans('p');
    expect(useSceneStore.getState().scans.get('p')!.map((r) => r.id)).toEqual(['seed']);

    // The slot is not wedged: a later refresh succeeds and writes.
    listScansMock.mockResolvedValueOnce([scan('recovered', 'p', '2026-07-12T00:00:00Z')]);
    await useSceneStore.getState().invalidateScans('p');
    expect(useSceneStore.getState().scans.get('p')!.map((r) => r.id)).toEqual(['recovered']);
  });
});
