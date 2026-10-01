/**
 * The draw-in (spark twin-portable-blueprint, round 2): every drafting sheet
 * draws itself in on a computed schedule. Asserted on the schedule the engine
 * writes onto the DOM (`data-draw-at`, `-for`, `-depth`), never on pixels:
 * frames by depth before any content, depth n+1 only once depth n has traced,
 * each container's content strictly one part after another in document
 * (reading) order, the stamp last; reduced motion plans nothing; a zoom opened
 * mid-draw draws itself; the stage's delta waits for the drawn sheet; the
 * working miniature loops in CSS.
 */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import type { BlueprintVariantProps, SectionId, TwinBlueprintModel } from '../../../blueprintContract';
import {
  FIXTURE_DELTA_INSTANT, FIXTURE_DELTA_RECONCILED, FIXTURE_EMPTY, FIXTURE_ONE_CHANNEL, FIXTURE_RICH,
} from '../../../__fixtures__/blueprintFixtures';
import { DRAW_TIMING, LOOP_LAST_START_SHARE, LOOP_MIN_CYCLE } from '../draw/drawTiming';
import DraftingBlueprint from '../index';

function setup(over: Partial<BlueprintVariantProps> = {}) {
  const props: BlueprintVariantProps = {
    model: FIXTURE_RICH, mode: 'detail', focus: null, onFocus: vi.fn(), onOpenDetail: vi.fn(),
    delta: null, working: false, reduced: false, ...over,
  };
  return { ...render(<DraftingBlueprint {...props} />), props };
}

interface Planned { el: Element; kind: string; at: number; dur: number; depth: number | null; scope: Element }

/** The schedule one drawing wrote onto its parts, in document order. */
function plannedIn(root: Element): Planned[] {
  return Array.from(root.querySelectorAll('[data-draw-at]'))
    .filter((el) => el.closest('[data-draw-root]') === root)
    .map((el) => {
      const scope = el.parentElement?.closest('[data-draw-scope]');
      return {
        el,
        kind: el.getAttribute('data-draw') ?? '',
        at: Number(el.getAttribute('data-draw-at')),
        dur: Number(el.getAttribute('data-draw-for')),
        depth: el.hasAttribute('data-draw-depth') ? Number(el.getAttribute('data-draw-depth')) : null,
        scope: scope && root.contains(scope) ? scope : root,
      };
    });
}

/** The drawing currently drawing itself in (one per sheet on screen). */
function drawing(): Element {
  const roots = document.querySelectorAll('[data-draw-root][data-draw-state="drawing"]');
  expect(roots).toHaveLength(1);
  return roots[0]!;
}

/** The invariants every drawing keeps; returns its parts for finer checks. */
function expectSchedule(root: Element, offset = 0) {
  const items = plannedIn(root);
  const frames = items.filter((i) => i.kind === 'frame');
  const content = items.filter((i) => i.kind !== 'frame' && i.kind !== 'press');
  expect(frames.length).toBeGreaterThan(0);
  expect(content.length).toBeGreaterThan(0);

  // Frames, level by level: depth d starts d waves in, and only once depth d-1 has traced.
  const depths = [...new Set(frames.map((f) => f.depth ?? -1))].sort((a, b) => a - b);
  expect(depths).toEqual(depths.map((_, i) => i));
  for (const f of frames) expect(f.at).toBe(offset + (f.depth ?? 0) * DRAW_TIMING.frameWave);
  for (const d of depths.slice(1)) {
    const before = Math.max(...frames.filter((f) => f.depth === d - 1).map((f) => f.at + f.dur));
    expect(Math.min(...frames.filter((f) => f.depth === d).map((f) => f.at))).toBeGreaterThanOrEqual(before);
  }

  // No content anywhere until the last frame has traced.
  const framesEnd = Math.max(...frames.map((f) => f.at + f.dur));
  const contentAt = offset + depths.length * DRAW_TIMING.frameWave;
  expect(Math.min(...content.map((c) => c.at))).toBeGreaterThanOrEqual(framesEnd);

  // Inside each container: from the content start, strictly one after another, in document order.
  const byScope = new Map<Element, Planned[]>();
  for (const c of content) byScope.set(c.scope, [...(byScope.get(c.scope) ?? []), c]);
  for (const list of byScope.values()) {
    expect(list[0]!.at).toBe(contentAt);
    for (let i = 1; i < list.length; i++) expect(list[i]!.at).toBe(list[i - 1]!.at + list[i - 1]!.dur);
  }

  // The stamp is pressed after every other part of the sheet.
  const end = Math.max(...items.filter((i) => i.kind !== 'press').map((i) => i.at + i.dur));
  for (const p of items.filter((i) => i.kind === 'press')) expect(p.at).toBeGreaterThanOrEqual(end);
  return { items, byScope };
}

