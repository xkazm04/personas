// The ledger's pure derivations (bp useLedger, releaseState, pixels, ItemRow facts) over the Kettle fixture.
import { describe, expect, it } from 'vitest';
import { kettleData } from '../fixture/kettle';
import { buildPlan } from '../model/plan';
import { buildFindings, chipsOf, keeper, lensCols, ledgerOrder, matrixRows, NO_FILTER, packViews, rankValue, statusCounts, stepIn, targetsOf, triageRows, underFocus } from '../model/ledger';
import { itemFacts } from '../model/ledgerFacts';
import { ledgerAct, LEDGER_OWN } from '../model/ledgerKeys';
import { bboxCells, diffPixels, GRID_W, pixFacts } from '../model/ledgerPixels';
import { canDecide, riskBand } from '../model/ledgerRules';
import { notesPreview, openRelease, releaseModel, stepOf, suggestNext, summaryCounts } from '../model/ledgerRelease';
import { actOf } from '../model/keymap';
import type { Proposal, Release } from '@/lib/lensScan/wire';

const data = kettleData();
const plan = buildPlan(data.structure, data.events);
const all = buildFindings(data.scan, plan);
const keepAll = keeper(NO_FILTER, plan);

describe('findings', () => {
  it('every proposal is a finding, named from the map, with the store status as it is', () => {
    expect(all).toHaveLength(data.scan.proposals.length);
    const f = all.find((x) => x.p.id === 'p-1aab7a')!;
    expect(f.fname).not.toBe('book-a-class');
    expect(f.onPlan).toBe(true);
    expect(f.status).toBe('done');
    expect(statusCounts(all).proposed).toBe(8);
  });

  it('the backlog orders open first, then by value per effort', () => {
    const rows = triageRows(all, keepAll);
    expect(rows[0]!.status).toBe('proposed');
    const proposed = rows.filter((r) => r.status === 'proposed');
    for (let i = 1; i < proposed.length; i++) expect(proposed[i - 1]!.ev).toBeGreaterThanOrEqual(proposed[i]!.ev);
    const ev = rankValue([{ id: 'a', lens: 'l', metric: 'm', expected_delta: -4, risk: 2, size: 'XS' } as Proposal, { id: 'b', lens: 'l', metric: 'm', expected_delta: -1, risk: 9, size: 'XL' } as Proposal]);
    expect(ev.get('a')!).toBeGreaterThan(ev.get('b')!);
  });

  it('packs come oldest first, each pack as built, and a filter keeps its rows', () => {
    const { packs, items } = packViews(all, data.scan.packs, keepAll);
    expect(packs.map((k) => k.pack.id)).toEqual(['k-dev-1', 'k-des-1', 'k-des-2', 'k-perf-1']);
    expect(packs[1]!.items.map((f) => f.p.id)).toEqual(['p-1aab7a', 'p-54887a', 'p-170a0d', 'p-f9cf56', 'p-0668ae']);
    expect(items).toHaveLength(10);
    const onlyFailed = packViews(all, data.scan.packs, keeper({ ...NO_FILTER, status: new Set(['failed']) }, plan));
    expect(onlyFailed.packs.flatMap((k) => k.shown.map((f) => f.p.id))).toEqual(['p-f9cf56']);
    const text = packViews(all, data.scan.packs, keeper({ ...NO_FILTER, q: 'k-perf' }, plan));
    expect(text.packs.flatMap((k) => k.shown).length).toBe(2);
  });

  it('the chips are the scope\'s: pack statuses in packs, v1 statuses (and any v2 present) in the backlog', () => {
    const { items } = packViews(all, data.scan.packs, keepAll);
    expect(chipsOf('packs', statusCounts(all), items).map((c) => c.status)).toEqual(['done', 'failed', 'accepted', 'rework', 'descoped', 'released']);
    expect(chipsOf('packs', statusCounts(all), items).find((c) => c.status === 'done')!.n).toBe(6);
    expect(chipsOf('backlog', statusCounts(all), items).map((c) => c.status)).toContain('accepted');
    expect(chipsOf('backlog', statusCounts(all), items).map((c) => c.status)).not.toContain('released');
  });

  it('the matrix has a row per feature in map order; its keyboard order names rows `feat:`', () => {
    const rows = matrixRows(all);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(rows.length);
    expect(ledgerOrder('matrix', all)[0]).toBe('feat:' + rows[0]!.slug);
    expect(underFocus('feat:invoice-ocr', all).sort()).toEqual(all.filter((f) => f.p.feature === 'invoice-ocr').map((f) => f.p.id).sort());
    expect(lensCols(all, plan).some((l) => l.id === 'design' && l.n > 0)).toBe(true);
  });

  it('a decision acts on the checked items, else the open one, else the focused one', () => {
    const ids = new Set(['a', 'b', 'c']);
    expect(targetsOf(['b', 'x'], 'c', 'a', ids)).toEqual(['b']);
    expect(targetsOf([], 'c', 'a', ids)).toEqual(['c']);
    expect(targetsOf([], null, 'a', ids)).toEqual(['a']);
    expect(targetsOf([], null, 'x', ids)).toEqual([]);
    expect(stepIn(['a', 'b'], null, 1)).toBe('a');
    expect(stepIn(['a', 'b'], null, -1)).toBe('b');
    expect(stepIn(['a', 'b'], 'b', 1)).toBe('b');
  });
});

