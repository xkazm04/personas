// The desk's keyboard model: pure functions only, so the whole key map, the
// grid-aware cursor and the fuzzy filter are unit-testable without a DOM.
//
// The component (`NoteOverviewV2`) owns the side effects; this file decides
// WHAT a key means, never what happens because of it.

/** Where a cursor move wants to go. `next`/`prev` walk reading order (j/k). */
export type DeskDir = 'left' | 'right' | 'up' | 'down' | 'next' | 'prev' | 'first' | 'last';

/** Verbs on the selected note. */
export type DeskAction =
  | 'open'
  | 'ask'
  | 'reply'
  | 'thread'
  | 'approve'
  | 'reject'
  | 'publish'
  | 'goals'
  | 'step'
  | 'edit'
  | 'menu'
  | 'archive'
  | 'delete';

export type DeskCommand =
  | { type: 'move'; dir: DeskDir }
  | { type: 'action'; action: DeskAction }
  | { type: 'find' }
  | { type: 'write' }
  | { type: 'status'; index: number }
  | { type: 'project'; step: -1 | 1 | 0 }
  | { type: 'keys' }
  | { type: 'escape' };

/** What the resolver needs to know about one keydown. */
export interface DeskKeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** Focus is in an input, textarea, select or contenteditable. */
  editable: boolean;
  /** Focus is on a control that owns Enter / Space itself (a button, a link, a tab). */
  control: boolean;
}

const MOVES: Readonly<Record<string, DeskDir>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  h: 'left',
  l: 'right',
  j: 'next',
  k: 'prev',
  Home: 'first',
  End: 'last',
};

const ACTIONS: Readonly<Record<string, DeskAction>> = {
  o: 'open',
  a: 'ask',
  r: 'reply',
  t: 'thread',
  y: 'approve',
  n: 'reject',
  p: 'publish',
  g: 'goals',
  s: 'step',
  i: 'edit',
  m: 'menu',
  e: 'archive',
  Delete: 'delete',
  ContextMenu: 'menu',
};

/** The status filter's digit keys, in `DESK_FILTERS` order. */
export const STATUS_KEYS = ['1', '2', '3'] as const;

/**
 * Map one keydown to a desk command, or `null` when the desk must leave it
 * alone.
 *
 * THE TYPING RULE comes first and has no exceptions: while focus is in
 * something editable, the desk answers nothing (not even Escape — the field,
 * or the host's ladder, owns that). The pad is a typing surface; the capture
 * line and a card's quick-write must type every letter they are given.
 */
export function resolveDeskKey(input: DeskKeyInput): DeskCommand | null {
  if (input.editable) return null;
  const { key } = input;

  // Shift+F10 is the platform's other context-menu chord.
  if (key === 'F10' && input.shiftKey && !input.ctrlKey && !input.metaKey && !input.altKey) {
    return { type: 'action', action: 'menu' };
  }
  // Every other chord belongs to someone else (the app's palette, the plan
  // tabs' Ctrl+digits, the browser).
  if (input.ctrlKey || input.metaKey || input.altKey) return null;

  if (key === 'Escape') return { type: 'escape' };
  // `?` arrives as Shift+/ on most layouts: shift is allowed for it alone.
  if (key === '?') return { type: 'keys' };
  if (input.shiftKey) return null;

  const dir = MOVES[key];
  if (dir) return { type: 'move', dir };

  // Enter on a focused button is that button's click, not "open the note".
  if (key === 'Enter') return input.control ? null : { type: 'action', action: 'open' };

  if (key === '/') return { type: 'find' };
  if (key === 'c') return { type: 'write' };

  const statusIndex = (STATUS_KEYS as readonly string[]).indexOf(key);
  if (statusIndex >= 0) return { type: 'status', index: statusIndex };
  if (key === '[') return { type: 'project', step: -1 };
  if (key === ']') return { type: 'project', step: 1 };
  if (key === '0') return { type: 'project', step: 0 };

  const action = ACTIONS[key];
  return action ? { type: 'action', action } : null;
}

// --- the cursor --------------------------------------------------------------

/**
 * Columns in the rendered grid, read off the cards' own offsets: every card
 * that shares the first card's top edge is in the first row. The grid is
 * responsive, so the column count is measured, never assumed.
 */
export function inferColumns(tops: readonly number[], tolerance = 2): number {
  if (tops.length === 0) return 1;
  const first = tops[0]!;
  let cols = 0;
  for (const top of tops) {
    if (Math.abs(top - first) <= tolerance) cols++;
    else break;
  }
  return Math.max(1, cols);
}

