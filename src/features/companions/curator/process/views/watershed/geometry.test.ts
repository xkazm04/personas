// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { DevInstance } from '../../engine/devAdapter';
import { devFailure } from '../../engine/devAdapter';
import { buildSpine } from '../../engine/spine';
import { surveyFates } from './fates';
import { computeGeo } from './geometry';
import { allocLabels, type MapWords } from './labels';

const PATH = ['brief', 'explore', 'edit', 'verify', 'ship'];
function cohort(n: number): DevInstance[] {
  return Array.from({ length: n }, (_, i) => {
    const len = 1 + (i * 7) % 5;
    const steps = PATH.slice(0, len).map((k, j) => ({ k, t: j * 10, err: i % 9 === 0 && j === len - 1 ? 1 : 0, friction: false }));
    const outcome = len === 5 ? (i % 4 ? 'landed' : 'quiet') : i % 2 ? 'errored' : 'quiet';
    return { id: `s${i}`, group: 'g', project: 'g', mode: 'interactive', active: 0, outcome, steps };
  });
}

const words: MapWords = {
  marshLong: (c) => `${c} ended here failing`, marshShort: (c) => `${c} failing`, lakeLong: (c) => `${c} left clean`, lakeShort: (c) => `${c} clean`,
  spring: 'Spring', setOut: (n) => `${n} set out`, place: (q) => `P${q}`, ghost: 'ghost', waitForms: () => ['wait 1m'], deltaHead: 'How the sessions ended',
};
const measure = (s: string, px: number) => s.length * px * 0.55;

describe('computeGeo', () => {
  const list = cohort(300);
  const model = buildSpine(list, devFailure);
  const fates = surveyFates(list, model, devFailure);
  const geo = (W: number, H: number) => computeGeo({ W, H, fs: 16.5, model, fates, seed: 'interactive', picked: false,
    cartTitle: 'Interactive watershed', cartSub: '300 sessions', scaleProbe: 'Every one ends on this map', measure });

  it('narrows the river by exactly the sessions that left: what is left at the delta is the sea', () => {
    const g = geo(1280, 724);
    const atDelta = g.bot(g.xB) - g.top(g.xB);
    const sea = Object.values(fates.sea).reduce((a, x) => a + x.length, 0);
    expect(atDelta).toBeCloseTo(sea * g.k, 3);
    expect(g.top(g.xA) - g.yc(g.xA)).toBeCloseTo(-g.srcW / 2, 3);
  });

  it('lays out one plate per station inside the stage, and grows the scale with a big screen', () => {
    const small = geo(1280, 724), big = geo(1920, 990);
    expect(small.plates).toHaveLength(model.stations.length);
    for (const p of small.plates) { expect(p.left).toBeGreaterThanOrEqual(8); expect(p.left + p.width).toBeLessThanOrEqual(1280 - 8 + 1e-6); }
    expect(small.U).toBe(1);
    expect(big.U).toBeGreaterThan(1);
  });

  it('never places two map labels on top of each other', () => {
    const g = geo(1280, 724);
    const { texts } = allocLabels(g, model, words, measure, false);
    const boxes = texts.filter((t) => t.cls !== 'sub').map((t) => ({ x: t.x, y: t.y - g.fs, w: measure(t.text, g.fs), h: g.fs * 1.2 }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).toBe(false);
    }
  });
});
