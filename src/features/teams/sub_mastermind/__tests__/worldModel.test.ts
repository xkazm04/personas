import { describe, expect, it } from 'vitest';

import { athenaScript } from '../three/athenaOps';
import { attentionDims, dimProgress, dimsByCategory, MOCK_WORLD } from '../three/mockWorld';
import { fitPortfolio, gridSlots, isDensePortfolio, worldBounds } from '../three/worldLayout';
import { HOME, initialWorldState, nodeEmphasis, nodeId, worldReducer, type WorldAction, type WorldState } from '../three/worldModel';

const run = (actions: WorldAction[], from: WorldState = initialWorldState()): WorldState =>
  actions.reduce(worldReducer, from);

describe('mock world', () => {
  it('carries ten projects, the two hand-authored ones first', () => {
    expect(MOCK_WORLD.projects).toHaveLength(10);
    expect(MOCK_WORLD.projects.slice(0, 2).map((p) => p.slug)).toEqual(['personas', 'brainiac']);
    expect(new Set(MOCK_WORLD.projects.map((p) => p.slug)).size).toBe(10);
    expect(new Set(MOCK_WORLD.projects.map((p) => p.tag)).size).toBe(10);
  });

  it('gives every project all fifteen registry dimensions, grouped into four categories', () => {
    for (const p of MOCK_WORLD.projects) {
      expect(p.dims).toHaveLength(15);
      const groups = dimsByCategory(p);
      expect(groups).toHaveLength(4);
      expect(groups.reduce((n, g) => n + g.dims.length, 0)).toBe(15);
    }
  });

  it('spans every project state, so L0 has something to distinguish', () => {
    const states = new Set(MOCK_WORLD.projects.map((p) => p.state));
    expect(states).toContain('healthy');
    expect(states).toContain('warning');
    expect(states).toContain('critical');
    expect(states).toContain('building');
  });

  it('every edge names two projects that exist', () => {
    const slugs = new Set(MOCK_WORLD.projects.map((p) => p.slug));
    expect(MOCK_WORLD.edges.length).toBeGreaterThan(1);
    for (const e of MOCK_WORLD.edges) {
      expect(slugs.has(e.from)).toBe(true);
      expect(slugs.has(e.to)).toBe(true);
      expect(e.from).not.toBe(e.to);
    }
  });

  it('progress is 0..1 and boolean dims read from status', () => {
    for (const p of MOCK_WORLD.projects) for (const d of p.dims) {
      const v = dimProgress(d);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      if (d.steps > 0) expect(d.reached).toBeLessThanOrEqual(d.steps);
      // A cell nobody set up names no tool and no number.
      if (d.status === 'absent') expect(d.detail).toBeNull();
    }
    expect(dimProgress({ key: 'auth', status: 'solid', reached: 0, steps: 0, detail: null, figure: null })).toBe(1);
  });

  it('attention lists alert before risk, and the sketched portfolio has both', () => {
    const brainiac = MOCK_WORLD.projects[1]!;
    const att = attentionDims(brainiac);
    expect(att[0]?.status).toBe('alert');
    expect(att.every((d) => d.status === 'alert' || d.status === 'risk')).toBe(true);
    const all = MOCK_WORLD.projects.flatMap(attentionDims);
    expect(all.some((d) => d.status === 'alert')).toBe(true);
    expect(all.some((d) => d.status === 'risk')).toBe(true);
  });
});