const depthOf = (frameHost: Element | null) => frameHost?.querySelector(':scope > svg[data-draw-svg="outline"] [data-draw="frame"]')?.getAttribute('data-draw-depth');
/** The content one container writes, in order (its frames trace with their wave, not in its chronology). */
const kindsIn = (scope: Element) =>
  plannedIn(scope.closest('[data-draw-root]')!)
    .filter((i) => i.kind !== 'frame' && i.scope === scope)
    .map((i) => i.kind);

const FIXTURES: Array<[string, TwinBlueprintModel]> = [['empty', FIXTURE_EMPTY], ['one channel', FIXTURE_ONE_CHANNEL], ['rich', FIXTURE_RICH]];
const SECTIONS: SectionId[] = ['identity', 'voice', 'knowledge', 'training'];

describe('every sheet keeps the draughtsman\'s order', () => {
  it.each(FIXTURES)('%s: L1, every L2 and the stage', (_name, model) => {
    const l1 = setup({ model });
    expectSchedule(drawing());
    l1.unmount();
    for (const focus of SECTIONS) {
      const l2 = setup({ model, focus });
      expectSchedule(drawing());
      l2.unmount();
    }
    const st = setup({ model, mode: 'stage' });
    expectSchedule(drawing());
    st.unmount();
  });
});

describe('the nesting is the component structure', () => {
  it('L1: the border, the regions and the title block first; then what is framed inside them; then what is inside that', () => {
    setup();
    const { items, byScope } = expectSchedule(drawing());
    expect(items.filter((i) => i.depth === 0)).toHaveLength(6);
    for (const s of SECTIONS) expect(depthOf(screen.getByTestId(`twd-region-${s}`))).toBe('0');
    expect(depthOf(screen.getByTestId('twd-title-block'))).toBe('0');
    // Depth 1: a channel's elevation, a topic's track, a gauge, a title block cell.
    expect(depthOf(document.querySelector('[data-channel="email"] [data-measured]'))).toBe('1');
    expect(depthOf(document.querySelector('[data-topic="opinions"] .relative.h-2\\.5'))).toBe('1');
    expect(depthOf(document.querySelector('[data-goal="g2"] .relative.block'))).toBe('1');
    // Depth 2: the tier marks in a track and the readiness slots in their cell.
    expect(document.querySelector('[data-topic="opinions"] i[data-draw="frame"]')).toHaveAttribute('data-draw-depth', '2');
    expect(depthOf(document.querySelector('[data-slot="tone"] span'))).toBe('2');
    expect(byScope.size).toBeGreaterThan(30);
  });

  it('a region writes its own parts in reading order: balloon, number, name, share, the ink out to it', () => {
    setup();
    const voice = screen.getByTestId('twd-region-voice');
    expect(kindsIn(voice).slice(0, 6)).toEqual(['stroke', 'rise', 'write', 'write', 'write', 'ink']);
  });

  it('a channel letters its name, raises its eight stations one by one, then strikes its ticks', () => {
    setup();
    const email = document.querySelector('[data-channel="email"]')!;
    const kinds = kindsIn(email);
    expect(kinds[0]).toBe('write');
    expect(kinds.slice(1, 9)).toEqual(Array(8).fill('rise'));
    // 9 samples and 6 rules: fifteen ticks.
    expect(kinds.slice(9)).toEqual(Array(15).fill('tick'));
  });

  it('a tally letters its label and count, then strikes every stroke in turn', () => {
    setup();
    const approved = document.querySelector('[data-tally="approved"]')!;
    const kinds = kindsIn(approved);
    expect(kinds.slice(0, 2)).toEqual(['write', 'write']);
    // 57 approved on six gates: 30 strokes, then the break mark.
    expect(kinds.slice(2)).toEqual([...Array(30).fill('tick'), 'stroke']);
  });

  it('containers draw side by side: every one starts its content at the same moment', () => {
    setup();
    const root = drawing();
    const firsts = new Set([...expectSchedule(root).byScope.values()].map((list) => list[0]!.at));
    expect(firsts.size).toBe(1);
  });
});