/**
 * The index a move lands on.
 *
 *  - No selection yet (`index < 0`): the first press only SHOWS the cursor, on
 *    the first card (or the last, for End).
 *  - Up / down are grid-aware: straight up or down a column. Down from a row
 *    whose column is missing in the (shorter) last row lands on the last card
 *    rather than doing nothing — there IS something below.
 *  - Left / right and j / k walk reading order and stop at the ends.
 */
export function moveIndex(index: number, count: number, cols: number, dir: DeskDir): number {
  if (count <= 0) return -1;
  const c = Math.max(1, cols);
  if (index < 0 || index >= count) return dir === 'last' ? count - 1 : 0;
  switch (dir) {
    case 'first':
      return 0;
    case 'last':
      return count - 1;
    case 'left':
    case 'prev':
      return Math.max(0, index - 1);
    case 'right':
    case 'next':
      return Math.min(count - 1, index + 1);
    case 'up':
      return index - c >= 0 ? index - c : index;
    case 'down': {
      if (index + c < count) return index + c;
      const row = Math.floor(index / c);
      const lastRow = Math.floor((count - 1) / c);
      return row < lastRow ? count - 1 : index;
    }
  }
}

/** True when an Up press has nowhere to go inside the grid (top row). */
export function isTopRow(index: number, cols: number): boolean {
  return index >= 0 && index < Math.max(1, cols);
}

export interface DeskSelection {
  id: string | null;
  index: number;
}

/**
 * Keep the cursor honest across a filter change.
 *
 *  - The selected note is still visible → it stays selected (at its new index).
 *  - It left → the cursor takes the card now standing where it was (clamped),
 *    so a narrowing filter does not throw the operator back to the top.
 *  - Nothing was selected → nothing is.
 */
export function reconcileSelection(prev: DeskSelection, ids: readonly string[]): DeskSelection {
  if (prev.id === null || ids.length === 0) return { id: null, index: -1 };
  const at = ids.indexOf(prev.id);
  if (at >= 0) return { id: prev.id, index: at };
  const index = Math.min(Math.max(prev.index, 0), ids.length - 1);
  return { id: ids[index]!, index };
}

// --- the filter --------------------------------------------------------------

export interface NoteMatch {
  score: number;
  /** Half-open `[start, end)` ranges of the TITLE to highlight, merged and sorted. */
  titleRanges: Array<[number, number]>;
}

/** Characters of `text` that spell `token` in order, or null. */
function subsequence(token: string, text: string): number[] | null {
  const hits: number[] = [];
  let ti = 0;
  for (let i = 0; i < text.length && ti < token.length; i++) {
    if (text[i] === token[ti]) {
      hits.push(i);
      ti++;
    }
  }
  return ti === token.length ? hits : null;
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/**
 * Does a note answer the query? Every whitespace-separated token must be found:
 *
 *  - in the title as a substring (strongest), or as an in-order subsequence
 *    (the fuzzy part — `rfct` finds "refactor"), or
 *  - in the body as a substring.
 *
 * The body is deliberately NOT searched by subsequence: a paragraph spells
 * almost any short token in order, and a filter that keeps every card is not a
 * filter. Returns null on a miss; an empty query matches everything.
 */
export function matchNote(query: string, title: string, body: string): NoteMatch | null {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { score: 0, titleRanges: [] };
  const t = title.toLowerCase();
  const b = body.toLowerCase();
  let score = 0;
  const ranges: Array<[number, number]> = [];
  for (const token of tokens) {
    const at = t.indexOf(token);
    if (at >= 0) {
      score += at === 0 ? 4 : 3;
      ranges.push([at, at + token.length]);
      continue;
    }
    const fuzzy = token.length >= 2 ? subsequence(token, t) : null;
    if (fuzzy) {
      score += 1.5;
      for (const i of fuzzy) ranges.push([i, i + 1]);
      continue;
    }
    if (b.includes(token)) {
      score += 1;
      continue;
    }
    return null;
  }
  return { score, titleRanges: mergeRanges(ranges) };
}

/** Split `text` into plain and highlighted runs for rendering. */
export function splitHighlights(
  text: string,
  ranges: ReadonlyArray<readonly [number, number]>,
): Array<{ text: string; hit: boolean }> {
  const out: Array<{ text: string; hit: boolean }> = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    const s = Math.max(cursor, Math.min(start, text.length));
    const e = Math.min(end, text.length);
    if (e <= s) continue;
    if (s > cursor) out.push({ text: text.slice(cursor, s), hit: false });
    out.push({ text: text.slice(s, e), hit: true });
    cursor = e;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
  return out;
}

/** Step through a list of project filter ids with wrap-around (`[` / `]`). */
export function cycleId(ids: readonly string[], current: string, step: -1 | 1): string {
  if (ids.length === 0) return current;
  const at = ids.indexOf(current);
  const from = at < 0 ? 0 : at;
  return ids[(from + step + ids.length) % ids.length]!;
}
