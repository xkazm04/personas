// The MID band's lane model and its two prototype variants.
//
// The contract that matters across the whole band ladder: mid's three lane
// counts must sum to exactly the number the far band renders. If they ever
// diverge, one of the two bands is lying to an operator who zooms between them
// constantly — so that invariant is pinned first and hardest.
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import {
  PERSONA_INK, RUNNER_INK,
  processBuckets, processLanes, processTotal, runnerProgress,
} from '../lib/farProcesses';
import { FLEET_INK } from '../lib/ink';
import { MidFacetCube } from '../lib/MidFacetCube';
import { MidTallyBoard } from '../lib/MidTallyBoard';
import { setMidVariant } from '../lib/midVariantStore';
import { MosaicIsland } from '../variants/MosaicIsland';
import type { IslandCtx } from '../lib/CanvasShell';
import { DIM_ORDER, DIM_REGISTRY } from '../lib/dimRegistry';
import type { FleetNode, Island, RunnerNode, ZoomBand } from '../lib/types';

const session = (id: string, state: string): FleetNode => ({ id, label: id, state });
const task = (id: string, status: string, progress = 0): RunnerNode => ({ id, title: id, status, progress });

const q = (c: HTMLElement, sel: string) => c.querySelectorAll(sel);

describe('process lanes — the mid band model', () => {
  it('always reports all three lanes, in a fixed order, even when empty', () => {
    const lanes = processLanes([], [], []);
    expect(lanes.map((l) => l.key)).toEqual(['fleet', 'persona', 'runner']);
    expect(lanes.every((l) => l.count === 0)).toBe(true);
  });

  it('sums to exactly the number the far band renders', () => {
    const fleet = [session('a', 'running'), session('b', 'awaiting_input'), session('c', 'exited')];
    const personas = ['Dev Clone', 'QA Guardian'];
    const runners = [task('t1', 'running'), task('t2', 'queued')];
    const far = processTotal(processBuckets(fleet, personas, runners));
    const mid = processLanes(fleet, personas, runners).reduce((n, l) => n + l.count, 0);
    // 2 live sessions (the exited one counts for neither) + 2 personas + 2 tasks
    expect(far).toBe(6);
    expect(mid).toBe(far);
  });

  it('reports each lane its most urgent state, not its most common one', () => {
    const lanes = processLanes(
      [session('a', 'idle'), session('b', 'idle'), session('c', 'awaiting_input')],
      [],
      [task('t1', 'queued'), task('t2', 'running')],
    );
    expect(lanes[0]!.state).toBe('awaiting_input');
    expect(lanes[0]!.ink).toBe(FLEET_INK.awaiting_input);
    // running outranks queued — work in flight is more informative than work waiting.
    expect(lanes[2]!.state).toBe('running');
  });

  it('flags the fleet lane when something stopped for a human', () => {
    expect(processLanes([session('a', 'running')], [], []) [0]!.attention).toBe(false);
    expect(processLanes([session('a', 'stale')], [], [])[0]!.attention).toBe(true);
    expect(processLanes([session('a', 'awaiting_input')], [], [])[0]!.attention).toBe(true);
  });

  it('gives the two headless lanes distinguishable inks', () => {
    const lanes = processLanes([], ['P'], [task('t', 'running')]);
    expect(lanes[1]!.ink).toBe(PERSONA_INK);
    expect(lanes[2]!.ink).toBe(RUNNER_INK);
    expect(PERSONA_INK).not.toBe(RUNNER_INK);
  });

  it('averages runner progress over RUNNING tasks only', () => {
    // A queued task has not started; averaging its 0% in would read as a stall.
    expect(runnerProgress([task('a', 'running', 80), task('b', 'queued', 0)])).toBeCloseTo(0.8);
    expect(runnerProgress([task('a', 'queued', 0)])).toBeNull();
    expect(runnerProgress([])).toBeNull();
    // Out-of-range values are clamped rather than trusted.
    expect(runnerProgress([task('a', 'running', 150)])).toBeCloseTo(1);
  });
});

