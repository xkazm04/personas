import { describe, expect, it } from 'vitest';

import { athenaScript } from '../three/athenaOps';
import { attentionDims, dimProgress, dimsByCategory, MOCK_WORLD } from '../three/mockWorld';
import { HOME, initialWorldState, nodeEmphasis, nodeId, worldReducer, type WorldAction, type WorldState } from '../three/worldModel';

const run = (actions: WorldAction[], from: WorldState = initialWorldState()): WorldState =>
  actions.reduce(worldReducer, from);

describe('mock world', () => {
  it('has two projects, every registry dimension on each, and one relation', () => {
    expect(MOCK_WORLD.projects.map((p) => p.slug)).toEqual(['personas', 'brainiac']);
    for (const p of MOCK_WORLD.projects) {
      expect(p.dims).toHaveLength(15);
      expect(dimsByCategory(p).reduce((n, g) => n + g.dims.length, 0)).toBe(15);
    }
    expect(MOCK_WORLD.edges).toHaveLength(1);
  });

  it('progress is 0..1 and boolean dims read from status', () => {
    for (const p of MOCK_WORLD.projects) for (const d of p.dims) {
      const v = dimProgress(d);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(dimProgress({ key: 'auth', status: 'solid', reached: 0, steps: 0, detail: null, figure: null })).toBe(1);
  });

  it('attention lists alert before risk', () => {
    const brainiac = MOCK_WORLD.projects[1]!;
    const att = attentionDims(brainiac);
    expect(att[0]?.status).toBe('alert');
    expect(att.every((d) => d.status === 'alert' || d.status === 'risk')).toBe(true);
  });
});

describe('world reducer — the three layers', () => {
  it('drills L0 → L1 → L2 and walks back up with Escape semantics', () => {
    let s = run([{ type: 'open-project', slug: 'personas' }]);
    expect(s.focus).toEqual({ level: 1, project: 'personas', dim: null });
    s = run([{ type: 'open-dim', slug: 'personas', dim: 'tests' }], s);
    expect(s.focus).toEqual({ level: 2, project: 'personas', dim: 'tests' });
    s = run([{ type: 'up' }], s);
    expect(s.focus).toEqual({ level: 1, project: 'personas', dim: null });
    s = run([{ type: 'up' }], s);
    expect(s.focus).toEqual(HOME);
    // up at home is a no-op — same reference, no flight
    expect(worldReducer(s, { type: 'up' })).toBe(s);
  });

  it('bumps the flight counter on every focus change so the camera re-flies', () => {
    const s0 = initialWorldState();
    const s1 = worldReducer(s0, { type: 'open-project', slug: 'brainiac' });
    const s2 = worldReducer(s1, { type: 'open-dim', slug: 'brainiac', dim: 'security' });
    const s3 = worldReducer(s2, { type: 'home' });
    expect([s1.flight, s2.flight, s3.flight]).toEqual([1, 2, 3]);
  });

  it('home clears Athena highlights; hover is a no-op when unchanged', () => {
    const s = run([{ type: 'highlight', ids: ['brainiac:security'] }, { type: 'open-project', slug: 'brainiac' }, { type: 'home' }]);
    expect(s.highlight.size).toBe(0);
    expect(s.focus).toEqual(HOME);
    const h = worldReducer(s, { type: 'hover', id: null });
    expect(h).toBe(s);
  });

  it('keeps at most six transcript lines', () => {
    const s = run(Array.from({ length: 9 }, (_, i) => ({ type: 'say', who: 'athena', key: `k${i}` }) as WorldAction));
    expect(s.transcript).toHaveLength(6);
    expect(s.transcript[0]?.key).toBe('k3');
  });
});

describe('node emphasis — what fades when you drill down', () => {
  it('at L0 projects are full and dimensions are ghosts', () => {
    expect(nodeEmphasis(HOME, 'personas', null)).toBe(1);
    expect(nodeEmphasis(HOME, 'personas', 'db')).toBeLessThan(0.5);
  });
  it('at L1 only the focused project is full', () => {
    const f = { level: 1 as const, project: 'personas', dim: null };
    expect(nodeEmphasis(f, 'personas', 'db')).toBe(1);
    expect(nodeEmphasis(f, 'brainiac', 'db')).toBeLessThan(0.1);
    expect(nodeEmphasis(f, 'brainiac', null)).toBeLessThan(0.5);
  });
  it('at L2 one dimension is full and its siblings are ghosts', () => {
    const f = { level: 2 as const, project: 'personas', dim: 'db' as const };
    expect(nodeEmphasis(f, 'personas', 'db')).toBe(1);
    expect(nodeEmphasis(f, 'personas', 'ci')).toBeLessThan(0.2);
    expect(nodeEmphasis(f, 'personas', null)).toBeGreaterThan(nodeEmphasis(f, 'brainiac', null));
  });
});

describe('Athena scripts', () => {
  it('every command narrates, starts busy and ends not busy', () => {
    for (const cmd of ['risks', 'ship', 'focus', 'wire'] as const) {
      const steps = athenaScript(cmd, MOCK_WORLD);
      const all = steps.flatMap((s) => s.actions);
      expect(steps[0]?.at).toBe(0);
      expect(all.some((a) => a.type === 'say' && a.who === 'athena')).toBe(true);
      const busy = all.filter((a): a is Extract<WorldAction, { type: 'busy' }> => a.type === 'busy');
      expect(busy[0]?.busy).toBe(true);
      expect(busy[busy.length - 1]?.busy).toBe(false);
      // timeline is monotonic
      for (let i = 1; i < steps.length; i++) expect(steps[i]!.at).toBeGreaterThanOrEqual(steps[i - 1]!.at);
    }
  });

  it('"risks" points at exactly the alert/risk dimensions', () => {
    const steps = athenaScript('risks', MOCK_WORLD);
    const hl = steps.flatMap((s) => s.actions).find((a): a is Extract<WorldAction, { type: 'highlight' }> => a.type === 'highlight');
    const expected = MOCK_WORLD.projects.flatMap((p) => attentionDims(p).map((d) => nodeId(p.slug, d.key)));
    expect(hl?.ids).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });

  it('"wire" flies to Brainiac monitoring and then changes the world', () => {
    const s = run(athenaScript('wire', MOCK_WORLD).flatMap((x) => x.actions));
    expect(s.focus).toEqual({ level: 2, project: 'brainiac', dim: 'monitoring' });
    expect(s.overrides['brainiac:monitoring']?.status).toBe('solid');
    expect(s.athenaBusy).toBe(false);
  });
});
