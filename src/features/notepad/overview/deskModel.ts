// Pure selection, filter, and keymap for the notepad desk.
// No React, no DOM, no stores — the keyboard reducer lives here so the
// tests can pin the model without mounting the overlay. Anything the DOM
// knows (the rendered column count, whether a card has a bubble up) is
// measured by the caller and passed IN.

/** The column count the grid is styled with — only the fallback for when the
 *  rendered count cannot be read (no layout yet, a test DOM). */
export const GRID_COLUMNS = 4;

export const PROJECT_ALL = '__all';
export const PROJECT_NONE = '__none';

export type NavDir = 'left' | 'right' | 'up' | 'down' | 'next' | 'prev' | 'home' | 'end';

export type CardAction =
  | 'ask'
  | 'publish'
  | 'goals'
  | 'thread'
  | 'reply'
  | 'approve'
  | 'reject'
  | 'delete';

export type DeskCommand =
  | { type: 'nav'; dir: NavDir }
  | { type: 'open' }
  | { type: 'search' }
  | { type: 'escape' }
  | { type: 'status'; index: number }
  | { type: 'project'; index: number }
  | { type: 'projectCycle'; delta: 1 | -1 }
  | { type: 'act'; action: CardAction }
  | { type: 'cheat' };

export interface DeskChromeState {
  selectedId: string | null;
  query: string;
  searchOpen: boolean;
  cheatOpen: boolean;
}

export type ChromeAction =
  | { type: 'select'; id: string | null }
  | { type: 'survive'; ids: readonly string[]; previousIds: readonly string[] }
  | { type: 'openSearch' }
  | { type: 'setQuery'; query: string }
  | { type: 'escape' }
  | { type: 'toggleCheat' }
  | { type: 'closeCheat' };

export const INITIAL_CHROME: DeskChromeState = {
  selectedId: null,
  query: '',
  searchOpen: false,
  cheatOpen: false,
};

/** True when Escape should be consumed by the desk instead of the host ladder. */
export function escapeOwnedByDesk(state: DeskChromeState): boolean {
  return state.cheatOpen || state.searchOpen || state.query.length > 0;
}

export function chromeReducer(state: DeskChromeState, action: ChromeAction): DeskChromeState {
  switch (action.type) {
    // An unchanged cursor returns the SAME state, so React bails out of the
    // re-render (the survive step runs on every change of the visible set).
    case 'select':
      return action.id === state.selectedId ? state : { ...state, selectedId: action.id };
    case 'survive': {
      const next = surviveSelection(action.ids, state.selectedId, action.previousIds);
      return next === state.selectedId ? state : { ...state, selectedId: next };
    }
    case 'openSearch':
      return { ...state, searchOpen: true };
    case 'setQuery':
      return { ...state, query: action.query, searchOpen: true };
    case 'toggleCheat':
      return { ...state, cheatOpen: !state.cheatOpen };
    case 'closeCheat':
      return { ...state, cheatOpen: false };
    case 'escape':
      if (state.cheatOpen) return { ...state, cheatOpen: false };
      if (state.query.length > 0) return { ...state, query: '' };
      if (state.searchOpen) return { ...state, searchOpen: false };
      return state;
  }
}

/**
 * 2D grid walk. Arrows clamp at the edges (a physical desk). `next`/`prev`
 * wrap (a vim list). An empty set has no cursor. A missing current id starts
 * at the first note, or the last when walking backward.
 */
export function moveIndex(index: number, count: number, dir: NavDir, columns: number): number {
  if (count <= 0) return -1;
  const at = Math.max(0, Math.min(index, count - 1));
  switch (dir) {
    case 'left':
      return Math.max(0, at - 1);
    case 'right':
      return Math.min(count - 1, at + 1);
    case 'up':
      return Math.max(0, at - columns);
    case 'down':
      return Math.min(count - 1, at + columns);
    case 'prev':
      return (at - 1 + count) % count;
    case 'next':
      return (at + 1) % count;
    case 'home':
      return 0;
    case 'end':
      return count - 1;
  }
}

