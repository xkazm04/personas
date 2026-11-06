import { describe, expect, it } from 'vitest';

import { buildFixture } from '../../fixture/standupFixture';
import { buildView } from '../buildView';
import { applyPatch, pickPatch, typedPatch } from '../patch';

const view = (s: Parameters<typeof buildFixture>[0]) => buildView(buildFixture(s));

describe('buildView: the three lives', () => {
  it('decide: groups in B/1 order, every edge present, counts derived from row states', () => {
    const v = view('decide');
    expect(v.life).toBe('decide');
    expect(v.groups.map((g) => g.id)).toEqual(['decide', 'agents', 'waits', 'blank', 'filler', 'refused']);
    expect(v.counts).toEqual({ waits: 5, proposed: 8, decided: 2, running: 0, refused: 1 });
    // no proposal -> the operator types it
    expect(v.rows.find((r) => r.key === 'i-b1')).toMatchObject({ group: 'blank', state: 'blank' });
    // refused (a headless master holds it) carries its reason
    expect(v.rows.find((r) => r.key === 'i-r1')).toMatchObject({ group: 'refused', state: 'refused' });
    expect(v.rows.find((r) => r.key === 'i-r1')?.refusal).toMatch(/headless/);
    // agent changes are decided like directions, labelled by their verb
    expect(v.rows.find((r) => r.key === 'i-a1')).toMatchObject({ kind: 'agent', agentVerb: 'create', state: 'proposed' });
    // the since-last strip comes from the report
    expect(v.sinceLast).toMatchObject({ moved: 10, projects: 2, parked: 5 });
  });

  it('decide: a proposed row only ever draws dashed (proposed) blocks; a decided one solid', () => {
    const v = view('decide');
    const kp = v.rows.find((r) => r.key === 'i-kp')!;
    expect(kp.state).toBe('decided');
    expect(new Set(kp.blocks.map((b) => b.tone))).toEqual(new Set(['decided']));
  });

  it('armed: rows behind the clock are done, rows across it run, and none stay proposed', () => {
    const v = view('armed');
    expect(v.life).toBe('armed');
    const states = new Set(v.rows.filter((r) => r.kind === 'direction').map((r) => r.state));
    expect(states.has('running')).toBe(true);
    expect(states.has('done')).toBe(true);
    expect(v.counts.running).toBeGreaterThan(0);
    const tones = new Set(v.rows.flatMap((r) => r.blocks.map((b) => b.tone)));
    expect(tones.has('proposed')).toBe(false);
    expect(v.machine.laneBlocks.some((b) => b.tone === 'running')).toBe(true);
    // the night window starts where the plan was armed, so the clock walks right of it
    expect(v.night.from).toBe(v.past.to);
    expect(v.nowMs).toBeGreaterThan(v.night.from);
  });

  it('return: the report is the since-last strip and the night acts land on the night axis', () => {
    const v = view('return');
    expect(v.life).toBe('return');
    expect(v.sinceLast).toMatchObject({ moved: 6, created: ['App Master CastleControl'] });
    const cc = v.rows.find((r) => r.key === 'i-cc')!;
    expect(cc.nightMarks.length).toBeGreaterThan(0);
    expect(cc.nightMarks.every((m) => m.pos >= 0 && m.pos <= 1)).toBe(true);
  });

  it('no standup: an honest empty view', () => {
    const v = buildView({ ...buildFixture('decide'), standup: null });
    expect(v.life).toBe('none');
    expect(v.rows).toEqual([]);
    expect(v.sinceLast).toBeNull();
  });
});

describe('patches', () => {
  it('pick sends the proposal text as accepted; typed text as edited; apply keeps absent fields', () => {
    const fx = buildFixture('decide');
    const row = buildView(fx).rows.find((r) => r.key === 'i-cc')!;
    const pick = pickPatch(row, 1)!;
    expect(pick).toEqual({ id: 'i-cc', state: 'accepted', chosen: row.proposals[1]!.text });
    expect(typedPatch(row, '   ')).toBeNull();
    const next = applyPatch(fx.standup!, pick);
    const item = next.plan.items.find((i) => i.id === 'i-cc')!;
    expect(item).toMatchObject({ state: 'accepted', chosen: row.proposals[1]!.text, window: 'night', priority: 1 });
    const after = buildView({ ...fx, standup: next }).rows.find((r) => r.key === 'i-cc')!;
    expect(after).toMatchObject({ state: 'decided', chosenIndex: 1 });
  });
});
