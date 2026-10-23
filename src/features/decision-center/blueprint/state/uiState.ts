// The sheet's own state, as one reducer: which lens sheet is up, which item is current, whether the L4 feature
// sheet is open, which built item the compare panel shows, which overlay is on top, whether a build is armed, and
// what the dock console has printed. The
// data (proposals and their statuses) is NOT here: it is the store's, read from the source and re-read after a write.
import type { TriageResult } from '@/lib/lensScan/wire';
import type { DecideResult, StartResult, TriageDecisionInput } from '../source';

export type Overlay =
  | { kind: 'find' }
  | { kind: 'help' }
  /** The note prompt: which item, and the move it belongs to (decline asks a reason; rework, descope and accepting a
   *  failed build ask a note, the state table's NoteRule). */
  | { kind: 'reason'; itemId: string; move: NoteMove; /** A batch (multi-select, the ledger's checked rows): every id; itemId is the first. */ ids?: string[] };

/** The moves that may open the note prompt. */
export type NoteMove = 'decline' | 'accept' | 'rework' | 'descope';

/** One line the dock console printed: the store's answer, as it came back. */
export type ConsoleLine =
  | { key: number; kind: 'decide'; decision: 'approve' | 'decline'; ids: string[]; note?: string; result: DecideResult }
  | { key: number; kind: 'triage'; decision: TriageDecisionInput; ids: string[]; note?: string; result: TriageResult }
  | { key: number; kind: 'start'; lens: string; ids: string[]; result: StartResult }
  | { key: number; kind: 'failed'; verb: 'decide' | 'start' | 'triage'; message: string };

export type ConsoleInput = ConsoleLine extends infer L ? (L extends { key: number } ? Omit<L, 'key'> : never) : never;

export interface UiState {
  /** 'general' or a lens id. */
  lens: string;
  itemId: string | null;
  /** The feature whose L4 sheet is open. */
  sheet: string | null;
  /** The lens tab inside the L4 sheet: 'general' (overview) or a lens id. */
  sheetLens: string;
  /** The built item the L4 sheet's compare panel shows (WP4b); null when the panel is closed. */
  compare: string | null;
  queueOpen: boolean;
  overlay: Overlay | null;
  /** The approved items a build is armed for; B or Enter confirms, Esc disarms. */
  armed: string[] | null;
  busy: boolean;
  /** The move on its way to the store, so the control that was pressed (and only it) shows the spinner. */
  pending: string | null;
  lines: ConsoleLine[];
  /** The last thing said, for the status line and the live region. */
  say: { key: number; text: string } | null;
  nextKey: number;
  // ---- Stages B-D (spark bp-fidelity): the contract the parallel packages share. ----
  /** bp's page switch over one product: the drawing set or the findings ledger (L). */
  page: 'plan' | 'ledger';
  /** bp's rail flyout on top, one at a time; null = none. Review is the Build queue column, not a flyout. */
  flyout: 'agents' | 'plan' | 'view' | null;
  /** bp's expanded timeline panel (T). */
  timelineOpen: boolean;
  /** Time travel: the date (YYYY-MM-DD) the drawing is viewed at; null = now. */
  asOf: string | null;
  /** bp's multi-select (Space): the work items picked for one batch decision, in pick order. */
  selected: string[];
  /** bp's View window: how many days back counts as recent (the rail's View, default 7). */
  viewDays: number;
}

export type UiAction =
  | { type: 'lens'; id: string }
  | { type: 'item'; id: string | null }
  | { type: 'openSheet'; fid: string; lens?: string; compare?: string | null }
  | { type: 'compare'; id: string | null }
  | { type: 'closeSheet' }
  | { type: 'sheetLens'; id: string }
  | { type: 'queue'; open?: boolean }
  | { type: 'overlay'; overlay: Overlay | null }
  | { type: 'arm'; ids: string[] | null }
  | { type: 'busy'; on: boolean; move?: string }
  | { type: 'print'; line: ConsoleInput }
  | { type: 'say'; text: string }
  | { type: 'page'; page?: 'plan' | 'ledger' }
  | { type: 'flyout'; id: UiState['flyout'] }
  | { type: 'timeline'; open?: boolean }
  | { type: 'asOf'; date: string | null }
  | { type: 'select'; id: string }
  | { type: 'selectClear' }
  | { type: 'viewDays'; days: number };

export function initialUi(initialFeature?: string): UiState {
  return { lens: 'general', itemId: null, sheet: initialFeature ?? null, sheetLens: 'general', compare: null, queueOpen: true, overlay: null, armed: null, busy: false, pending: null, lines: [], say: null, nextKey: 1, page: 'plan', flyout: null, timelineOpen: false, asOf: null, selected: [], viewDays: 7 };
}

const MAX_LINES = 40;

export function uiReducer(s: UiState, a: UiAction): UiState {
  switch (a.type) {
    case 'lens': return s.lens === a.id ? s : { ...s, lens: a.id };
    case 'item': return s.itemId === a.id ? s : { ...s, itemId: a.id };
    case 'openSheet': return { ...s, sheet: a.fid, sheetLens: a.lens ?? s.lens, compare: a.compare !== undefined ? a.compare : s.sheet === a.fid ? s.compare : null, overlay: null };
    case 'closeSheet': return s.sheet === null ? s : { ...s, sheet: null, compare: null };
    case 'compare': return s.compare === a.id ? s : { ...s, compare: a.id };
    case 'sheetLens': return { ...s, sheetLens: a.id };
    case 'queue': return { ...s, queueOpen: a.open ?? !s.queueOpen };
    case 'overlay': return { ...s, overlay: a.overlay };
    case 'arm': return { ...s, armed: a.ids };
    case 'busy': return s.busy === a.on && s.pending === (a.on ? a.move ?? null : null) ? s : { ...s, busy: a.on, pending: a.on ? a.move ?? null : null };
    case 'print': return { ...s, lines: [{ ...a.line, key: s.nextKey } as ConsoleLine, ...s.lines].slice(0, MAX_LINES), nextKey: s.nextKey + 1 };
    case 'say': return { ...s, say: { key: s.nextKey, text: a.text }, nextKey: s.nextKey + 1 };
    case 'page': { const page = a.page ?? (s.page === 'plan' ? 'ledger' : 'plan'); return s.page === page ? s : { ...s, page, flyout: null }; }
    case 'flyout': return s.flyout === a.id ? s : { ...s, flyout: a.id };
    case 'timeline': { const open = a.open ?? !s.timelineOpen; return s.timelineOpen === open ? s : { ...s, timelineOpen: open }; }
    case 'asOf': return s.asOf === a.date ? s : { ...s, asOf: a.date };
    case 'select': return { ...s, selected: s.selected.includes(a.id) ? s.selected.filter((x) => x !== a.id) : [...s.selected, a.id] };
    case 'selectClear': return s.selected.length ? { ...s, selected: [] } : s;
    case 'viewDays': return s.viewDays === a.days ? s : { ...s, viewDays: a.days };
  }
}