export function moveSelection(
  ids: readonly string[],
  current: string | null,
  dir: NavDir,
  columns: number = GRID_COLUMNS,
): string | null {
  if (ids.length === 0) return null;
  const at = current ? ids.indexOf(current) : -1;
  if (at < 0) {
    if (dir === 'prev' || dir === 'left' || dir === 'up' || dir === 'end') {
      return ids[ids.length - 1]!;
    }
    return ids[0]!;
  }
  return ids[moveIndex(at, ids.length, dir, columns)]!;
}

/**
 * Keep the cursor on the same note across a filter change. If that note left
 * the set, sit on the note that now occupies its old slot (or the last note
 * when the slot is gone). An empty set clears the cursor.
 */
export function surviveSelection(
  ids: readonly string[],
  current: string | null,
  previousIds: readonly string[] = [],
): string | null {
  if (ids.length === 0) return null;
  if (current && ids.includes(current)) return current;
  if (current && previousIds.length > 0) {
    const prevIndex = previousIds.indexOf(current);
    if (prevIndex >= 0) return ids[Math.min(prevIndex, ids.length - 1)]!;
  }
  return ids[0]!;
}

export function cycleId(ids: readonly string[], current: string, delta: 1 | -1): string {
  if (ids.length === 0) return current;
  const at = ids.indexOf(current);
  if (at < 0) return ids[0]!;
  return ids[(at + delta + ids.length) % ids.length]!;
}

export function tokenizeQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesQuery(query: string, title: string, body: string): boolean {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return true;
  const hay = `${title}\n${body}`.toLowerCase();
  return tokens.every((tok) => hay.includes(tok));
}

/** Higher is a better hit. Title prefixes beat title contains beat body. */
export function scoreMatch(query: string, title: string, body: string): number {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return 0;
  const t = title.toLowerCase();
  const b = body.toLowerCase();
  let score = 0;
  for (const tok of tokens) {
    const ti = t.indexOf(tok);
    if (ti === 0) score += 100;
    else if (ti > 0) score += 40;
    else {
      const bi = b.indexOf(tok);
      if (bi === 0) score += 20;
      else if (bi > 0) score += 8;
    }
  }
  return score;
}

export function splitHighlight(
  text: string,
  query: string,
): { pre: string; hit: string; post: string } | null {
  const tok = tokenizeQuery(query)[0];
  if (!tok) return null;
  const i = text.toLowerCase().indexOf(tok);
  if (i < 0) return null;
  return {
    pre: text.slice(0, i),
    hit: text.slice(i, i + tok.length),
    post: text.slice(i + tok.length),
  };
}

export interface KeyStroke {
  key: string;
  code?: string;
  shiftKey?: boolean;
}

/**
 * Map a keystroke to a desk command. Modifiers other than Shift are the
 * caller's problem (Ctrl/C, etc. must never land here). Shifted letters are
 * ignored so a chord cannot fire Ask while the operator is reaching for `?`.
 */
export function commandFromKey(stroke: KeyStroke): DeskCommand | null {
  const shift = Boolean(stroke.shiftKey);
  const key = stroke.key;
  const code = stroke.code ?? '';

  if (shift && /^Digit[1-9]$/.test(code)) {
    return { type: 'project', index: Number(code.slice(5)) - 1 };
  }

  if (key === 'Escape') return { type: 'escape' };
  if (key === '?') return { type: 'cheat' };
  if (key === '/' && !shift) return { type: 'search' };
  if (key === 'Enter' && !shift) return { type: 'open' };
  if (key === 'Delete' && !shift) return { type: 'act', action: 'delete' };
  if (key === '[' ) return { type: 'projectCycle', delta: -1 };
  if (key === ']' ) return { type: 'projectCycle', delta: 1 };

  if (!shift && (key === '1' || key === '2' || key === '3')) {
    return { type: 'status', index: Number(key) - 1 };
  }

  if (shift && key.length === 1 && /[a-zA-Z]/.test(key)) return null;

  switch (key) {
    case 'ArrowLeft':
    case 'h':
      return { type: 'nav', dir: 'left' };
    case 'ArrowRight':
    case 'l':
      return { type: 'nav', dir: 'right' };
    case 'ArrowUp':
      return { type: 'nav', dir: 'up' };
    case 'ArrowDown':
      return { type: 'nav', dir: 'down' };
    case 'j':
      return { type: 'nav', dir: 'next' };
    case 'k':
      return { type: 'nav', dir: 'prev' };
    case 'Home':
      return { type: 'nav', dir: 'home' };
    case 'End':
      return { type: 'nav', dir: 'end' };
    case 'a':
      return { type: 'act', action: 'ask' };
    case 'p':
      return { type: 'act', action: 'publish' };
    case 'g':
      return { type: 'act', action: 'goals' };
    case 't':
      return { type: 'act', action: 'thread' };
    case 'r':
      return { type: 'act', action: 'reply' };
    case 'y':
      return { type: 'act', action: 'approve' };
    case 'n':
      return { type: 'act', action: 'reject' };
    default:
      return null;
  }
}

