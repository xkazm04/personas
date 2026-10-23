/**
 * The fixture source answers in the store's own shapes (WP4a): `decide` as DecideResult (decided[] and skipped[] with
 * the status a skipped row had), `triage` as TriageResult (with `note-required` and `in-release` reasons), `start` as
 * StartResult (a `personas:` label, the exact command, a pid), and `refresh` re-reads what the writes changed.
 */
import { describe, expect, it } from 'vitest';
import type { DecideResult, StartResult } from '../source';
import type { TriageResult } from '@/lib/lensScan/wire';
import { createFixtureActions } from '../fixture/actions';
import { kettleData } from '../fixture/kettle';
import { STATUS } from '../model/states';

const fresh = () => { const data = kettleData(); return { data, actions: createFixtureActions(data) }; };
const ids = (data: ReturnType<typeof kettleData>, status: string) => data.scan.proposals.filter((p) => p.status === status).map((p) => p.id);

function expectDecideShape(r: DecideResult) {
  expect(['approved', 'declined']).toContain(r.decision);
  expect(typeof r.by).toBe('string');
  expect(Array.isArray(r.decided)).toBe(true);
  for (const s of r.skipped) { expect(typeof s.id).toBe('string'); expect(typeof s.status).toBe('string'); }
}
function expectTriageShape(r: TriageResult) {
  expect(['accepted', 'rework', 'descoped', 'reopened']).toContain(r.decision);
  expect(typeof r.by).toBe('string');
  expect(Array.isArray(r.triaged)).toBe(true);
  expect(Array.isArray(r.packs_triaged)).toBe(true);
}

describe('decide', () => {
  it('approves a proposed item: DecideResult, then the re-read shows approved with who decided', async () => {
    const { data, actions } = fresh();
    const [id] = ids(data, 'proposed');
    const r = await actions.decide([id!], 'approve');
    expectDecideShape(r);
    expect(r).toMatchObject({ decision: 'approved', decided: [id], skipped: [] });
    const next = await actions.refresh();
    const row = next.scan.proposals.find((p) => p.id === id)!;
    expect(row.status).toBe('approved');
    expect(row.decided_by).toBe(r.by);
  });

  it('declines with the note kept as the decision note', async () => {
    const { data, actions } = fresh();
    const [id] = ids(data, 'proposed');
    const r = await actions.decide([id!], 'decline', 'Superseded by the redesign');
    expect(r.decision).toBe('declined');
    const row = (await actions.refresh()).scan.proposals.find((p) => p.id === id)!;
    expect(row).toMatchObject({ status: 'declined', decision_note: 'Superseded by the redesign' });
  });

  it('leaves what is not proposed as it was and says its status; a missing id is not-found', async () => {
    const { data, actions } = fresh();
    const [approved] = ids(data, 'approved');
    const r = await actions.decide([approved!, 'p-missing'], 'approve');
    expectDecideShape(r);
    expect(r.decided).toEqual([]);
    expect(r.skipped).toEqual([{ id: approved, status: 'approved' }, { id: 'p-missing', status: 'not-found' }]);
  });
});

describe('triage', () => {
  it('accepts a built item and answers a TriageResult', async () => {
    const { data, actions } = fresh();
    const [id] = ids(data, 'done');
    const r = await actions.triage([id!], 'accept');
    expectTriageShape(r);
    expect(r).toMatchObject({ decision: 'accepted', triaged: [id], skipped: [] });
    expect((await actions.refresh()).scan.proposals.find((p) => p.id === id)!.status).toBe('accepted');
  });

  it('refuses accepting a failed build without a note: note-required', async () => {
    const { data, actions } = fresh();
    const [id] = ids(data, 'failed');
    const r = await actions.triage([id!], 'accept');
    expect(r.triaged).toEqual([]);
    expect(r.skipped).toEqual([{ id, status: 'failed', reason: 'note-required' }]);
    expect((await actions.triage([id!], 'accept', 'ship it anyway')).triaged).toEqual([id]);
  });

  it('reopen puts the item back where it was', async () => {
    const { data, actions } = fresh();
    const [id] = ids(data, 'done');
    await actions.triage([id!], 'descope', 'later');
    const r = await actions.triage([id!], 'reopen');
    expect(r).toMatchObject({ decision: 'reopened', triaged: [id] });
    expect((await actions.refresh()).scan.proposals.find((p) => p.id === id)!.status).toBe('done');
  });

  it('every move is a status the table knows', async () => {
    const { data, actions } = fresh();
    const [id] = ids(data, 'done');
    await actions.triage([id!], 'rework', 'again');
    const row = (await actions.refresh()).scan.proposals.find((p) => p.id === id)!;
    expect(STATUS[row.status]).toBeDefined();
  });
});

describe('start', () => {
  it('starts an execute job for the approved items of a lens: label, exact command, pid; the items go executing', async () => {
    const { data, actions } = fresh();
    const approved = data.scan.proposals.filter((p) => p.status === 'approved');
    const lens = approved[0]!.lens;
    const mine = approved.filter((p) => p.lens === lens).map((p) => p.id);
    const r: StartResult = await actions.start({ action: 'execute', lens, ids: mine });
    expect(r.label).toMatch(/^personas:/);
    expect(r.command).toContain('drive.mjs execute');
    expect(r.command).toContain(`--lens ${lens}`);
    expect(r.command).toContain(`--ids ${mine.join(',')}`);
    expect(r.command).not.toContain('--approve-proposed');
    expect(typeof r.pid).toBe('number');
    const next = await actions.refresh();
    for (const id of mine) expect(next.scan.proposals.find((p) => p.id === id)!.status).toBe('executing');
  });

  it('does not touch a proposed item even when named', async () => {
    const { data, actions } = fresh();
    const [proposed] = data.scan.proposals.filter((p) => p.status === 'proposed');
    await actions.start({ action: 'execute', lens: proposed!.lens, ids: [proposed!.id] });
    expect((await actions.refresh()).scan.proposals.find((p) => p.id === proposed!.id)!.status).toBe('proposed');
  });

  it('settleBuilds finishes a started build: executing items become done', async () => {
    const { data, actions } = fresh();
    const a = data.scan.proposals.find((p) => p.status === 'approved')!;
    await actions.start({ action: 'execute', lens: a.lens, ids: [a.id] });
    actions.settleBuilds('done');
    expect((await actions.refresh()).scan.proposals.find((p) => p.id === a.id)!.status).toBe('done');
  });
});

describe('side reads', () => {
  it('answers a commit diff and a shot url', async () => {
    const { actions } = fresh();
    const d = await actions.commitDiff('abc1234');
    expect(d).toMatchObject({ sha: 'abc1234', truncated: false });
    expect(d.files.length).toBeGreaterThan(0);
    expect(await actions.shotUrl('sample-shots/x.svg')).toMatch(/^data:image\/svg\+xml/);
  });

  it('two fixture sessions never share rows', async () => {
    const a = fresh(), b = fresh();
    const [id] = ids(a.data, 'proposed');
    await a.actions.decide([id!], 'approve');
    expect((await b.actions.refresh()).scan.proposals.find((p) => p.id === id)!.status).toBe('proposed');
  });
});