describe('rules, facts and the release', () => {
  it('canDecide follows the store\'s TRIAGE table and keeps a release past draft locked', () => {
    expect(canDecide('accept', { status: 'failed' })).toBe(true);
    expect(canDecide('reopen', { status: 'done' })).toBe(false);
    expect(canDecide('descope', { status: 'accepted', release_id: 'rel-1' }, { status: 'building' })).toBe(false);
    expect(canDecide('descope', { status: 'accepted', release_id: 'rel-1' }, { status: 'draft' })).toBe(true);
    expect(riskBand(undefined)).toBe('medium');
    expect(riskBand(8)).toBe('high');
  });

  it('item facts carry the verdict, the attempt chain and a failed build', () => {
    const f = itemFacts(data.scan, plan.lenses);
    expect(f.get('p-1aab7a')!.verdict).toBe('moved');
    expect(f.get('p-f9cf56')!.failed).toBe(true);
    expect(f.get('p-1b2ccd')!.attempt).toBe(2);
    expect(f.get('p-1b2ccd')!.prevNote).toBeTruthy();
    expect(f.get('p-3cda72')!.runs).toBeGreaterThan(1);
  });

  it('the release model reads the open release, its items and the next version', () => {
    const m = releaseModel(data.scan, plan.lenses);
    expect(m.rel?.id).toBe('rel-0.4.0');
    expect(m.items.map((x) => x.p.id)).toEqual(['p-7e21a0']);
    expect(m.free).toBe(1);
    expect(stepOf('pr-open')).toBe(2);
    expect(stepOf('failed')).toBe(-1);
    expect(openRelease([{ status: 'tagged' } as Release])).toBeUndefined();
    const tagged = [{ id: 'rel-1.2.0', version: '1.2.0', status: 'tagged', tag: 'v1.2.0' }, { id: 'rel-1.10.0', version: '1.10.0', status: 'tagged', tag: 'v1.10.0' }] as Release[];
    expect(suggestNext(tagged, [{ kind: 'fix' } as Proposal]).version).toBe('1.10.1');
    expect(suggestNext([], []).version).toBe('0.1.0');
    expect(notesPreview('Kettle', '0.4.1', m.items, [])).toContain('## Kettle 0.4.1 (preview)');
    const c = summaryCounts(data.scan, plan.lenses);
    expect(c.waiting).toBe(7);
    expect(c.failed).toBe(1);
  });
});

describe('the change map and the keys', () => {
  it('diffPixels finds the moved block and its box; identical buffers read identical', () => {
    const w = 64, h = 36, a = new Uint8ClampedArray(w * h * 4), b = new Uint8ClampedArray(a);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) b[((y + 10) * w + x + 20) * 4] = 255;
    const g = diffPixels(a, b, w, h);
    expect(g.bbox).toEqual([20, 10, 23, 13]);
    expect(g.cells.filter(Boolean).length).toBeGreaterThan(0);
    expect(bboxCells(g)!.x).toBe(20 * (GRID_W / w));
    expect(pixFacts(g).same).toBe(false);
    expect(pixFacts(diffPixels(a, a, w, h)).kind).toBe('identical');
  });

  it('the ledger reads the one keymap: Y accepts, A approves, digits 1-3 are its tabs, the plan keys are swallowed', () => {
    expect(ledgerAct('y')).toBe('accept');
    expect(ledgerAct('A')).toBe('approve');
    expect(ledgerAct('2')).toBe('tab2');
    expect(ledgerAct('5')).toBe('swallow');
    expect(ledgerAct('ArrowRight')).toBe('swallow');
    expect(ledgerAct('l')).toBe('pass');
    expect(ledgerAct(' ')).toBe('select');
    expect(ledgerAct('Escape')).toBe('back');
  });

  it('the ledger\'s own keys (W, M) are bound nowhere in the sheet\'s keymap: no key is bound twice', () => {
    for (const k of Object.keys(LEDGER_OWN)) expect(actOf(k)).toBeUndefined();
  });
});
