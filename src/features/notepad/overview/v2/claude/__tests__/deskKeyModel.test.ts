import { describe, expect, it } from 'vitest';

import {
  cycleId,
  inferColumns,
  isTopRow,
  matchNote,
  moveIndex,
  reconcileSelection,
  resolveDeskKey,
  splitHighlights,
  type DeskKeyInput,
} from '../deskKeyModel';

const key = (k: string, extra: Partial<DeskKeyInput> = {}): DeskKeyInput => ({
  key: k,
  editable: false,
  control: false,
  ...extra,
});

describe('resolveDeskKey', () => {
  it('answers nothing while focus is in an editable field — not even Escape', () => {
    for (const k of ['a', 'j', 'Enter', 'Escape', '/', '1', 'Delete', '?']) {
      expect(resolveDeskKey(key(k, { editable: true }))).toBeNull();
    }
  });

  it('maps arrows, vim letters and Home/End to cursor moves', () => {
    expect(resolveDeskKey(key('ArrowDown'))).toEqual({ type: 'move', dir: 'down' });
    expect(resolveDeskKey(key('ArrowLeft'))).toEqual({ type: 'move', dir: 'left' });
    expect(resolveDeskKey(key('j'))).toEqual({ type: 'move', dir: 'next' });
    expect(resolveDeskKey(key('k'))).toEqual({ type: 'move', dir: 'prev' });
    expect(resolveDeskKey(key('Home'))).toEqual({ type: 'move', dir: 'first' });
    expect(resolveDeskKey(key('End'))).toEqual({ type: 'move', dir: 'last' });
  });

  it('leaves Enter to a focused button', () => {
    expect(resolveDeskKey(key('Enter'))).toEqual({ type: 'action', action: 'open' });
    expect(resolveDeskKey(key('Enter', { control: true }))).toBeNull();
  });

  it('maps the action letters', () => {
    const expected: Record<string, string> = {
      a: 'ask', r: 'reply', t: 'thread', y: 'approve', n: 'reject', p: 'publish',
      g: 'goals', s: 'step', i: 'edit', m: 'menu', e: 'archive', o: 'open', Delete: 'delete',
    };
    for (const [k, action] of Object.entries(expected)) {
      expect(resolveDeskKey(key(k))).toEqual({ type: 'action', action });
    }
  });

  it('opens the menu from the context-menu key and Shift+F10', () => {
    expect(resolveDeskKey(key('ContextMenu'))).toEqual({ type: 'action', action: 'menu' });
    expect(resolveDeskKey(key('F10', { shiftKey: true }))).toEqual({ type: 'action', action: 'menu' });
    expect(resolveDeskKey(key('F10'))).toBeNull();
  });

  it('maps the filter keys', () => {
    expect(resolveDeskKey(key('/'))).toEqual({ type: 'find' });
    expect(resolveDeskKey(key('c'))).toEqual({ type: 'write' });
    expect(resolveDeskKey(key('1'))).toEqual({ type: 'status', index: 0 });
    expect(resolveDeskKey(key('3'))).toEqual({ type: 'status', index: 2 });
    expect(resolveDeskKey(key('4'))).toBeNull();
    expect(resolveDeskKey(key('['))).toEqual({ type: 'project', step: -1 });
    expect(resolveDeskKey(key(']'))).toEqual({ type: 'project', step: 1 });
    expect(resolveDeskKey(key('0'))).toEqual({ type: 'project', step: 0 });
  });

  it('allows shift only for ?, and never answers a modifier chord', () => {
    expect(resolveDeskKey(key('?', { shiftKey: true }))).toEqual({ type: 'keys' });
    expect(resolveDeskKey(key('A', { shiftKey: true }))).toBeNull();
    expect(resolveDeskKey(key('a', { ctrlKey: true }))).toBeNull();
    expect(resolveDeskKey(key('1', { metaKey: true }))).toBeNull();
    expect(resolveDeskKey(key('k', { altKey: true }))).toBeNull();
    expect(resolveDeskKey(key('Escape'))).toEqual({ type: 'escape' });
  });

  it('ignores keys it does not own', () => {
    for (const k of [' ', 'Tab', 'x', 'Backspace', 'F5']) expect(resolveDeskKey(key(k))).toBeNull();
  });
});

describe('inferColumns', () => {
  it('counts the cards sharing the first row top', () => {
    expect(inferColumns([0, 0, 0, 0, 220, 220])).toBe(4);
    expect(inferColumns([10, 11, 240])).toBe(2);
    expect(inferColumns([0])).toBe(1);
    expect(inferColumns([])).toBe(1);
  });
});

