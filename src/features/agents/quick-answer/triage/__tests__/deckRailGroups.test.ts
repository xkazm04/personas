/**
 * The rail's grouping arithmetic, without a DOM.
 *
 * Both rail tabs window a GROUPED list, and a virtualizer only knows how to
 * window one flat index range — so the two-level structure is collapsed into a
 * single sequence before it ever reaches React. Everything that can go wrong
 * with that collapse is arithmetic: a group in the wrong place moves the head
 * of the queue off the top of the rail, and an index translated wrongly scrolls
 * to (or highlights) the wrong row by however many headers precede it. Neither
 * failure is visible in a screenshot, which is why they are pinned here rather
 * than through a render.
 */
import { describe, expect, it } from 'vitest';

import {
  RAIL_GROUP_HEADER_HEIGHT,
  RAIL_GROUP_HEADER_HEIGHT_GAPPED,
  RAIL_ROW_HEIGHT,
  flatIndexOf,
  groupRailRows,
  railItemHeight,
} from '../deck/deckRailGroups';

interface Row {
  id: string;
  project: string | null;
}

const rows = (...pairs: [string, string | null][]): Row[] =>
  pairs.map(([id, project]) => ({ id, project }));

const group = (items: Row[]) =>
  groupRailRows(items, (r) => r.id, (r) => r.project, 'No project');

/** Compact shape for assertions: headers as `#label`, rows as their id. */
const shape = (items: Row[]) =>
  group(items).map((entry) => (entry.kind === 'header' ? `#${entry.label}` : entry.item.id));

describe('groupRailRows', () => {
  it('orders groups by first appearance, not alphabetically', () => {
    // The decide list is dealt by weight and the rail answers "what is coming".
    // Sorting groups by name would drop the next card into the middle.
    expect(shape(rows(['a', 'zed'], ['b', 'alpha'], ['c', 'zed']))).toEqual([
      '#zed',
      'a',
      'c',
      '#alpha',
      'b',
    ]);
  });

  it('keeps rows in deal order inside their group', () => {
    expect(shape(rows(['a', 'p'], ['b', 'p'], ['c', 'p']))).toEqual(['#p', 'a', 'b', 'c']);
  });

  it('collects null, empty and whitespace projects under the fallback', () => {
    // `TriageItem.source.label` is a required string that can still be empty,
    // and `UndispatchedIdea.projectName` is genuinely nullable. Both arrive
    // here, so both have to land in the same bucket rather than one group each.
    expect(shape(rows(['a', null], ['b', ''], ['c', '   ']))).toEqual([
      '#No project',
      'a',
      'b',
      'c',
    ]);
  });

  it('counts each group and marks only the first', () => {
    const flat = group(rows(['a', 'p'], ['b', 'q'], ['c', 'q']));
    const headers = flat.filter((e) => e.kind === 'header');
    expect(headers.map((h) => (h.kind === 'header' ? [h.label, h.count, h.first] : null))).toEqual([
      ['p', 1, true],
      ['q', 2, false],
    ]);
  });

  it('keys headers by label, so a group above cannot re-key the ones below', () => {
    // A header keyed by position remounts every row under any group that
    // empties out — which on the Accepted tab happens every dispatch.
    const flat = group(rows(['a', 'p'], ['b', 'q']));
    expect(flat.filter((e) => e.kind === 'header').map((h) => h.key)).toEqual([
      'group:p',
      'group:q',
    ]);
  });

  it('carries each row its index in the ORIGINAL array', () => {
    // This is the number the decide list compares against the queue cursor. If
    // grouping renumbered it, the highlighted row would drift from the card.
    const flat = group(rows(['a', 'zed'], ['b', 'alpha'], ['c', 'zed']));
    expect(flat.filter((e) => e.kind === 'row').map((r) => (r.kind === 'row' ? [r.item.id, r.index] : null)))
      .toEqual([
        ['a', 0],
        ['c', 2],
        ['b', 1],
      ]);
  });

  it('returns nothing for an empty list — not a header with no rows', () => {
    expect(group([])).toEqual([]);
  });
});

describe('flatIndexOf', () => {
  it('translates a deal index into its flattened position', () => {
    const flat = group(rows(['a', 'zed'], ['b', 'alpha'], ['c', 'zed']));
    // #zed a c #alpha b  →  deal index 1 ('b') is flat index 4.
    expect(flatIndexOf(flat, 0)).toBe(1);
    expect(flatIndexOf(flat, 2)).toBe(2);
    expect(flatIndexOf(flat, 1)).toBe(4);
  });

  it('reports -1 for an index that is not in the list', () => {
    // The cursor can point past the end for a frame while the queue re-projects;
    // scrolling to a negative index is what the caller guards on.
    expect(flatIndexOf(group(rows(['a', 'p'])), 7)).toBe(-1);
  });
});

describe('railItemHeight', () => {
  it('gives rows one height and headers two', () => {
    const flat = group(rows(['a', 'p'], ['b', 'q']));
    expect(flat.map(railItemHeight)).toEqual([
      RAIL_GROUP_HEADER_HEIGHT,
      RAIL_ROW_HEIGHT,
      RAIL_GROUP_HEADER_HEIGHT_GAPPED,
      RAIL_ROW_HEIGHT,
    ]);
  });
});
