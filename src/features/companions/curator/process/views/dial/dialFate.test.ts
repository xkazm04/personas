import { describe, expect, it } from 'vitest';
import { buildSpine } from '../../engine/spine';
import { devFailure, type DevInstance } from '../../engine/devAdapter';
import { departuresOf, fatesOf } from './dialFate';
import { alloc, buildArcs, buildRings, TICKS } from './dialModel';

const PH = ['brief', 'explore', 'edit', 'verify', 'ship'];

/** A deterministic cohort: sessions walk a prefix of the phases, some skip one, some stumble or fail. */
function cohort(n: number): DevInstance[] {
  const out: DevInstance[] = [];
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < n; i++) {
    const len = 1 + Math.floor(rnd() * 5);
    const steps = PH.slice(0, len)
      .filter((_, j) => !(j === 2 && rnd() < 0.15))
      .map((k, j) => ({ k, t: j * 30, err: rnd() < 0.15 ? 1 : 0, friction: rnd() < 0.05 }));
    const r = rnd();
    const outcome = len === 5 && r < 0.8 ? 'landed' : (['interrupted', 'errored', 'quiet'] as const)[Math.floor(r * 3)] ?? 'quiet';
    out.push({ id: `s${i}`, group: `r${i % 4}`, project: `r${i % 4}`, mode: 'interactive', outcome, active: 100, steps } as DevInstance);
  }
  return out;
}

describe('dial fates', () => {
  const list = cohort(300);
  const model = buildSpine(list, devFailure);
  const keys = model.stations.map((s) => s.keys);
  const fates = fatesOf(list, keys);

  it('agrees with the engine on reach, failing ends and stumbles at every station', () => {
    model.stations.forEach((st, q) => {
      expect(list.filter((x) => fates.get(x.id)!.reach > q).length).toBe(st.reached);
      expect(list.filter((x) => devFailure(x.outcome) && fates.get(x.id)!.exitAt === q).length).toBe(st.exits);
      expect(list.filter((x) => fates.get(x.id)!.frictionAt.includes(q)).length).toBe(st.friction);
    });
  });

  it('departures account for every session exactly once', () => {
    const dep = departuresOf(list, fates, keys.length);
    const total = dep.reduce((a, d) => a + d.landed + d.quiet + d.errored + d.interrupted, 0);
    expect(total).toBe(list.length);
  });

  it('cuts every ring into at most 120 ticks and keeps non-empty groups visible', () => {
    const dep = departuresOf(list, fates, keys.length);
    for (const r of buildRings(model, model, dep)) {
      expect(r.lit).toBeLessThanOrEqual(TICKS);
      r.counts.forEach((c, i) => { if (c > 0) expect(r.t[i]).toBeGreaterThan(0); });
    }
  });
});

describe('dial model', () => {
  it('alloc rounds the share to ticks and sums to the lit target', () => {
    expect(alloc([60, 30, 10], 100, 120).reduce((a, b) => a + b, 0)).toBe(120);
    expect(alloc([1, 0, 0, 0], 1000, 120)).toEqual([1, 0, 0, 0]);
  });

  it('wraps every repository around the bezel without overlap', () => {
    const arcs = buildArcs(cohort(200));
    expect(arcs).toHaveLength(4);
    arcs.slice(1).forEach((a, i) => expect(a.a0).toBeGreaterThan(arcs[i]!.a1));
    expect(arcs[arcs.length - 1]!.a1).toBeLessThanOrEqual(360);
  });
});