describe('reduced motion draws everything at once', () => {
  it.each([
    ['L1', {}],
    ['L2', { focus: 'training' as const }],
    ['stage, working, mid-delta', { mode: 'stage' as const, working: true, delta: FIXTURE_DELTA_INSTANT }],
  ])('%s: no schedule, no strokes, no lettering, no pen', (_name, over) => {
    setup({ ...over, reduced: true });
    const roots = document.querySelectorAll('[data-draw-root]');
    expect(roots.length).toBeGreaterThan(0);
    for (const r of roots) expect(r).toHaveAttribute('data-draw-state', 'instant');
    expect(document.querySelectorAll('[data-draw-at], [data-loop-at], [data-ch]')).toHaveLength(0);
    expect(screen.queryByTestId('twd-pen')).toBeNull();
  });
});

function Zoomable(props: Partial<BlueprintVariantProps>) {
  const [focus, setFocus] = useState<SectionId | null>(null);
  return (
    <DraftingBlueprint model={FIXTURE_RICH} mode="detail" focus={focus} onFocus={setFocus} onOpenDetail={vi.fn()} delta={null} working={false} reduced={false} {...props} />
  );
}

describe('the sheet never holds the pointer or the keyboard', () => {
  it('a region pressed mid-draw zooms, and the zoom draws itself in; back, L1 is simply there', () => {
    render(<Zoomable />);
    expect(screen.getByTestId('twd-overview')).toHaveAttribute('data-draw-state', 'drawing');
    expect(screen.getByTestId('twd-pen')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voice' }));

    const zoom = screen.getByTestId('twd-focus-voice');
    expect(zoom).toHaveAttribute('data-draw-state', 'drawing');
    expectSchedule(zoom);
    // Every channel row of the schedule is its own container.
    expect(kindsIn(zoom.querySelector('li[data-channel="email"]')!).filter((k) => k === 'rise')).toHaveLength(8);

    fireEvent.click(screen.getByRole('button', { name: /Back to overview/ }));
    expect(screen.getByTestId('twd-overview')).toHaveAttribute('data-draw-state', 'instant');
    expect(screen.getByTestId('twd-overview').querySelectorAll('[data-draw-at]')).toHaveLength(0);
  });

  it('the regions are reachable by Tab while the sheet draws', () => {
    setup();
    screen.getByRole('button', { name: 'Identity' }).focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Identity' }));
    expect(drawing()).toBeInTheDocument();
  });
});

describe('stage: the deltas play on the drawn sheet', () => {
  afterEach(() => vi.useRealTimers());

  it('a delta there when the overlay opens waits for the sheet, then plays', () => {
    vi.useFakeTimers();
    setup({ mode: 'stage', delta: FIXTURE_DELTA_RECONCILED });
    expect(screen.getByTestId('twd-notes')).not.toHaveTextContent('Coverage +12%');
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(document.querySelector('[data-draw-root]')).toHaveAttribute('data-draw-state', 'done');
    expect(screen.getByTestId('twd-notes')).toHaveTextContent('Coverage +12%');
    expect(document.querySelector('[data-topic="opinions"]')).toHaveAttribute('data-delta-target', 'true');
  });

  it('an answer that arrives mid-draw finishes the drawing and plays at once', () => {
    const view = setup({ mode: 'stage' });
    expect(drawing()).toBeInTheDocument();
    view.rerender(<DraftingBlueprint {...view.props} delta={FIXTURE_DELTA_INSTANT} />);
    expect(document.querySelector('[data-draw-root]')).toHaveAttribute('data-draw-state', 'done');
    expect(screen.getByTestId('twd-notes')).toHaveTextContent('Answer recorded');
  });
});

describe('the working miniature is the same engine, looped in CSS', () => {
  it('its frames by depth, then its strokes, on one cycle long enough to stand drawn', () => {
    setup({ model: FIXTURE_EMPTY, mode: 'stage', working: true });
    const loop = document.querySelector<HTMLElement>('[data-draw-state="loop"]')!;
    expect(loop).not.toBeNull();
    const parts = Array.from(loop.querySelectorAll('[data-loop-at]'));
    expect(loop.querySelectorAll('[data-draw-at]')).toHaveLength(0);
    const at = (el: Element) => Number(el.getAttribute('data-loop-at'));
    const frames = parts.filter((p) => p.getAttribute('data-draw') === 'frame');
    const strokes = parts.filter((p) => p.getAttribute('data-draw') === 'stroke');
    expect(new Set(frames.map(at))).toEqual(new Set([0, DRAW_TIMING.frameWave]));
    expect(Math.min(...strokes.map(at))).toBe(2 * DRAW_TIMING.frameWave);
    const cycle = Number(loop.style.getPropertyValue('--draw-cycle'));
    expect(cycle).toBeGreaterThanOrEqual(LOOP_MIN_CYCLE);
    expect(Math.max(...parts.map(at))).toBeLessThanOrEqual(cycle * LOOP_LAST_START_SHARE);
  });
});