describe('moveIndex', () => {
  // 10 cards in 4 columns:
  //  0 1 2 3
  //  4 5 6 7
  //  8 9
  const move = (i: number, dir: Parameters<typeof moveIndex>[3]) => moveIndex(i, 10, 4, dir);

  it('first press only shows the cursor', () => {
    expect(move(-1, 'down')).toBe(0);
    expect(move(-1, 'prev')).toBe(0);
    expect(move(-1, 'last')).toBe(9);
  });

  it('moves straight up and down a column', () => {
    expect(move(1, 'down')).toBe(5);
    expect(move(5, 'down')).toBe(9);
    expect(move(5, 'up')).toBe(1);
    expect(move(1, 'up')).toBe(1);
  });

  it('lands on the last card when the column below is missing', () => {
    expect(move(6, 'down')).toBe(9);
    expect(move(7, 'down')).toBe(9);
    expect(move(9, 'down')).toBe(9);
  });

  it('walks reading order with clamping at the ends', () => {
    expect(move(3, 'right')).toBe(4);
    expect(move(4, 'left')).toBe(3);
    expect(move(9, 'next')).toBe(9);
    expect(move(0, 'prev')).toBe(0);
    expect(move(5, 'first')).toBe(0);
    expect(move(5, 'last')).toBe(9);
  });

  it('returns -1 on an empty grid and recovers an out-of-range index', () => {
    expect(moveIndex(0, 0, 4, 'down')).toBe(-1);
    expect(moveIndex(12, 3, 4, 'next')).toBe(0);
  });

  it('knows the top row', () => {
    expect(isTopRow(2, 4)).toBe(true);
    expect(isTopRow(4, 4)).toBe(false);
    expect(isTopRow(-1, 4)).toBe(false);
  });
});

describe('reconcileSelection', () => {
  it('keeps a note that is still visible, at its new index', () => {
    expect(reconcileSelection({ id: 'c', index: 2 }, ['a', 'c'])).toEqual({ id: 'c', index: 1 });
  });

  it('hands the cursor to the card standing where the leaver was', () => {
    expect(reconcileSelection({ id: 'c', index: 2 }, ['a', 'b', 'd', 'e'])).toEqual({ id: 'd', index: 2 });
    expect(reconcileSelection({ id: 'z', index: 7 }, ['a', 'b'])).toEqual({ id: 'b', index: 1 });
  });

  it('keeps no selection as none, and empties on an empty grid', () => {
    expect(reconcileSelection({ id: null, index: -1 }, ['a'])).toEqual({ id: null, index: -1 });
    expect(reconcileSelection({ id: 'a', index: 0 }, [])).toEqual({ id: null, index: -1 });
  });
});

describe('matchNote', () => {
  it('matches everything on an empty query', () => {
    expect(matchNote('  ', 'Anything', '')).toEqual({ score: 0, titleRanges: [] });
  });

  it('finds title substrings, prefix strongest, with ranges', () => {
    const m = matchNote('ref', 'Refactor the pad', '');
    expect(m?.score).toBe(4);
    expect(m?.titleRanges).toEqual([[0, 3]]);
    expect(matchNote('pad', 'Refactor the pad', '')?.titleRanges).toEqual([[13, 16]]);
  });

  it('finds a fuzzy title subsequence', () => {
    const m = matchNote('rfct', 'Refactor', '');
    expect(m).not.toBeNull();
    expect(m?.titleRanges).toEqual([[0, 1], [2, 3], [4, 6]]);
  });

  it('searches the body by substring only', () => {
    expect(matchNote('sweeper', 'Title', 'the sweeper moves it')?.score).toBe(1);
    expect(matchNote('swpr', 'Title', 'the sweeper moves it')).toBeNull();
  });

  it('requires every token', () => {
    expect(matchNote('pad fleet', 'Refactor the pad', 'send it to fleet')).not.toBeNull();
    expect(matchNote('pad goals', 'Refactor the pad', 'send it to fleet')).toBeNull();
  });
});

describe('splitHighlights', () => {
  it('splits text into runs', () => {
    expect(splitHighlights('Refactor', [[0, 1], [2, 4]])).toEqual([
      { text: 'R', hit: true },
      { text: 'e', hit: false },
      { text: 'fa', hit: true },
      { text: 'ctor', hit: false },
    ]);
    expect(splitHighlights('abc', [])).toEqual([{ text: 'abc', hit: false }]);
  });
});

describe('cycleId', () => {
  it('wraps both ways', () => {
    expect(cycleId(['all', 'p1', 'p2'], 'p2', 1)).toBe('all');
    expect(cycleId(['all', 'p1', 'p2'], 'all', -1)).toBe('p2');
    expect(cycleId(['all', 'p1'], 'gone', 1)).toBe('p1');
    expect(cycleId([], 'x', 1)).toBe('x');
  });
});
