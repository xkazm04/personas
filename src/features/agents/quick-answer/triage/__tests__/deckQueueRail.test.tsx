/**
 * The queue rail, after the grouped single-line redesign.
 *
 * The rail used to spend the title's first 32px on a position badge and its
 * last 10rem on a project chip, then clamp what was left to two lines. Grouping
 * the project into a header and dropping the ordinal is easy; the things that
 * are easy to get WRONG while doing it are what this file pins:
 *
 *  (a) The icon is `aria-hidden`, so the kind survives only in an `sr-only`
 *      span — the one way this change could regress accessibility. Same for the
 *      deferred marker ("you already passed on this"), which matters because a
 *      skipped card sorts to the BACK of the queue rather than leaving it.
 *  (b) GROUP ORDER IS DEAL ORDER. The rail's job is "what is coming"; grouping
 *      is only safe because groups appear where their first member sits in the
 *      deal, so the next card stays at the top of the rail.
 *  (c) The cursor indexes the UNGROUPED deal, and headers shift everything
 *      below them. Marking the current row off a flattened index would mark the
 *      wrong row by however many headers precede it.
 *  (d) `railItemHeight` is `estimateSize` for the virtualizer above 40 flat
 *      items, so a constant left at the old height misplaces every row past it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import { DeckQueueRail, RAIL_WIDTH } from '../deck/DeckQueueRail';
import {
  RAIL_GROUP_HEADER_HEIGHT,
  RAIL_GROUP_HEADER_HEIGHT_GAPPED,
  RAIL_ROW_HEIGHT,
} from '../deck/deckRailGroups';
import { makeItem } from './triageFixtures';

// The rail grew a second tab (Accepted) whose body reads
// `dev_tools_undispatched_ideas`. These tests are about the DECIDE list, so the
// IPC layer is stubbed to an empty list — an unstubbed `invoke` in jsdom
// rejects, and a rail that took the deck down with it is exactly what the
// error path is guarded against elsewhere.
vi.mock('@/api/devTools/devTools', () => ({
  undispatchedIdeas: () => Promise.resolve([]),
  dispatchIdeas: () => Promise.resolve({ target: 'runner', dispatched: [], skipped: [], started: true }),
  bulkDeleteIdeas: () => Promise.resolve(0),
}));

/** The decide list's own scroller — every row query below is scoped to it, so
 *  the tab switcher's buttons above cannot be mistaken for a queue row. */
const listOf = (c: HTMLElement) => c.querySelector('[data-decide-list]') as HTMLElement;
const titles = (c: HTMLElement) =>
  [...listOf(c).querySelectorAll('[data-rail-name]')].map((n) => n.textContent);
const groups = (c: HTMLElement) =>
  [...listOf(c).querySelectorAll('[data-rail-group-name]')].map((n) => n.textContent);

// This repo's test setup does not auto-cleanup.
afterEach(cleanup);

function renderRail(items = [makeItem('idea')], skips = new Map<string, number>(), cursor = 0) {
  return render(
    <DeckQueueRail items={items} cursor={cursor} skips={skips} onJump={() => {}} />,
  );
}

describe('DeckQueueRail cursor', () => {
  // A jump moves the read head, not the row (see `triageQueue#cursorId`), so
  // "which row is being decided" is no longer "the first one".
  const three = () => [
    makeItem('idea', { sourceId: 'a', title: 'First' }),
    makeItem('idea', { sourceId: 'b', title: 'Second' }),
    makeItem('idea', { sourceId: 'c', title: 'Third' }),
  ];

  it('marks the row AT the cursor as current, not row 1', () => {
    const { container } = renderRail(three(), new Map(), 1);
    const current = listOf(container).querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.querySelector('[data-rail-name]')?.textContent).toBe('Second');
  });

  it('marks the cursor against the DEAL index, not the flattened one', () => {
    // Two groups means two headers sit above the third row in the flattened
    // sequence. If `current` were compared against a flat index, cursor 2 would
    // land on the wrong row — the whole hazard grouping introduces.
    const { container } = renderRail(
      [
        makeItem('idea', { sourceId: 'a', title: 'Alpha one', source: { label: 'alpha' } }),
        makeItem('idea', { sourceId: 'b', title: 'Beta one', source: { label: 'beta' } }),
        makeItem('idea', { sourceId: 'c', title: 'Alpha two', source: { label: 'alpha' } }),
      ],
      new Map(),
      2,
    );
    expect(
      listOf(container).querySelector('[aria-current="true"] [data-rail-name]')?.textContent,
    ).toBe('Alpha two');
  });
});

