// @vitest-environment node
/**
 * The trouble index (engine/trouble.ts) and the trouble route (engine/trouble-route.ts) over the Kettle fixture, held by
 * bp's own cases with the Engine taken out: bp scripts/check-trouble-index.ts @ 93f30b0 (a feature that turns bad IN
 * PLACE moves the per-lens count by exactly one once the health version moves, and withdrawing it puts the count back;
 * nothing moves while the version stands) and the route half of bp scripts/check-place-words.ts part 3 (N visits every
 * troubled feature once in walk order, Shift+N steps back, past the end leaves the route, a member that turns bad
 * mid-route is counted new and not spliced in, a lens view routes only its own trouble, the arrival says position,
 * room › feature and Lens health: reason).
 */
import { describe, expect, it } from 'vitest';
import { kettleData } from '../fixture/kettle';
import { buildPlan } from '../model/plan';
import { TroubleIndex } from '../engine/trouble';
import { captureRoute, newMembers, routeRank, routeSentence, routeWords, stepRoute } from '../engine/trouble-route';
import type { Health } from '../standard/types';

const plan = buildPlan(kettleData().structure, kettleData().events);
const { S, L } = plan;

describe('TroubleIndex (bp check-trouble-index)', () => {
  it('a feature that turns bad in place moves the count by one when healthV moves, and back', () => {
    const sim = { healthV: 0 };
    const ix = new TroubleIndex(S.features, sim);
    const X = S.features.find((f) => !f.trouble.length)!;
    const lens = plan.lenses[0]!.id;
    const c0 = ix.counts()[lens]?.bad ?? 0, n0 = ix.all().length, before = ix.counts();
    expect(ix.version).toBe(0);
    expect(ix.all().every((f) => f.trouble.length > 0)).toBe(true);
    X.trouble = [{ lens, h: 'bad', why: 'seeded by the test', short: null }];
    expect(ix.counts()[lens]?.bad ?? 0).toBe(c0);
    expect(ix.counts()).toBe(before);
    sim.healthV++;
    expect(ix.counts()[lens]!.bad).toBe(c0 + 1);
    expect(ix.all()).toHaveLength(n0 + 1);
    expect(ix.of(lens)).toContain(X);
    expect(ix.version).toBe(1);
    X.trouble = [];
    sim.healthV++;
    expect(ix.counts()[lens]?.bad ?? 0).toBe(c0);
    expect(ix.of(lens)).not.toContain(X);
  });
  it('a lens with no trouble is absent from the counts and routes nothing', () => {
    const ix = new TroubleIndex(S.features, { healthV: 0 });
    expect(ix.of('no-such-lens')).toHaveLength(0);
    expect(ix.counts()['no-such-lens']).toBeUndefined();
  });
});

describe('the trouble route (bp check-place-words part 3, route half)', () => {
  const ix = new TroubleIndex(S.features, { healthV: 0 });
  const rank = routeRank(L);
  const want = S.features.filter((f) => f.trouble.length && rank.has(f.id)).map((f) => f.id).sort((a, b) => rank.get(a)! - rank.get(b)!);

  it('the fixture has features in trouble to route', () => { expect(want.length).toBeGreaterThan(3); });
  it('rank walks rooms, then bays, then tiles, every tile once', () => {
    expect(rank.size).toBe(L.tiles.length);
    const order = L.rooms.flatMap((R) => R.bays.flatMap((B) => B.tiles.map((T) => T.id)));
    expect([...rank.keys()]).toEqual(order);
  });
  it('N visits every troubled feature exactly once, in walk order; Shift+N steps back; past the end leaves the route', () => {
    const r = captureRoute('general', ix.all(), rank);
    const seen: string[] = [];
    for (let k = 0; k < want.length; k++) { const j = stepRoute(r, 1)!; r.i = j; seen.push(r.ids[j]!); }
    expect(seen).toEqual(want);
    expect(stepRoute(r, 1)).toBeNull();
    r.i = stepRoute(r, -1)!;
    expect(r.ids[r.i]).toBe(want[want.length - 2]);
    const fresh = captureRoute('general', ix.all(), rank);
    expect(stepRoute(fresh, -1)).toBe(want.length - 1);
  });
  it('a member that turns bad mid-route is counted new, the frozen route unchanged, and joins on recapture', () => {
    const sim = { healthV: 0 }, live = new TroubleIndex(S.features, sim);
    const r = captureRoute('general', live.all(), rank), ids = r.ids.join();
    const g = S.features.find((f) => !f.trouble.length && rank.has(f.id))!;
    g.trouble = [{ lens: plan.lenses[0]!.id, h: 'bad', why: 'seeded by the test', short: null }]; sim.healthV++;
    try {
      expect(newMembers(r, live.all())).toBe(1);
      expect(r.ids.join()).toBe(ids);
      expect(captureRoute('general', live.all(), rank).ids).toContain(g.id);
    } finally { g.trouble = []; }
  });
  it("a lens view routes only that lens's trouble", () => {
    const lens = plan.lenses.find((d) => ix.of(d.id).length)!;
    const r = captureRoute(lens.id, ix.of(lens.id), rank);
    expect(r.ids.length).toBe(S.features.filter((f) => f.trouble.some((t) => t.lens === lens.id) && rank.has(f.id)).length);
  });
  it('an arrival says its position, room › feature and Lens health: reason (bp routeWords)', () => {
    const f0 = S.features.find((f) => f.id === want[0])!, t0 = f0.trouble[0]!;
    const a = routeWords(plan, L, f0, 'general', 0, want.length, 0);
    expect(a).toMatchObject({ at: 1, n: want.length, fresh: 0, fid: f0.id, name: f0.name, room: L.TILE[f0.id]!.room.d.name });
    const W = { position: (i: number, n: number) => i + ' of ' + n, fresh: (n: number) => n + ' new', noTrouble: 'no trouble now', verdict: (h: Health) => h, nowReads: (l: string, h: Health) => l + ' now ' + h };
    const s = routeSentence(a, W);
    expect(s.startsWith('1 of ' + want.length + ' · ')).toBe(true);
    expect(s).toContain(L.TILE[f0.id]!.room.d.name + ' › ' + f0.name + ' · ' + plan.LENS[t0.lens]!.name + ' ' + t0.h + ': ' + t0.why);
    expect(routeSentence({ ...a, fresh: 1 }, W)).toContain(' · 1 new · ');
    const calm = S.features.find((f) => !f.trouble.length && f.lens[t0.lens])!;
    const b = routeWords(plan, L, calm, t0.lens, 0, 1, 0);
    expect(b.health).toEqual({ kind: 'lens', lens: t0.lens, lensName: plan.LENS[t0.lens]!.name, trouble: null, now: calm.lens[t0.lens]!.h });
  });
});
