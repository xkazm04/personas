/**
 * The drawing's pure parts (spark bp-fidelity, WP-A1) over the Kettle fixture: bp's delta window (a stage move in the
 * week before the as-of date), General's lens slots and a lone lens's expanded band (bp's subtle expression), and the
 * words a tile says under a lens (evidence parts in the app's number format, the reason as the stamp).
 */
import { describe, expect, it } from 'vitest';
import { kettleData } from '../fixture/kettle';
import { buildPlan } from '../model/plan';
import { dnum } from '../model/layout';
import { deltaWin } from '../engine/travel';
import { composeGeneral, expandedRect, lensContent, type FeatureLive, type Rect, type TileGeom } from '../engine/lens';
import type { EngineWords } from '../engine/types';
import type { Feature } from '../standard/load';

const data = kettleData();
const plan = buildPlan(data.structure, data.events);
const asOf = plan.S.asOf;

const geom = (form: 'tile' | 'ribbon', w: number, h: number): TileGeom => ({
  x: 0, y: 0, w, h, form, u: 1, k: 1, text: form === 'tile' && w >= 100 && h >= 44,
  strip: form === 'tile' ? { x: 6, y: 3, w: w - 12, h: Math.min(6, Math.max(3, h * 0.07)) } : { x: 0, y: 0, w, h: Math.min(3, h * 0.2) },
  body: form === 'tile' ? { x: 3, y: 3, w: w - 6, h: h - 6 } : { x: 1, y: 1, w: w - 2, h: h - 2 },
});
const live = (f: Feature): FeatureLive => ({ rolloutPct: 100, progressPct: 0, value: (l, k) => f.lens[l]?.v[k] });
const words = { verdict: (h: string) => h, num: (n: number) => String(n), pct: (n: number) => `${n} PCT`, fieldNo: (l: string) => `no ${l}` } as unknown as EngineWords;

describe('the delta window', () => {
  it('flies for a feature whose stage moved in the 7 days up to the as-of date, and for no other', () => {
    for (const f of plan.S.features) {
      const t = dnum(asOf), moved = f.revs.some((r) => dnum(r.date) > t - 7 && dnum(r.date) <= t);
      expect(!!deltaWin(f, asOf, 7)).toBe(moved);
    }
  });
  it('never flies for a feature without revisions', () => {
    const f = { ...plan.S.features[0]!, revs: [] } as Feature;
    expect(deltaWin(f, asOf, 7)).toBeNull();
  });
});

describe("General's slots and a lone lens's band", () => {
  it('gives a 160 px fixture one slot per lens along its top edge, in registry order, never overlapping', () => {
    const g = geom('tile', 160, 76), n = plan.lenses.length, out: Rect[] = [];
    for (let i = 0; i < n; i++) { const r = composeGeneral(g, n, i, { x: 0, y: 0, w: 0, h: 0 }); expect(r).not.toBeNull(); out.push({ ...r! }); }
    for (let i = 1; i < n; i++) expect(out[i]!.x).toBeGreaterThan(out[i - 1]!.x + out[i - 1]!.w);
    expect(out[n - 1]!.x + out[n - 1]!.w).toBeLessThanOrEqual(g.strip.x + g.strip.w + 0.001);
  });
  it('gives a ribbon segment no slots, and a lone lens the band along its foot', () => {
    const g = geom('ribbon', 40, 20);
    expect(composeGeneral(g, plan.lenses.length, 0, { x: 0, y: 0, w: 0, h: 0 })).toBeNull();
    const r = expandedRect(g, { x: 0, y: 0, w: 0, h: 0 });
    expect(r.y + r.h).toBeCloseTo(g.body.y + g.body.h);
    expect(r.w).toBe(g.body.w - 2);
  });
});

describe('the words a tile says under a lens', () => {
  it('prints evidence parts in upper case with the number layer, and the reason as the stamp when the lens is unwell', () => {
    let seen = 0;
    for (const f of plan.S.features) for (const d of plan.lenses) {
      const fl = f.lens[d.id];
      if (!fl) continue;
      const c = lensContent(words, d, f, live(f));
      expect(c.parts.length).toBeGreaterThan(0);
      for (const p of c.parts) expect(p).toBe(p.toUpperCase());
      if (fl.h !== 'bad' && fl.h !== 'watch') expect(c.stamp).toBeUndefined();
      else if (c.parts[0] !== fl.h.toUpperCase() && (fl.ov?.why ?? fl.why)) expect(c.stamp).toBe(fl.ov?.why ?? fl.why);
      seen++;
    }
    expect(seen).toBeGreaterThan(30);
  });
});
