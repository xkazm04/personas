// The sheet's own state, as one reducer: which lens sheet is up, which item is current, whether the L4 feature
// sheet is open, which overlay is on top, whether a build is armed, and what the dock console has printed. The
// data (proposals and their statuses) is NOT here: it is the store's, read from the source and re-read after a write.
import type { DecideResult, StartResult } from '../source';

export type Overlay =
  | { kind: 'find' }
  | { kind: 'help' }
  /** The decline reason prompt: which item, and the move it belongs to. */
  | { kind: 'reason'; itemId: string; move: 'decline' };

/** One line the dock console printed: the store's answer, as it came back. */
export type ConsoleLine =
  | { key: number; kind: 'decide'; decision: 'approve' | 'decline'; ids: string[]; note?: string; result: DecideResult }
  | { key: number; kind: 'start'; lens: string; ids: string[]; result: StartResult }
  | { key: number; kind: 'failed'; verb: 'decide' | 'start'; message: string };

export type ConsoleInput = ConsoleLine extends infer L ? (L extends { key: number } ? Omit<L, 'key'> : never) : never;

export interface UiState {
  /** 'general' or a lens id. */
  lens: string;
  itemId: string | null;
  /** The feature whose L4 sheet is open. */
  sheet: string | null;
  /** The lens tab inside the L4 sheet: 'general' (overview) or a lens id. */
  sheetLens: string;
  queueOpen: boolean;
  overlay: Overlay | null;
  /** The approved items a build is armed for; B or Enter confirms, Esc disarms. */
  armed: string[] | null;
  busy: boolean;
  lines: ConsoleLine[];
  /** The last thing said, for the status line and the live region. */
  say: { key: number; text: string } | null;
  nextKey: number;
}

export type UiAction =
  | { type: 'lens'; id: string }
  | { type: 'item'; id: string | null }
  | { type: 'openSheet'; fid: string; lens?: string }
  | { type: 'closeSheet' }
  | { type: 'sheetLens'; id: string }
  | { type: 'queue'; open?: boolean }
  | { type: 'overlay'; overlay: Overlay | null }
  | { type: 'arm'; ids: string[] | null }
  | { type: 'busy'; on: boolean }
  | { type: 'print'; line: ConsoleInput }
  | { type: 'say'; text: string };

export function initialUi(initialFeature?: string): UiState {
  return { lens: 'general', itemId: null, sheet: initialFeature ?? null, sheetLens: 'general', queueOpen: true, overlay: null, armed: null, busy: false, lines: [], say: null, nextKey: 1 };
}

const MAX_LINES = 40;

export function uiReducer(s: UiState, a: UiAction): UiState {
  switch (a.type) {
    case 'lens': return s.lens === a.id ? s : { ...s, lens: a.id };
    case 'item': return s.itemId === a.id ? s : { ...s, itemId: a.id };
    case 'openSheet': return { ...s, sheet: a.fid, sheetLens: a.lens ?? s.lens, overlay: null };
    case 'closeSheet': return s.sheet === null ? s : { ...s, sheet: null };
    case 'sheetLens': return { ...s, sheetLens: a.id };
    case 'queue': return { ...s, queueOpen: a.open ?? !s.queueOpen };
    case 'overlay': return { ...s, overlay: a.overlay };
    case 'arm': return { ...s, armed: a.ids };
    case 'busy': return s.busy === a.on ? s : { ...s, busy: a.on };
    case 'print': return { ...s, lines: [{ ...a.line, key: s.nextKey } as ConsoleLine, ...s.lines].slice(0, MAX_LINES), nextKey: s.nextKey + 1 };
    case 'say': return { ...s, say: { key: s.nextKey, text: a.text }, nextKey: s.nextKey + 1 };
  }
}
