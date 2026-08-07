// The far band's island body. `far` used to share `mid`'s four category hexes;
// it is now one large process hex, and these assert the swap in both
// directions — what far gained, and what it must NOT still be drawing.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { FLEET_INK } from '../lib/ink';
import { MosaicIsland } from '../variants/MosaicIsland';
import type { IslandCtx } from '../lib/CanvasShell';
import type { FleetNode, Island, ZoomBand } from '../lib/types';
import { DIM_ORDER, DIM_REGISTRY } from '../lib/dimRegistry';

const noop = () => {};

const ctx = (band: ZoomBand): IslandCtx => ({
  z: band === 'far' ? 0.12 : 0.35,
  band,
  mode: 'edit',
  onHover: noop,
  onIslandCommit: noop,
  onFleetOpen: noop,
  onIslandTap: noop,
  onShipOpen: noop,
  onConnectStart: noop,
  onIslandFocus: noop,
  onIslandMenu: noop,
  highlightKey: null,
  onFleetList: noop,
  onDimOpen: noop,
  onPersonasOpen: noop,
  onCategoryOpen: noop,
});

const session = (id: string, state: string): FleetNode => ({ id, label: id, state });

const island = (over: Partial<Island> = {}): Island => ({
  slug: 'acme', name: 'Acme', purpose: 'Test fixture',
  x: 0, y: 0,
  state: 'healthy', stateSource: 'readiness',
  autoScore: 70, prodScore: 60,
  lifecycle: 'building', automationLabel: 'Assisted',
  blockers: 0,
  nodes: DIM_ORDER.map((key) => ({
    key, label: DIM_REGISTRY[key].label, status: 'absent' as const,
    detail: null, reached: 0, steps: 0, days: null,
  })),
  fleet: [], personasRunning: [], runners: [], attention: false,
  monitorErrors: null, stats: [], ship: null,
  ...over,
});

/** Render one island at a band and hand back its SVG root for querying. */
function paint(band: ZoomBand, over: Partial<Island> = {}) {
  const { container } = render(
    <svg>
      <MosaicIsland island={island(over)} {...ctx(band)} />
    </svg>,
  );
  return container;
}

const q = (c: HTMLElement, sel: string) => c.querySelectorAll(sel);

describe('far band — one process hex', () => {
  it('replaces the category quad, the core cell and the fleet badges', () => {
    const far = paint('far', { fleet: [session('a', 'running')] });
    expect(q(far, '[data-testid="mm-far-hex"]')).toHaveLength(1);
    expect(q(far, '[data-testid^="mm-category-"]')).toHaveLength(0);
    // The badges are the same fleet/persona readout the hex now is — printing
    // the fact twice at the band with the least room is the bug this prevents.
    expect(q(far, '[data-testid^="mm-fleet-badge-"]')).toHaveLength(0);
  });

  it('leaves the mid band to the Facet cube, badges intact', () => {
    const mid = paint('mid', { fleet: [session('a', 'running')] });
    expect(q(mid, '[data-testid="mm-far-hex"]')).toHaveLength(0);
    expect(q(mid, '[data-testid="mm-mid-facet"]')).toHaveLength(1);
    expect(q(mid, '[data-testid^="mm-fleet-badge-"]').length).toBeGreaterThan(0);
  });

  it('sleeps when nothing is running: a mark, no number, no border segments', () => {
    const c = paint('far');
    expect(q(c, '[data-testid="mm-far-count"]')).toHaveLength(0);
    expect(q(c, '[data-testid^="mm-far-seg-"]')).toHaveLength(0);
    // The sleeping mark is the nested lucide-shaped <svg> inside the hex.
    expect(q(c, '[data-testid="mm-far-hex"] svg')).toHaveLength(1);
    expect(c.querySelector('[data-testid="mm-far-hex"] title')?.textContent).toContain('Nothing running here');
  });

  it('fills the hex with the combined Fleet + persona count', () => {
    const c = paint('far', {
      fleet: [session('a', 'running'), session('b', 'idle')],
      personasRunning: ['Dev Clone'],
    });
    expect(c.querySelector('[data-testid="mm-far-count"]')?.textContent).toBe('3');
    expect(q(c, '[data-testid="mm-far-hex"] svg')).toHaveLength(0); // no sleeping mark
  });

  it('excludes exited sessions from the number', () => {
    const c = paint('far', { fleet: [session('a', 'running'), session('b', 'exited')] });
    expect(c.querySelector('[data-testid="mm-far-count"]')?.textContent).toBe('1');
  });

  it('gives every process bucket its own border arc, in its own ink', () => {
    const c = paint('far', {
      fleet: [session('a', 'awaiting_input'), session('b', 'running'), session('c', 'running')],
      personasRunning: ['Dev Clone'],
    });
    const segs = [...q(c, '[data-testid^="mm-far-seg-"]')];
    expect(segs.map((s) => s.getAttribute('data-testid'))).toEqual([
      'mm-far-seg-awaiting_input', 'mm-far-seg-running', 'mm-far-seg-personas',
    ]);
    expect(segs[0]!.getAttribute('stroke')).toBe(FLEET_INK.awaiting_input);
    // Arcs are laid end to end around the perimeter, never stacked at zero.
    const offsets = segs.map((s) => Number(s.getAttribute('stroke-dashoffset')));
    expect(offsets[0]).toBeGreaterThan(offsets[1]!);
    expect(offsets[1]).toBeGreaterThan(offsets[2]!);
    // Segment lengths are proportional: `running` (2 of 4) is the longest.
    const len = (i: number) => Number(segs[i]!.getAttribute('stroke-dasharray')!.split(' ')[0]);
    expect(len(1)).toBeGreaterThan(len(0));
    expect(len(1)).toBeGreaterThan(len(2));
  });

  it('marks an island that needs the operator, and only that one', () => {
    const calm = paint('far', { fleet: [session('a', 'running')], attention: false });
    expect(q(calm, '[data-testid="mm-far-attention"]')).toHaveLength(0);
    const needy = paint('far', { fleet: [session('a', 'awaiting_input')], attention: true });
    expect(q(needy, '[data-testid="mm-far-attention"]')).toHaveLength(1);
  });

  it('names the breakdown in the tooltip, translated, never as raw tokens', () => {
    const c = paint('far', {
      fleet: [session('a', 'awaiting_input')],
      personasRunning: ['Dev Clone', 'QA Guardian'],
    });
    const tip = c.querySelector('[data-testid="mm-far-hex"] title')!.textContent!;
    expect(tip).toContain('3 processes running');
    expect(tip).toContain('Awaiting input');
    expect(tip).toContain('2 personas');
    expect(tip).not.toContain('awaiting_input');
  });
});
