import { describe, expect, it } from 'vitest';

import {
  chromeReducer,
  commandFromKey,
  cycleId,
  escapeOwnedByDesk,
  INITIAL_CHROME,
  matchesQuery,
  moveIndex,
  moveSelection,
  scoreMatch,
  splitHighlight,
  surviveSelection,
  tokenizeQuery,
} from './deskModel';

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];

describe('moveIndex / moveSelection — 2D grid', () => {
  it('clamps arrows at the edges of a 4-column grid', () => {
    //  a b c d
    //  e f g h
    //  i
    expect(moveIndex(0, 9, 'left', 4)).toBe(0);
    expect(moveIndex(0, 9, 'up', 4)).toBe(0);
    expect(moveIndex(3, 9, 'right', 4)).toBe(4);
    expect(moveIndex(8, 9, 'right', 4)).toBe(8);
    expect(moveIndex(8, 9, 'down', 4)).toBe(8);
    expect(moveIndex(0, 9, 'down', 4)).toBe(4);
    expect(moveIndex(4, 9, 'up', 4)).toBe(0);
    expect(moveIndex(8, 9, 'up', 4)).toBe(4);
  });

  it('wraps j/k (next/prev) around the list', () => {
    expect(moveIndex(8, 9, 'next', 4)).toBe(0);
    expect(moveIndex(0, 9, 'prev', 4)).toBe(8);
    expect(moveIndex(3, 9, 'next', 4)).toBe(4);
  });

  it('Home and End jump to the ends', () => {
    expect(moveSelection(ids, 'e', 'home')).toBe('a');
    expect(moveSelection(ids, 'e', 'end')).toBe('i');
  });

  it('starts at the first note when nothing is selected and walking forward', () => {
    expect(moveSelection(ids, null, 'next')).toBe('a');
    expect(moveSelection(ids, null, 'right')).toBe('a');
    expect(moveSelection(ids, null, 'down')).toBe('a');
    expect(moveSelection(ids, null, 'home')).toBe('a');
  });

  it('starts at the last note when nothing is selected and walking backward', () => {
    expect(moveSelection(ids, null, 'prev')).toBe('i');
    expect(moveSelection(ids, null, 'left')).toBe('i');
    expect(moveSelection(ids, null, 'up')).toBe('i');
    expect(moveSelection(ids, null, 'end')).toBe('i');
  });

  it('returns null on an empty set', () => {
    expect(moveSelection([], 'a', 'next')).toBeNull();
    expect(moveIndex(0, 0, 'next', 4)).toBe(-1);
  });

  it('stays on the only note for every direction', () => {
    for (const dir of ['left', 'right', 'up', 'down', 'next', 'prev', 'home', 'end'] as const) {
      expect(moveSelection(['solo'], 'solo', dir)).toBe('solo');
    }
  });

  it('treats a missing current id like an empty cursor', () => {
    expect(moveSelection(ids, 'gone', 'next')).toBe('a');
    expect(moveSelection(ids, 'gone', 'prev')).toBe('i');
  });
});

describe('surviveSelection', () => {
  it('keeps the current id when it is still in the set', () => {
    expect(surviveSelection(['a', 'c', 'e'], 'c', ids)).toBe('c');
  });

  it('sits on the note that now occupies the old slot', () => {
    // previous: a b c d e … current was d (index 3). After filter: a c e g i
    expect(surviveSelection(['a', 'c', 'e', 'g', 'i'], 'd', ids)).toBe('g');
  });

  it('clamps to the last note when the old slot is past the end', () => {
    expect(surviveSelection(['a', 'b'], 'i', ids)).toBe('b');
  });

  it('falls back to the first note when the previous list is unknown', () => {
    expect(surviveSelection(['x', 'y'], 'gone')).toBe('x');
  });

  it('clears the cursor when the set is empty', () => {
    expect(surviveSelection([], 'a', ids)).toBeNull();
  });
});

describe('cycleId', () => {
  it('wraps both ways', () => {
    expect(cycleId(['all', 'p1', 'none'], 'all', 1)).toBe('p1');
    expect(cycleId(['all', 'p1', 'none'], 'none', 1)).toBe('all');
    expect(cycleId(['all', 'p1', 'none'], 'all', -1)).toBe('none');
  });

  it('returns the current id on an empty list', () => {
    expect(cycleId([], 'all', 1)).toBe('all');
  });
});

describe('fuzzy query', () => {
  it('matches an empty query against everything', () => {
    expect(matchesQuery('', 'Ship the dock', 'body')).toBe(true);
    expect(tokenizeQuery('   ')).toEqual([]);
  });

  it('requires every token (AND) across title and body, case-insensitive', () => {
    expect(matchesQuery('ship dock', 'Ship the dock', 'notes')).toBe(true);
    expect(matchesQuery('SHIP', 'Ship the dock', '')).toBe(true);
    expect(matchesQuery('athena', 'Draft', 'Ask Athena about scope')).toBe(true);
    expect(matchesQuery('ship athena', 'Ship the dock', 'notes')).toBe(false);
  });

  it('scores title prefixes above title contains above body hits', () => {
    const q = 'ship';
    expect(scoreMatch(q, 'Ship the dock', '')).toBeGreaterThan(scoreMatch(q, 'A ship note', ''));
    expect(scoreMatch(q, 'A ship note', '')).toBeGreaterThan(scoreMatch(q, 'Draft', 'we should ship'));
    expect(scoreMatch('', 'Ship', 'body')).toBe(0);
  });

  it('splits a title around the first query token', () => {
    expect(splitHighlight('Ship the dock', 'dock')).toEqual({
      pre: 'Ship the ',
      hit: 'dock',
      post: '',
    });
    expect(splitHighlight('Ship the dock', 'gone')).toBeNull();
    expect(splitHighlight('Ship the dock', '')).toBeNull();
  });
});