/**
 * The rendered column count from a computed `grid-template-columns`. A laid-out
 * grid reports resolved tracks (`"212px 212px 212px"`); an unresolved one may
 * still report the authored `repeat(4, minmax(0, 1fr))`. Anything unreadable
 * (`none`, empty) returns `fallback`.
 */
export function columnsFromTemplate(template: string | null | undefined, fallback: number = GRID_COLUMNS): number {
  const value = (template ?? '').trim();
  if (!value || value === 'none') return fallback;
  const repeat = /^repeat\(\s*(\d+)\s*,/.exec(value);
  if (repeat) return Math.max(1, Number(repeat[1]));
  // Count top-level tracks: drop `[line-name]`s, then split on whitespace that
  // sits outside parentheses (`minmax(0, 1fr)` is ONE track).
  const bare = value.replace(/\[[^\]]*\]/g, ' ');
  let depth = 0;
  let tracks = 0;
  let inTrack = false;
  for (const ch of bare) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(ch)) {
      inTrack = false;
    } else if (!inTrack) {
      inTrack = true;
      tracks += 1;
    }
  }
  return tracks > 0 ? tracks : fallback;
}

/**
 * The column count from the cards' own top edges, in grid order: the cards
 * sharing the first card's row. Used when the template cannot be read. An
 * empty grid returns `fallback`.
 */
export function columnsFromRowTops(tops: readonly number[], fallback: number = GRID_COLUMNS): number {
  if (tops.length === 0) return fallback;
  const first = tops[0]!;
  let n = 0;
  for (const top of tops) {
    if (Math.abs(top - first) > 1) break;
    n += 1;
  }
  return Math.max(1, n);
}

/** What the card knows about its bubble at the moment a review key lands. */
export interface BubbleSnapshot {
  /** A bubble is on screen for the card (and the thread is not). */
  up: boolean;
  /** The bubble carries a review still waiting on the operator. */
  pendingReview: boolean;
  /** The review's `refKind` — `run` rejects with a reason, `suggestion_card` in one tap. */
  refKind: string | null;
}

/** Where a review key lands. */
export type ReviewKeyEffect =
  | 'bubbleComment'
  | 'threadReply'
  | 'approve'
  | 'rejectNow'
  | 'rejectReason'
  | 'thread';

/**
 * `r` / `y` / `n` act on the bubble when one is up — the same place the mouse
 * would — and fall back to the thread otherwise:
 *   - `r` focuses the bubble's inline Comment field, else the thread composer;
 *   - `y` approves the bubble's pending review, else opens the thread;
 *   - `n` rejects a pending suggestion-card review in one tap, opens the
 *     reject-reason field for a pending `run` review (the reason is what the
 *     re-run is told), else opens the thread.
 */
export function reviewKeyEffect(action: 'reply' | 'approve' | 'reject', bubble: BubbleSnapshot): ReviewKeyEffect {
  if (action === 'reply') return bubble.up ? 'bubbleComment' : 'threadReply';
  if (!bubble.up || !bubble.pendingReview) return 'thread';
  if (action === 'approve') return 'approve';
  if (bubble.refKind === 'suggestion_card') return 'rejectNow';
  if (bubble.refKind === 'run') return 'rejectReason';
  return 'thread';
}

/** True when the keystroke belongs to a typing surface — inputs keep their keys. */
export function isTypingSurface(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** A dialog, menu, or listbox on screen owns arrows and letters. */
export function overlayOwnsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('[role="dialog"], [role="menu"], [role="listbox"]') !== null;
}