describe('mid variants render the lanes', () => {
  const paintVariant = (Variant: typeof MidFacetCube | typeof MidTallyBoard) =>
    render(
      <svg>
        <Variant
          fleet={[session('a', 'awaiting_input'), session('b', 'running')]}
          personas={['Dev Clone']}
          runners={[task('t1', 'running', 40), task('t2', 'queued')]}
        />
      </svg>,
    ).container;

  it('Facet draws three faces with a count each, and holds the far total at the centre', () => {
    const c = paintVariant(MidFacetCube);
    expect(q(c, '[data-testid^="mm-facet-face-"]')).toHaveLength(3);
    expect(c.querySelector('[data-testid="mm-facet-count-fleet"]')?.textContent).toBe('2');
    expect(c.querySelector('[data-testid="mm-facet-count-persona"]')?.textContent).toBe('1');
    expect(c.querySelector('[data-testid="mm-facet-count-runner"]')?.textContent).toBe('2');
    // The centre chip is the far band's number — the breakdown provably sums to it.
    expect(c.querySelector('[data-testid="mm-facet-total"] text')?.textContent).toBe('5');
    // Runner progress rides the runner face rim; a stopped session marks the fleet rim.
    expect(q(c, '[data-testid="mm-facet-progress"]')).toHaveLength(1);
    expect(q(c, '[data-testid="mm-facet-attention"]')).toHaveLength(1);
  });

  it('Tally draws one pip per process, in each session/task state', () => {
    const c = paintVariant(MidTallyBoard);
    expect(q(c, '[data-testid="mm-tally-pip-fleet"]')).toHaveLength(2);
    expect(q(c, '[data-testid="mm-tally-pip-persona"]')).toHaveLength(1);
    expect(q(c, '[data-testid="mm-tally-pip-runner"]')).toHaveLength(2);
    // The stuck session is visibly THE ringed pip, sorted to the front of its row.
    expect(q(c, '[data-testid="mm-tally-attn-pip"]')).toHaveLength(1);
    const fleetPips = [...q(c, '[data-testid="mm-tally-pip-fleet"]')];
    expect(fleetPips[0]!.getAttribute('fill')).toBe(FLEET_INK.awaiting_input);
    // A queued task exists but has not started: hollow pip, after the running one.
    const runnerPips = [...q(c, '[data-testid="mm-tally-pip-runner"]')];
    expect(runnerPips[0]!.getAttribute('fill')).toBe(RUNNER_INK);
    expect(runnerPips[1]!.getAttribute('fill')).toBe('none');
    expect(c.querySelector('[data-testid="mm-tally-count-fleet"]')?.textContent).toBe('2');
  });

  it('renders an empty lane as an empty lane, never as a missing one', () => {
    const c = render(
      <svg><MidTallyBoard fleet={[session('a', 'running')]} personas={[]} runners={[]} /></svg>,
    ).container;
    expect(q(c, '[data-testid^="mm-tally-row-"]')).toHaveLength(3);
    expect(q(c, '[data-testid="mm-tally-empty-persona"]')).toHaveLength(1);
    expect(q(c, '[data-testid="mm-tally-empty-runner"]')).toHaveLength(1);
  });

  it('an idle island sleeps at mid the same way it sleeps at far', () => {
    for (const Variant of [MidFacetCube, MidTallyBoard]) {
      const c = render(<svg><Variant fleet={[]} personas={[]} runners={[]} /></svg>).container;
      // The sleeping mark is the one nested svg inside the body.
      expect(q(c, 'svg svg')).toHaveLength(1);
    }
  });

  it('every lane glyph is a POSITIONED nested svg — the round-1 regression', () => {
    // Round 1 shipped glyphs whose x/y/width/height were silently dropped
    // (FleetShipIcon had a fixed prop list); an unpositioned nested <svg>
    // defaults to 100% of the viewport and painted ship icons across the whole
    // canvas. Pin the fix: every nested svg a variant renders must carry an
    // explicit width.
    for (const Variant of [MidFacetCube, MidTallyBoard]) {
      const c = paintVariant(Variant);
      const nested = [...q(c, 'svg svg')];
      expect(nested.length).toBeGreaterThan(0);
      for (const el of nested) expect(el.getAttribute('width')).toBeTruthy();
    }
  });
});

describe('band wiring', () => {
  const ctx = (band: ZoomBand): IslandCtx => ({
    z: 0.35, band, mode: 'edit',
    onHover: () => {}, onIslandCommit: () => {}, onFleetOpen: () => {}, onIslandTap: () => {},
    onShipOpen: () => {}, onConnectStart: () => {}, onIslandFocus: () => {}, onIslandMenu: () => {},
    highlightKey: null, onFleetList: () => {}, onDimOpen: () => {}, onPersonasOpen: () => {},
    onCategoryOpen: () => {},
  });
  const island = (over: Partial<Island> = {}): Island => ({
    slug: 'acme', name: 'Acme', purpose: '', x: 0, y: 0,
    state: 'healthy', stateSource: 'readiness', autoScore: 70, prodScore: 60,
    lifecycle: 'building', automationLabel: 'Assisted', blockers: 0,
    nodes: DIM_ORDER.map((key) => ({
      key, label: DIM_REGISTRY[key].label, status: 'absent' as const,
      detail: null, reached: 0, steps: 0, days: null,
    })),
    fleet: [], personasRunning: [], runners: [], attention: false,
    monitorErrors: null, stats: [], ship: null, ...over,
  });
  const paint = (band: ZoomBand, over: Partial<Island> = {}) =>
    render(<svg><MosaicIsland island={island(over)} {...ctx(band)} /></svg>).container;

  beforeEach(() => setMidVariant('baseline'));

  it('the selected variant owns the mid body, and only at mid', () => {
    setMidVariant('facet');
    expect(q(paint('mid', { fleet: [session('a', 'running')] }), '[data-testid="mm-mid-facet"]')).toHaveLength(1);
    expect(q(paint('far', { fleet: [session('a', 'running')] }), '[data-testid="mm-mid-facet"]')).toHaveLength(0);
    setMidVariant('tally');
    expect(q(paint('mid', { fleet: [session('a', 'running')] }), '[data-testid="mm-mid-tally"]')).toHaveLength(1);
    expect(q(paint('mid'), '[data-testid="mm-mid-facet"]')).toHaveLength(0);
  });

  it('a mid variant replaces the category quad and the core cell', () => {
    setMidVariant('facet');
    const c = paint('mid');
    expect(q(c, '[data-testid^="mm-category-"]')).toHaveLength(0);
  });

  it('dev-runner tasks reach the FAR count too, so the bands agree', () => {
    const c = paint('far', { runners: [task('t1', 'running'), task('t2', 'queued')] });
    expect(c.querySelector('[data-testid="mm-far-count"]')?.textContent).toBe('2');
    expect(q(c, '[data-testid="mm-far-seg-runners"]')).toHaveLength(1);
  });
});
