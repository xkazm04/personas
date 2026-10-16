/**
 * The live BlueprintActions (spark one-control, WP3): each action maps 1:1
 * onto `@/api/lensScan` with the product's id and the drawing's arguments,
 * the store's answer (a `skipped[]` included) passes through unchanged, every
 * write re-reads the products, a shot becomes an object URL with the MIME of
 * its extension, and the load error is typed from the door's kind.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScanSnapshot } from '@/lib/lensScan/wire';

const api = vi.hoisted(() => ({
  decideLensScan: vi.fn(),
  triageLensScan: vi.fn(),
  startLensScan: vi.fn(),
  getLensScanCommitDiff: vi.fn(),
  getLensScanShot: vi.fn(),
  getLensScanSnapshot: vi.fn(),
}));
vi.mock('@/api/lensScan', () => api);

import { createLiveActions, shotMime } from '../liveActions';
import { loadErrorKind } from '../loadError';
import { evidenceFeature } from '../useLiveBlueprint';

const product = { projectId: 'proj-teapot', name: 'Teapot Works', root: 'C:/sample/teapot-works' };

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
});

describe('createLiveActions', () => {
  it('decide passes ids, decision and note through, and the store answer back unchanged', async () => {
    const answer = { decision: 'approved', by: 'user:octo', decided: ['p1'], skipped: [{ id: 'p2', status: 'executing', reason: 'not proposed' }] };
    api.decideLensScan.mockResolvedValue(answer);
    const changed = vi.fn();
    const out = await createLiveActions(product, changed).decide(['p1', 'p2'], 'approve', 'looks right');
    expect(api.decideLensScan).toHaveBeenCalledWith('proj-teapot', ['p1', 'p2'], 'approve', 'looks right');
    expect(out).toBe(answer);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('triage passes reopen through and returns the refusal as the store said it', async () => {
    const answer = { decision: 'reopened', by: 'user:octo', triaged: [], skipped: [{ id: 'p3', status: 'accepted', reason: 'in-release' }] };
    api.triageLensScan.mockResolvedValue(answer);
    const changed = vi.fn();
    const out = await createLiveActions(product, changed).triage(['p3'], 'reopen');
    expect(api.triageLensScan).toHaveBeenCalledWith('proj-teapot', ['p3'], 'reopen', undefined);
    expect(out).toBe(answer);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('a refused write still re-reads the products, and rejects as the door rejected', async () => {
    const refusal = { error: 'store.mjs triage: refused', kind: 'internal' };
    api.triageLensScan.mockRejectedValue(refusal);
    const changed = vi.fn();
    await expect(createLiveActions(product, changed).triage(['p3'], 'rework', 'flaky')).rejects.toBe(refusal);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('start forwards the request verbatim', async () => {
    api.startLensScan.mockResolvedValue({ label: 'personas:1', command: 'node drive.mjs', pid: 42 });
    const req = { action: 'execute' as const, lens: 'development', ids: ['p1'] };
    const out = await createLiveActions(product, () => {}).start(req);
    expect(api.startLensScan).toHaveBeenCalledWith('proj-teapot', req);
    expect(out).toEqual({ label: 'personas:1', command: 'node drive.mjs', pid: 42 });
  });

  it('commitDiff and refresh are reads: no products re-read', async () => {
    api.getLensScanCommitDiff.mockResolvedValue({ sha: 'abc' });
    const scan = { runs: [] } as unknown as ScanSnapshot; // shape irrelevant: passed through untouched
    api.getLensScanSnapshot.mockResolvedValue({ structure: { v: 3 }, events: '', scan, storeVersion: 2 });
    const changed = vi.fn();
    const live = createLiveActions(product, changed);
    expect(await live.commitDiff('abc')).toEqual({ sha: 'abc' });
    expect(api.getLensScanCommitDiff).toHaveBeenCalledWith('proj-teapot', 'abc');
    const data = await live.refresh();
    expect(api.getLensScanSnapshot).toHaveBeenCalledWith('proj-teapot');
    expect(data).toEqual({ product, structure: { v: 3 }, events: '', scan, storeVersion: 2 });
    expect(changed).not.toHaveBeenCalled();
  });

  it('shotUrl builds an object URL over the bytes, with the MIME of the extension', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    api.getLensScanShot.mockResolvedValue(bytes);
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:shot');
    const url = await createLiveActions(product, () => {}).shotUrl('shots/r1/brew-timer-dark-1280.webp');
    expect(api.getLensScanShot).toHaveBeenCalledWith('proj-teapot', 'shots/r1/brew-timer-dark-1280.webp');
    expect(url).toBe('blob:shot');
    const blob = create.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('image/webp');
    expect(blob.size).toBe(3);
    create.mockRestore();
    expect(shotMime('a.PNG')).toBe('image/png');
    expect(shotMime('a.jpeg')).toBe('image/jpeg');
    expect(shotMime('run.webm')).toBe('video/webm');
  });
});

describe('the live blueprint load', () => {
  it('types the error from the door kind', () => {
    expect(loadErrorKind({ error: 'node was not found on PATH', kind: 'process_spawn' })).toBe('node');
    expect(loadErrorKind({ error: 'lens-scan not found: set registry.local', kind: 'not_found' })).toBe('registry');
    expect(loadErrorKind({ error: 'no store at C:/x', kind: 'not_found' })).toBe('store');
    expect(loadErrorKind({ error: 'database is locked', kind: 'database' })).toBe('store');
    expect(loadErrorKind(new Error('timeout'))).toBe('store');
  });

  it('an Evidence card opens at the first item waiting for triage in the first open pack', () => {
    const T = '2026-10-15T10:00:00.000Z';
    const pack = (id: string, status: 'open' | 'triaged') => ({ id, lens: 'design', n: 1, branch: `pack/${id}`, base_ref: 'main', base_sha: 'abc', status, created_at: T, updated_at: T });
    const item = (id: string, pack_id: string, feature: string, status: 'done' | 'failed' | 'accepted', at: string) => ({
      id, run_id: 'r', feature, lens: 'design', title: id, standard: 'none', kind: 'fix' as const, status, created_at: at, updated_at: at, pack_id,
    });
    const scan = {
      packs: [pack('k-1', 'triaged'), pack('k-2', 'open')],
      proposals: [
        item('a', 'k-1', 'tea-menu', 'done', T),
        item('b', 'k-2', 'checkout', 'accepted', '2026-10-15T09:00:00.000Z'),
        item('c', 'k-2', 'brew-timer', 'failed', '2026-10-15T09:30:00.000Z'),
        item('d', 'k-2', 'receipts', 'done', '2026-10-15T09:45:00.000Z'),
      ],
    };
    expect(evidenceFeature(scan)).toBe('brew-timer');
    expect(evidenceFeature({ packs: [], proposals: [] })).toBeUndefined();
  });
});