describe('DeckQueueRail grouping', () => {
  it('states the project once per group instead of once per row', () => {
    const { container } = renderRail([
      makeItem('idea', { sourceId: 'a', title: 'One', source: { label: 'personas' } }),
      makeItem('idea', { sourceId: 'b', title: 'Two', source: { label: 'personas' } }),
    ]);
    expect(groups(container)).toEqual(['personas']);
    // The per-row chip is gone: the row carries the title and nothing else.
    expect(listOf(container).querySelector('[data-rail-project]')).toBeNull();
  });

  it('orders groups by where their first member sits in the deal', () => {
    // Alphabetical ordering would put `alpha` first and move the next card down
    // the rail. Deal order is what keeps the rail readable as a queue.
    const { container } = renderRail([
      makeItem('idea', { sourceId: 'a', title: 'Zed one', source: { label: 'zed' } }),
      makeItem('idea', { sourceId: 'b', title: 'Alpha one', source: { label: 'alpha' } }),
      makeItem('idea', { sourceId: 'c', title: 'Zed two', source: { label: 'zed' } }),
    ]);
    expect(groups(container)).toEqual(['zed', 'alpha']);
    // Rows keep their relative deal order inside a group.
    expect(titles(container)).toEqual(['Zed one', 'Zed two', 'Alpha one']);
  });

  it('collects items with no project under a named group', () => {
    const { container } = renderRail([
      makeItem('idea', { sourceId: 'a', title: 'Orphan', source: { label: '' } }),
    ]);
    expect(groups(container)).toEqual(['No project']);
  });
});

describe('DeckQueueRail rows', () => {
  it('shows the title and keeps the kind reachable without printing it', () => {
    const { container } = renderRail([makeItem('idea', { title: 'Cache the roster' })]);

    expect(listOf(container).querySelector('[data-rail-name]')?.textContent).toBe(
      'Cache the roster',
    );
    // The kind must survive the deleted line — but only for assistive tech.
    expect(listOf(container).querySelector('.sr-only')?.textContent).toBe('Idea');
  });

  it('renders no ordinal beside the title', () => {
    // The badge numbered a ledger nobody counts in and cost every row its first
    // 32px. Its job — "where am I" — is the cursor's border and tint.
    const { container } = renderRail([
      makeItem('idea', { title: 'First' }),
      makeItem('idea', { title: 'Second' }),
    ]);
    // Everything the row says, in order: the sr-only kind, then the title.
    // Anything else in here is something that used to crowd the title out.
    const rows = [...listOf(container).querySelectorAll('button')].map((b) => b.textContent);
    expect(rows).toEqual(['IdeaFirst', 'IdeaSecond']);
  });

  it('keeps the deferred marker on a skipped row', () => {
    const item = makeItem('idea', { title: 'Passed on once' });
    const { container } = renderRail([item], new Map([[item.id, 1]]));
    expect(listOf(container).querySelector('.lucide-rotate-ccw')).toBeTruthy();
  });

  it('gives the deferred state an sr-only companion, like the kind above it', () => {
    // The glyph is `aria-hidden`, exactly like the kind icon — so without this
    // the rail's tail reads as "not looked at yet" for a screen reader, which is
    // the very confusion the marker exists to remove.
    const item = makeItem('idea', { title: 'Passed on once' });
    const { container } = renderRail([item], new Map([[item.id, 1]]));

    const spoken = [...listOf(container).querySelectorAll('.sr-only')].map((el) => el.textContent);
    expect(spoken).toContain('Idea');
    expect(spoken).toContain('Passed over earlier');
  });

  it('does not claim an unskipped row was passed over', () => {
    const { container } = renderRail([makeItem('idea', { title: 'Fresh' })]);
    const spoken = [...listOf(container).querySelectorAll('.sr-only')].map((el) => el.textContent);
    expect(spoken).not.toContain('Passed over earlier');
    expect(listOf(container).querySelector('.lucide-rotate-ccw')).toBeNull();
  });

  it('renders every name at normal weight', () => {
    const { container } = renderRail([
      makeItem('idea', { title: 'First' }),
      makeItem('review', { title: 'Second' }),
    ]);
    const names = listOf(container).querySelectorAll('[data-rail-name]');
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
  it('gives the row the SAME height it hands the virtualizer', () => {
    // The two used to be independent numbers — `estimateSize` in one place,
    // padding + line-height in the class list — and drift between them
    // misplaces every row past the fortieth, silently.
    const { container } = renderRail();
    const row = listOf(container).querySelector('button') as HTMLElement;
    expect(row.style.height).toBe(`${RAIL_ROW_HEIGHT}px`);
  });

  it('virtualizes long queues at the declared heights, headers included', () => {
    const items = Array.from({ length: 60 }, (_, i) =>
      makeItem('idea', { title: `Row ${i}`, source: { label: 'personas' } }),
    );
    const { container } = renderRail(items);
    const list = listOf(container).querySelector('ul[style]') as HTMLElement | null;
    expect(list).toBeTruthy();
    // One header plus sixty rows. A virtualizer told every item is a row would
    // be short by the header's height for the whole list below it.
    expect(list!.style.height).toBe(`${RAIL_GROUP_HEADER_HEIGHT + 60 * RAIL_ROW_HEIGHT}px`);
  });

  it('gives every group after the first its gap as height, not margin', () => {
    // A virtualizer positions by measured offset, so a collapsing margin is not
    // in its arithmetic — the breathing room has to BE the header's height.
    const { container } = renderRail([
      makeItem('idea', { sourceId: 'a', title: 'One', source: { label: 'alpha' } }),
      makeItem('idea', { sourceId: 'b', title: 'Two', source: { label: 'beta' } }),
    ]);
    const headers = [...listOf(container).querySelectorAll('[data-rail-group]')] as HTMLElement[];
    expect(headers.map((h) => h.style.height)).toEqual([
      `${RAIL_GROUP_HEADER_HEIGHT}px`,
      `${RAIL_GROUP_HEADER_HEIGHT_GAPPED}px`,
    ]);
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