describe('portfolio layout', () => {
  it('centres a grid on the origin and keeps the last row centred too', () => {
    const slots = gridSlots(10, 10);
    expect(slots).toHaveLength(10);
    const xs = slots.map((s) => s[0]);
    const zs = slots.map((s) => s[2]);
    // Centred: each axis spans symmetrically about the origin. NOT the mean —
    // ten projects make a 4/4/2 grid whose last row is partial, so the mass
    // centre sits off the origin while the FOOTPRINT (what the camera frames)
    // is centred. Asserting the mean here is what a first draft got wrong.
    expect(Math.abs(Math.min(...xs) + Math.max(...xs))).toBeLessThan(1e-9);
    expect(Math.abs(Math.min(...zs) + Math.max(...zs))).toBeLessThan(1e-9);
    // Every row is centred on its own, so a partial row does not hang off one side.
    const rows = new Map<number, number[]>();
    slots.forEach(([x, , z]) => rows.set(z, [...(rows.get(z) ?? []), x]));
    for (const xsInRow of rows.values()) expect(Math.abs(Math.min(...xsInRow) + Math.max(...xsInRow))).toBeLessThan(1e-9);
    // Wider than deep — a portfolio reads better across than into the screen.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...zs) - Math.min(...zs));
    // No two projects share a slot.
    expect(new Set(slots.map((s) => `${s[0]},${s[2]}`)).size).toBe(10);
  });

  it('handles the degenerate counts', () => {
    expect(gridSlots(0, 10)).toEqual([]);
    expect(gridSlots(1, 10)).toEqual([[0, 0, 0]]);
    expect(gridSlots(2, 10).map((s) => s[0])).toEqual([-5, 5]);
  });

  it('bounds pad the footprint and expose a radius that encloses it', () => {
    const b = worldBounds(gridSlots(10, 10), 3);
    expect(b.cx).toBeCloseTo(0);
    expect(b.cz).toBeCloseTo(0);
    expect(b.width).toBeGreaterThan(b.depth);
    expect(b.radius).toBeGreaterThanOrEqual(Math.max(b.width, b.depth) / 2);
  });

  it('pulls the camera back as the portfolio grows', () => {
    const opts = { fov: 42, aspect: 1.6, pitch: 40 };
    const two = fitPortfolio(worldBounds(gridSlots(2, 11.5), 4.7), opts);
    const ten = fitPortfolio(worldBounds(gridSlots(10, 11.5), 4.7), opts);
    expect(ten.distance).toBeGreaterThan(two.distance);
    // and back further again on a narrow canvas, where the horizontal field
    // is the binding constraint — the bug the two-project version had.
    const narrow = fitPortfolio(worldBounds(gridSlots(10, 11.5), 4.7), { ...opts, aspect: 0.7 });
    expect(narrow.distance).toBeGreaterThan(ten.distance);
  });

  it('always looks at the middle of the portfolio', () => {
    const fit = fitPortfolio(worldBounds(gridSlots(7, 12), 4), { fov: 42, aspect: 1.4, pitch: 45 });
    expect(fit.target[0]).toBeCloseTo(0);
    expect(fit.position[1]).toBeGreaterThan(0);
    expect(fit.position[2]).toBeGreaterThan(0);
  });

  it('calls a ten-project portfolio dense and a two-project one not', () => {
    expect(isDensePortfolio(10)).toBe(true);
    expect(isDensePortfolio(2)).toBe(false);
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

  it('"risks" points at exactly the alert/risk dimensions, across the whole portfolio', () => {
    const steps = athenaScript('risks', MOCK_WORLD);
    const hl = steps.flatMap((s) => s.actions).find((a): a is Extract<WorldAction, { type: 'highlight' }> => a.type === 'highlight');
    const expected = MOCK_WORLD.projects.flatMap((p) => attentionDims(p).map((d) => nodeId(p.slug, d.key)));
    expect(hl?.ids).toEqual(expected);
    expect(expected.length).toBeGreaterThan(2);
    // more than one project contributes, or the tour is not a portfolio tour
    expect(new Set(hl?.ids.map((id) => id.split(':')[0])).size).toBeGreaterThan(1);
  });

  it('"ship" visits every project in the world', () => {
    const steps = athenaScript('ship', MOCK_WORLD);
    const opened = steps.flatMap((s) => s.actions).filter((a): a is Extract<WorldAction, { type: 'open-project' }> => a.type === 'open-project');
    expect(opened.map((a) => a.slug)).toEqual(MOCK_WORLD.projects.map((p) => p.slug));
  });

  it('"wire" flies to Brainiac monitoring and then changes the world', () => {
    const s = run(athenaScript('wire', MOCK_WORLD).flatMap((x) => x.actions));
    expect(s.focus).toEqual({ level: 2, project: 'brainiac', dim: 'monitoring' });
    expect(s.overrides['brainiac:monitoring']?.status).toBe('solid');
    expect(s.athenaBusy).toBe(false);
  });
});
