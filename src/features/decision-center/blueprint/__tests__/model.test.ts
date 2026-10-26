// @vitest-environment node
/**
 * The model over the Kettle fixture (WP4a): bp's loadStructure reads the map without a warning, the seven built-in
 * lenses and the custom one come out in the registry (Performance with its stopwatch, the custom lens with its own
 * path), every feature has a tile, wings run A, B, C in the order work began, and the work joins the plan by feature.
 */
import { describe, expect, it } from 'vitest';
import { kettleData } from '../fixture/kettle';
import { buildPlan } from '../model/plan';
import { buildWork, isQueued } from '../model/work';
import { findHits } from '../model/find';
import { scopeOf, queueIn } from '../model/scope';

const data = kettleData();
const plan = buildPlan(data.structure, data.events);
const work = buildWork(plan.L, data.scan);

describe('loadStructure over the fixture', () => {
  it('reads the map without repairing anything', () => {
    expect(plan.S.warnings).toEqual([]);
    expect(plan.S.version).toBe(3);
    expect(plan.S.features).toHaveLength(30);
    expect(plan.S.events.length).toBeGreaterThan(100);
  });

  it('registers the seven built-in lenses (Performance among them) and a custom project lens, in the map order', () => {
    expect(plan.lenses.map((l) => l.id)).toEqual(['business', 'design', 'development', 'operations', 'security', 'quality', 'performance', 'com.kettle.cost']);
    expect(plan.lenses.filter((l) => l.source === 'builtin')).toHaveLength(7);
    const perf = plan.LENS.performance!, cost = plan.LENS['com.kettle.cost']!;
    expect(perf.glyph).toBe('stopwatch');
    expect(perf.short).toBe('PERF');
    expect(cost.source).toBe('project');
    expect(typeof cost.glyph === 'object' && cost.glyph !== null && 'path' in cost.glyph).toBe(true);
    expect(plan.lenses.map((l) => l.i)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('measures the features: most read a health under at least one lens', () => {
    const measured = plan.S.features.filter((f) => Object.values(f.lens).some((l) => l.h !== 'unmeasured' && l.h !== 'na'));
    expect(measured.length).toBeGreaterThan(20);
    expect(plan.S.features.some((f) => f.trouble.length > 0)).toBe(true);
  });
});

describe('layout', () => {
  it('places every feature on exactly one tile', () => {
    expect(plan.L.tiles).toHaveLength(plan.S.features.length);
    expect(new Set(plan.L.tiles.map((t) => t.id)).size).toBe(plan.L.tiles.length);
    for (const f of plan.S.features) expect(plan.L.TILE[f.id]?.f).toBe(f);
  });

  it('letters the wings A, B, C... in the order their work began, one wing per domain', () => {
    expect(plan.L.wings.map((w) => w.def.letter)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    const medians = plan.L.wings.map((w) => w.def.median);
    expect([...medians].sort((a, b) => a - b)).toEqual(medians);
    expect(plan.L.wings.length).toBe(new Set(plan.S.features.map((f) => f.domain)).size);
  });

  it('keeps every tile inside its bay, bay inside room, room inside wing, wing inside the world', () => {
    const inside = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
      a.x >= b.x - 1e-6 && a.y >= b.y - 1e-6 && a.x + a.w <= b.x + b.w + 1e-6 && a.y + a.h <= b.y + b.h + 1e-6;
    for (const t of plan.L.tiles) { expect(inside(t, t.bay)).toBe(true); expect(inside(t.bay, t.room)).toBe(true); expect(inside(t.room, t.wing)).toBe(true); expect(inside(t.wing, plan.L.world)).toBe(true); }
  });
});

describe('work', () => {
  it('joins every proposal to a feature on the plan, with the store status verbatim', () => {
    expect(work.items).toHaveLength(data.scan.proposals.length);
    for (const p of work.items) { expect(plan.L.TILE[p.fid]).toBeDefined(); expect(p.status).toBe(p.row.status); }
  });

  it('the queue holds proposed and approved, in plan order (left to right)', () => {
    const scope = scopeOf(plan.L, 0, {}, null);
    const q = queueIn(work, plan.L, scope, 'general');
    expect(q.length).toBeGreaterThan(5);
    expect(q.every(isQueued)).toBe(true);
    const ti = q.map((p) => plan.L.TILE[p.fid]!.ti);
    expect([...ti].sort((a, b) => a - b)).toEqual(ti);
  });

  it('a lens sheet shows only its own work; a wing shows only its features', () => {
    const site = scopeOf(plan.L, 0, {}, null);
    const des = queueIn(work, plan.L, site, 'design');
    expect(des.length).toBeGreaterThan(0);
    expect(des.every((p) => p.lens === 'design')).toBe(true);
    const wing = plan.L.wings[0]!;
    const inWing = queueIn(work, plan.L, scopeOf(plan.L, 1, { wing: wing.id }, null), 'general');
    expect(inWing.every((p) => wing.feats.some((f) => f.id === p.fid))).toBe(true);
  });

  it('a pack item carries its before and after readings, before first', () => {
    const packed = work.items.filter((p) => p.pack && p.status === 'done');
    expect(packed.length).toBeGreaterThan(0);
    const ev = work.evidence(packed[0]!.id);
    expect(ev.length).toBeGreaterThanOrEqual(2);
    expect(ev[0]!.phase).toBe('before');
    expect(ev[ev.length - 1]!.phase).toBe('after');
    expect(work.packFlow).toBe(true);
  });

  it('records the last run and counts none running in a settled store', () => {
    expect(work.lastRun).toBeTruthy();
    expect(work.activeRuns).toBe(0);
  });
});

describe('find', () => {
  it('lists every wing for an empty query, with its letter', () => {
    const hits = findHits(plan, work, '');
    expect(hits.map((h) => h.kind)).toEqual(Array(plan.L.wings.length).fill('wing'));
  });

  it('finds features, bays and queued work by a word', () => {
    const hits = findHits(plan, work, 'book');
    expect(hits.some((h) => h.kind === 'feature')).toBe(true);
    expect(findHits(plan, work, 'zzzzzzzz')).toEqual([]);
  });
});
