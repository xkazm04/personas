// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { DevInstance } from '../../engine/devAdapter';
import { devFailure } from '../../engine/devAdapter';
import { buildSpine } from '../../engine/spine';
import { surveyFates } from './fates';

const PHASES = ['brief', 'explore', 'edit', 'verify', 'ship', 'web'];
const OUTCOMES = ['landed', 'landed', 'landed', 'errored', 'interrupted', 'quiet'];

/** A deterministic cohort: mostly the canonical order, with skips, detours, early ends and errors. */
function cohort(n: number, seed = 7): DevInstance[] {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return Array.from({ length: n }, (_, i) => {
    const len = 1 + Math.floor(rnd() * 7);
    const steps = Array.from({ length: len }, (_, j) => {
      const k = rnd() < 0.75 ? PHASES[Math.min(4, j)]! : PHASES[Math.floor(rnd() * PHASES.length)]!;
      return { k, t: j * 30 + Math.floor(rnd() * 20), err: rnd() < 0.1 ? 1 : 0, friction: rnd() < 0.05 };
    });
    return { id: `s${i}`, group: i % 3 ? 'big' : 'small', project: i % 3 ? 'big' : 'small', mode: 'interactive', active: 0,
      outcome: OUTCOMES[Math.floor(rnd() * OUTCOMES.length)]!, steps };
  });
}

describe('surveyFates', () => {
  const list = cohort(400);
  const model = buildSpine(list, devFailure);
  const f = surveyFates(list, model, devFailure);

  it('replays the engine alignment: reached, exits and friction agree with the spine', () => {
    model.stations.forEach((s, q) => {
      const reached = list.filter((x) => f.per.get(x.id)!.reach > q).length;
      expect(reached).toBe(s.reached);
      expect(f.stations[q]!.exitIds.length).toBe(s.exits);
      expect(f.stations[q]!.frictionIds.length).toBe(s.friction);
    });
  });

  it('conserves every session: marshes + lakes + sea = n, one lane each', () => {
    const marsh = f.fail.reduce((a, x) => a + x.length, 0);
    const lake = f.clean.reduce((a, x) => a + x.length, 0);
    const sea = Object.values(f.sea).reduce((a, x) => a + x.length, 0);
    expect(marsh + lake + sea).toBe(list.length);
    expect(new Set(f.lanes.values()).size).toBe(list.length);
  });

  it('measures a repository against the whole path', () => {
    const small = list.filter((x) => x.project === 'small');
    const m = buildSpine(small, devFailure, list);
    const fs = surveyFates(small, m, devFailure);
    m.stations.forEach((s, q) => expect(fs.stations[q]!.exitIds.length).toBe(s.exits));
  });
});