describe('chromeReducer escape ladder', () => {
  it('closes the cheat sheet first', () => {
    const next = chromeReducer(
      { ...INITIAL_CHROME, cheatOpen: true, searchOpen: true, query: 'ship' },
      { type: 'escape' },
    );
    expect(next.cheatOpen).toBe(false);
    expect(next.query).toBe('ship');
    expect(next.searchOpen).toBe(true);
  });

  it('clears the query before closing the find field', () => {
    const cleared = chromeReducer(
      { ...INITIAL_CHROME, searchOpen: true, query: 'ship' },
      { type: 'escape' },
    );
    expect(cleared.query).toBe('');
    expect(cleared.searchOpen).toBe(true);
    const closed = chromeReducer(cleared, { type: 'escape' });
    expect(closed.searchOpen).toBe(false);
  });

  it('is a no-op when the desk owns nothing, so the host ladder can run', () => {
    const next = chromeReducer(INITIAL_CHROME, { type: 'escape' });
    expect(next).toEqual(INITIAL_CHROME);
    expect(escapeOwnedByDesk(INITIAL_CHROME)).toBe(false);
    expect(escapeOwnedByDesk({ ...INITIAL_CHROME, query: 'x' })).toBe(true);
    expect(escapeOwnedByDesk({ ...INITIAL_CHROME, searchOpen: true })).toBe(true);
  });

  it('survives a filter change through the reducer', () => {
    const selected = chromeReducer(INITIAL_CHROME, { type: 'select', id: 'c' });
    const next = chromeReducer(selected, {
      type: 'survive',
      ids: ['a', 'e'],
      previousIds: ['a', 'b', 'c', 'd', 'e'],
    });
    expect(next.selectedId).toBe('e');
  });
});

describe('commandFromKey', () => {
  it('maps arrows, vim keys, Home/End, and Enter', () => {
    expect(commandFromKey({ key: 'ArrowLeft' })).toEqual({ type: 'nav', dir: 'left' });
    expect(commandFromKey({ key: 'h' })).toEqual({ type: 'nav', dir: 'left' });
    expect(commandFromKey({ key: 'j' })).toEqual({ type: 'nav', dir: 'next' });
    expect(commandFromKey({ key: 'k' })).toEqual({ type: 'nav', dir: 'prev' });
    expect(commandFromKey({ key: 'Home' })).toEqual({ type: 'nav', dir: 'home' });
    expect(commandFromKey({ key: 'End' })).toEqual({ type: 'nav', dir: 'end' });
    expect(commandFromKey({ key: 'Enter' })).toEqual({ type: 'open' });
  });

  it('maps find, cheat, rails, and project cycling', () => {
    expect(commandFromKey({ key: '/' })).toEqual({ type: 'search' });
    expect(commandFromKey({ key: '?' })).toEqual({ type: 'cheat' });
    expect(commandFromKey({ key: '1' })).toEqual({ type: 'status', index: 0 });
    expect(commandFromKey({ key: '2' })).toEqual({ type: 'status', index: 1 });
    expect(commandFromKey({ key: '3' })).toEqual({ type: 'status', index: 2 });
    expect(commandFromKey({ key: '[' })).toEqual({ type: 'projectCycle', delta: -1 });
    expect(commandFromKey({ key: ']' })).toEqual({ type: 'projectCycle', delta: 1 });
  });

  it('maps Shift+DigitN (via code, because key is !/@/#) onto project tabs', () => {
    expect(commandFromKey({ key: '!', code: 'Digit1', shiftKey: true })).toEqual({
      type: 'project',
      index: 0,
    });
    expect(commandFromKey({ key: '(', code: 'Digit9', shiftKey: true })).toEqual({
      type: 'project',
      index: 8,
    });
  });

  it('maps card actions and Delete', () => {
    expect(commandFromKey({ key: 'a' })).toEqual({ type: 'act', action: 'ask' });
    expect(commandFromKey({ key: 'p' })).toEqual({ type: 'act', action: 'publish' });
    expect(commandFromKey({ key: 'g' })).toEqual({ type: 'act', action: 'goals' });
    expect(commandFromKey({ key: 't' })).toEqual({ type: 'act', action: 'thread' });
    expect(commandFromKey({ key: 'r' })).toEqual({ type: 'act', action: 'reply' });
    expect(commandFromKey({ key: 'y' })).toEqual({ type: 'act', action: 'approve' });
    expect(commandFromKey({ key: 'n' })).toEqual({ type: 'act', action: 'reject' });
    expect(commandFromKey({ key: 'Delete' })).toEqual({ type: 'act', action: 'delete' });
  });

  it('ignores shifted letters and unknown keys', () => {
    expect(commandFromKey({ key: 'A', shiftKey: true })).toBeNull();
    expect(commandFromKey({ key: 'x' })).toBeNull();
    expect(commandFromKey({ key: 'Backspace' })).toBeNull();
  });
});
