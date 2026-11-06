/**
 * The B/1 keymap as a pure reducer: (ui state, key, view) -> (next ui state,
 * the one intent to run). The hook that listens to the window only routes keys
 * here, and never from an input, so typing a direction can not trigger a pick.
 */
import type { RowView, StandupView } from './types';

export type Zoom = 'today' | '12d';

export interface UiState {
  /** Index into `view.rows`. */
  sel: number;
  /** Key of the row whose direction is being typed. */
  typing: string | null;
  dossier: boolean;
  rules: boolean;
  keys: boolean;
  zoom: Zoom;
}

export type Intent =
  | { type: 'pick'; row: RowView; index: number }
  | { type: 'skip'; row: RowView }
  | { type: 'undo'; row: RowView }
  | { type: 'accept'; row: RowView }
  | { type: 'talk'; row: RowView }
  | { type: 'arm' }
  | { type: 'amend' };

export const INITIAL_UI: UiState = { sel: 0, typing: null, dossier: false, rules: false, keys: false, zoom: 'today' };

/** A row still waiting for the operator's call. */
export function isOpen(row: RowView): boolean {
  return row.state === 'proposed' || row.state === 'blank';
}

/** After a decision, jump to the next open row below (B/1's "the cursor jumps on"). */
export function nextOpen(view: StandupView, from: number): number {
  for (let i = from + 1; i < view.rows.length; i++) if (isOpen(view.rows[i]!)) return i;
  return Math.min(view.rows.length - 1, from + 1);
}

export function clampSel(sel: number, view: StandupView): number {
  return Math.max(0, Math.min(sel, view.rows.length - 1));
}

/** Can this row be decided right now (draft standup, not refused, not a hold)? */
export function decidable(row: RowView | undefined, view: StandupView): row is RowView {
  return Boolean(row && view.life === 'decide' && row.itemId && row.kind !== 'hold' && row.state !== 'refused');
}

type Result = { ui: UiState; intent: Intent | null };

export function reduceKey(ui: UiState, key: string, view: StandupView): Result {
  const keep = (next: Partial<UiState>, intent: Intent | null = null): Result => ({ ui: { ...ui, ...next }, intent });
  // A modal sheet owns the keyboard (BaseModal closes itself on Escape); only "?" toggles the legend.
  if (ui.rules || ui.keys) return key === '?' && ui.keys ? keep({ keys: false }) : keep({});
  const row = view.rows[ui.sel];
  const k = key.length === 1 ? key.toLowerCase() : key;
  switch (k) {
    case '?': return keep({ keys: true });
    case 'Escape': return ui.dossier ? keep({ dossier: false }) : keep({ typing: null });
    case 'j': case 'ArrowDown': return keep({ sel: clampSel(ui.sel + 1, view), typing: null });
    case 'k': case 'ArrowUp': return keep({ sel: clampSel(ui.sel - 1, view), typing: null });
    case 'Enter': case 'ArrowRight': return row ? keep({ dossier: true }) : keep({});
    case 'ArrowLeft': return keep({ dossier: false });
    case 'z': return keep({ zoom: ui.zoom === 'today' ? '12d' : 'today' });
    case 'r': return view.id ? keep({ rules: true }) : keep({});
    case 'g': return view.life === 'decide' ? keep({}, { type: 'arm' }) : keep({});
    case 'n': return view.life === 'armed' || view.life === 'return' ? keep({}, { type: 'amend' }) : keep({});
    case 't': return row?.itemId && row.state !== 'refused' ? keep({}, { type: 'talk', row }) : keep({});
  }
  if (!decidable(row, view)) return keep({});
  if (/^[1-4]$/.test(k)) {
    const index = Number(k) - 1;
    if (row.kind === 'agent') return index === 0 ? keep({ sel: nextOpen(view, ui.sel) }, { type: 'accept', row }) : keep({});
    if (index >= row.proposals.length) return keep({});
    return keep({ sel: nextOpen(view, ui.sel), typing: null }, { type: 'pick', row, index });
  }
  if (k === 'e' && row.kind !== 'agent') return keep({ typing: row.key });
  if (k === 's') return keep({ sel: nextOpen(view, ui.sel) }, { type: 'skip', row });
  if (k === 'Backspace' || k === 'Delete') return keep({}, { type: 'undo', row });
  return keep({});
}
