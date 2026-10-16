import { describe, it, expect, beforeEach, expectTypeOf } from 'vitest';
import { mockedTauriInvoke, resetInvokeMocks, mockInvokeMap } from '@/test/tauriMock';
import {
  decideLensScan,
  getLensScanCommitDiff,
  getLensScanIdentity,
  getLensScanShot,
  getLensScanSnapshot,
  listLensScanProducts,
  startLensScan,
  triageLensScan,
  type DecideResult,
  type LensScanSnapshotData,
} from '@/api/lensScan';
import type {
  BlueprintData,
  DecideResult as SeamDecideResult,
  StartResult,
} from '@/features/decision-center/blueprint/source';

describe('api/lensScan', () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it('keeps the frozen blueprint seam and the door types in step', () => {
    expectTypeOf<LensScanSnapshotData>().toEqualTypeOf<Omit<BlueprintData, 'product'>>();
    expectTypeOf<DecideResult>().toEqualTypeOf<SeamDecideResult>();
  });

  it('lists products and sends camelCase args', async () => {
    mockInvokeMap({ lens_scan_products: [{ projectId: 'p', name: 'N', root: '/r' }] });
    expect(await listLensScanProducts()).toEqual([{ projectId: 'p', name: 'N', root: '/r' }]);
    expect(mockedTauriInvoke.mock.calls.at(-1)?.[0]).toBe('lens_scan_products');
  });

  it('narrows the snapshot rows to the wire without reshaping them', async () => {
    const rows = {
      runs: [{ id: 'r1', lenses: ['dev'] }],
      measurements: [],
      proposals: [{ id: 'p1', status: 'proposed' }],
      activity: [],
      shots: [],
      coverage: [],
      packs: [],
      releases: [],
    };
    mockInvokeMap({
      lens_scan_snapshot: { structure: null, events: '', scan: rows, storeVersion: 1 },
    });
    const snap = await getLensScanSnapshot('p');
    expect(snap.scan.proposals[0]?.status).toBe('proposed');
    expect(snap.scan.packs).toEqual([]);
    expect(snap.storeVersion).toBe(1);
    expect(mockedTauriInvoke.mock.calls.at(-1)?.[1]).toEqual({ projectId: 'p' });
  });

  it('passes the store answer through verbatim, skipped reasons included', async () => {
    const answer = {
      decision: 'reopened',
      by: 'user:me',
      triaged: [],
      skipped: [{ id: 'a', status: 'accepted', reason: 'no-prior-status' }],
      packs_triaged: [],
    };
    mockInvokeMap({ lens_scan_triage: answer });
    const out = await triageLensScan('p', ['a'], 'reopen');
    expect(out).toEqual(answer);
    expect(mockedTauriInvoke.mock.calls.at(-1)?.[1]).toMatchObject({
      projectId: 'p',
      ids: ['a'],
      decision: 'reopen',
    });
    mockInvokeMap({ lens_scan_decide: { decision: 'approved', by: 'u', decided: ['a'], skipped: [] } });
    expect((await decideLensScan('p', ['a'], 'approve', 'ok')).decided).toEqual(['a']);
  });

  it('starts a run, reads identity, a commit diff and shot bytes', async () => {
    const started: StartResult = { label: 'personas:x', command: 'node drive.mjs', pid: 7 };
    mockInvokeMap({
      lens_scan_start: started,
      lens_scan_identity: { by: 'user:personas', source: 'fallback' },
      lens_scan_commit_diff: { sha: 'abc', message: '', stat: '', files: [], patch: '', lines: 0, truncated: false },
      lens_scan_shot: new ArrayBuffer(3),
    });
    expect(await startLensScan('p', { action: 'measure', lens: 'dev' })).toEqual(started);
    expect((await getLensScanIdentity()).source).toBe('fallback');
    expect((await getLensScanCommitDiff('p', 'abcdef1')).truncated).toBe(false);
    expect((await getLensScanShot('p', 'shots/r/a.png')).byteLength).toBe(3);
  });
});
