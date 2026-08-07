// The MID band's lane model and its two prototype variants.
//
// The contract that matters across the whole band ladder: mid's three lane
// counts must sum to exactly the number the far band renders. If they ever
// diverge, one of the two bands is lying to an operator who zooms between them
// constantly — so that invariant is pinned first and hardest.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import {
  PERSONA_INK, RUNNER_INK,
  processBuckets, processLanes, processTotal, runnerProgress,
} from '../lib/farProcesses';
import { FLEET_INK } from '../lib/ink';
import { MidFacetCube } from '../lib/MidFacetCube';
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

describe('the Facet cube renders the lanes', () => {
  const paint = (over: { fleet?: FleetNode[]; personas?: string[]; runners?: RunnerNode[]; onLaneOpen?: (lane: string, e: unknown) => void } = {}) =>
    render(
      <svg>
        <MidFacetCube
          fleet={over.fleet ?? [session('a', 'awaiting_input'), session('b', 'running')]}
          personas={over.personas ?? ['Dev Clone']}
          runners={over.runners ?? [task('t1', 'running', 40), task('t2', 'queued')]}
          onLaneOpen={over.onLaneOpen}
        />
      </svg>,
    ).container;

  it('draws three faces with a count each, and holds the far total at the centre', () => {
    const c = paint();
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

  it('an empty face shows its watermark and NOTHING else — no numeral, no dash', () => {
    const c = paint({ personas: [], runners: [] });
    const face = c.querySelector('[data-testid="mm-facet-face-persona"]')!;
    expect(face.querySelector('text')).toBeNull();
    expect(face.textContent).not.toContain('–');
    // The watermark glyph still names the lane.
    expect(face.querySelectorAll('svg')).toHaveLength(1);
  });

  it('routes a click on a LIVE face to its lane, and refuses clicks on empty ones', () => {
    const onLaneOpen = vi.fn();
    const c = paint({ personas: [], onLaneOpen });
    fireEvent.click(c.querySelector('[data-testid="mm-facet-face-fleet"]')!);
    fireEvent.click(c.querySelector('[data-testid="mm-facet-face-runner"]')!);
    // Empty persona lane: nothing to list, so the face is inert.
    fireEvent.click(c.querySelector('[data-testid="mm-facet-face-persona"]')!);
    expect(onLaneOpen.mock.calls.map((call) => call[0])).toEqual(['fleet', 'runner']);
  });

  it('stays inert without onLaneOpen (non-edit modes)', () => {
    const c = paint();
    // No handler wired: clicking must not throw and no cursor affordance shows.
    fireEvent.click(c.querySelector('[data-testid="mm-facet-face-fleet"]')!);
    expect(c.querySelector('[data-testid="mm-facet-face-fleet"]')!.getAttribute('style')).toBeNull();
  });

  it('an idle island sleeps at mid the same way it sleeps at far', () => {
    const c = paint({ fleet: [], personas: [], runners: [] });
    // Only the sleeping mark — no faces, no counts.
    expect(q(c, '[data-testid^="mm-facet-face-"]')).toHaveLength(0);
    expect(q(c, 'svg svg')).toHaveLength(1);
  });

  it('every lane glyph is a POSITIONED nested svg — the round-1 regression', () => {
    // Round 1 shipped glyphs whose x/y/width/height were silently dropped
    // (FleetShipIcon had a fixed prop list); an unpositioned nested <svg>
    // defaults to 100% of the viewport and painted ship icons across the whole
    // canvas. Pin the fix: every nested svg the body renders carries a width.
    const c = paint();
    const nested = [...q(c, 'svg svg')];
    expect(nested.length).toBeGreaterThan(0);
    for (const el of nested) expect(el.getAttribute('width')).toBeTruthy();
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

  it('Facet owns the mid body, and only at mid', () => {
    expect(q(paint('mid', { fleet: [session('a', 'running')] }), '[data-testid="mm-mid-facet"]')).toHaveLength(1);
    expect(q(paint('far', { fleet: [session('a', 'running')] }), '[data-testid="mm-mid-facet"]')).toHaveLength(0);
  });

  it('the category quad and the core cell are gone from mid', () => {
    const c = paint('mid');
    expect(q(c, '[data-testid^="mm-category-"]')).toHaveLength(0);
  });

  it('dev-runner tasks reach the FAR count too, so the bands agree', () => {
    const c = paint('far', { runners: [task('t1', 'running'), task('t2', 'queued')] });
    expect(c.querySelector('[data-testid="mm-far-count"]')?.textContent).toBe('2');
    expect(q(c, '[data-testid="mm-far-seg-runners"]')).toHaveLength(1);
  });
});
