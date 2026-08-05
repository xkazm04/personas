/**
 * The queue rail, after the single-line redesign.
 *
 * The rail used to spend a whole second line restating a kind the left icon
 * already carried, which cost the title half the row width and doubled row
 * height. Deleting that line is easy; the three things that are easy to get
 * WRONG while deleting it are what this file pins:
 *
 *  (a) The icon is `aria-hidden`, so dropping the text would silently remove
 *      the item's type for screen readers — the one way this change could
 *      regress accessibility.
 *  (b) The deferred marker ("you already passed on this") lived on the deleted
 *      line. A skipped card sorts to the BACK of the queue rather than leaving
 *      it, so without the marker the rail's tail reads as "not looked at yet".
 *  (c) `ROW_HEIGHT` is handed to the virtualizer as `estimateSize` and
 *      virtualization engages above 40 rows, so a constant left at the old
 *      two-line height misplaces every row past the 40th.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import { DeckQueueRail, RAIL_WIDTH, ROW_HEIGHT } from '../deck/DeckQueueRail';
import { makeItem } from './triageFixtures';

// This repo's test setup does not auto-cleanup.
afterEach(cleanup);

function renderRail(items = [makeItem('idea')], skips = new Map<string, number>()) {
  return render(<DeckQueueRail items={items} skips={skips} onJump={() => {}} />);
}

describe('DeckQueueRail rows', () => {
  it('shows the title and keeps the kind reachable without printing it', () => {
    const { container } = renderRail([makeItem('idea', { title: 'Cache the roster' })]);

    const name = container.querySelector('[data-rail-name]');
    expect(name?.textContent).toBe('Cache the roster');

    // The kind must survive the deleted line — but only for assistive tech.
    const kind = container.querySelector('.sr-only');
    expect(kind?.textContent).toBe('Idea');
  });

  it('renders one line per row', () => {
    const { container } = renderRail([makeItem('idea', { title: 'Only line' })]);
    // The old row nested a second <span> carrying the kind text beside the
    // title. Exactly one visible text node per row is the shape now.
    const visibleSpans = container.querySelectorAll('button > span:not(.sr-only)');
    // position + icon-sibling text only: the counter and the name.
    expect(visibleSpans.length).toBe(2);
  });

  it('keeps the deferred marker on a skipped row', () => {
    const item = makeItem('idea', { title: 'Passed on once' });
    const { container } = renderRail([item], new Map([[item.id, 1]]));
    expect(container.querySelector('.lucide-rotate-ccw')).toBeTruthy();
  });

  it('gives the deferred state an sr-only companion, like the kind above it', () => {
    // The glyph is `aria-hidden`, exactly like the kind icon — so without this
    // the rail's tail reads as "not looked at yet" for a screen reader, which is
    // the very confusion the marker exists to remove.
    const item = makeItem('idea', { title: 'Passed on once' });
    const { container } = renderRail([item], new Map([[item.id, 1]]));

    const spoken = Array.from(container.querySelectorAll('.sr-only')).map((el) => el.textContent);
    expect(spoken).toContain('Idea');
    expect(spoken).toContain('Passed over earlier');
  });

  it('does not claim an unskipped row was passed over', () => {
    const { container } = renderRail([makeItem('idea', { title: 'Fresh' })]);
    const spoken = Array.from(container.querySelectorAll('.sr-only')).map((el) => el.textContent);
    expect(spoken).not.toContain('Passed over earlier');
  });

  it('does not mark an unskipped row as deferred', () => {
    const { container } = renderRail([makeItem('idea', { title: 'Fresh' })]);
    expect(container.querySelector('.lucide-rotate-ccw')).toBeNull();
  });

  it('renders every name at normal weight', () => {
    const { container } = renderRail([
      makeItem('idea', { title: 'First' }),
      makeItem('review', { title: 'Second' }),
    ]);
    const names = container.querySelectorAll('[data-rail-name]');
    expect(names.length).toBe(2);
    for (const n of names) {
      // typo-body is weight 400. typo-caption (500) and typo-title (600) are
      // what the row used to distinguish the current card with; the border and
      // background tint carry that now.
      expect(n.className).toContain('typo-body');
      expect(n.className).not.toContain('typo-title');
      expect(n.className).not.toContain('typo-caption');
    }
  });
});

describe('DeckQueueRail layout', () => {
  it('virtualizes long queues at the declared ROW_HEIGHT', () => {
    const items = Array.from({ length: 60 }, (_, i) =>
      makeItem('idea', { title: `Row ${i}` }),
    );
    const { container } = renderRail(items);
    const list = container.querySelector('ul[style]') as HTMLElement | null;
    expect(list).toBeTruthy();
    // The constant and the virtualizer's total size are two independent
    // numbers; drift between them is silent.
    expect(list!.style.height).toBe(`${60 * ROW_HEIGHT}px`);
  });

  it('applies the shared width constant to the rail', () => {
    const { container } = renderRail();
    const aside = container.querySelector('aside');
    expect(aside).toBeTruthy();
    // The mirror in TriageDeckVariant reads the SAME export. Two hand-copied
    // class lists that drift is how the card slides off-centre again.
    for (const cls of RAIL_WIDTH.split(' ')) {
      expect(aside!.className).toContain(cls);
    }
  });
});
